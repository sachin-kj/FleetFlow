import Task from "../models/Task.js";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import TaskEvent from "../models/TaskEvent.js";
import { enqueueNotification } from "../queues/notificationQueue.js";

/**
 * Valid state transition definitions and authorized roles.
 * DRIVER: Must be the specific driver assigned to the task.
 * DISPATCHER / ADMIN: Fleet operations staff.
 * SYSTEM: Background workers / automation engines.
 */
export const TASK_TRANSITIONS = {
  CREATED: {
    ASSIGNED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    ASSIGNING: ["ADMIN", "DISPATCHER", "SYSTEM"],
    CANCELLED: ["ADMIN", "DISPATCHER"]
  },
  ASSIGNING: {
    ASSIGNED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    CREATED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    CANCELLED: ["ADMIN", "DISPATCHER"]
  },
  ASSIGNED: {
    ACCEPTED: ["DRIVER"],
    REJECTED: ["DRIVER"],
    CANCELLED: ["ADMIN", "DISPATCHER"],
    DELAYED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    RECOVERY_REQUIRED: ["ADMIN", "DISPATCHER", "SYSTEM"]
  },
  ACCEPTED: {
    PICKED_UP: ["DRIVER"],
    CANCELLED: ["ADMIN", "DISPATCHER"],
    DELAYED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    RECOVERY_REQUIRED: ["ADMIN", "DISPATCHER", "SYSTEM"]
  },
  PICKED_UP: {
    IN_TRANSIT: ["DRIVER"],
    CANCELLED: ["ADMIN", "DISPATCHER"],
    DELAYED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    RECOVERY_REQUIRED: ["ADMIN", "DISPATCHER", "SYSTEM"]
  },
  IN_TRANSIT: {
    DELIVERED: ["DRIVER"],
    CANCELLED: ["ADMIN", "DISPATCHER"],
    DELAYED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    RECOVERY_REQUIRED: ["ADMIN", "DISPATCHER", "SYSTEM"]
  },
  DELAYED: {
    ACCEPTED: ["DRIVER"],
    REJECTED: ["DRIVER"],
    PICKED_UP: ["DRIVER"],
    IN_TRANSIT: ["DRIVER"],
    DELIVERED: ["DRIVER"],
    CANCELLED: ["ADMIN", "DISPATCHER"],
    RECOVERY_REQUIRED: ["ADMIN", "DISPATCHER", "SYSTEM"]
  },
  REJECTED: {
    CREATED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    ASSIGNED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    CANCELLED: ["ADMIN", "DISPATCHER"]
  },
  RECOVERY_REQUIRED: {
    ASSIGNED: ["ADMIN", "DISPATCHER", "SYSTEM"],
    IN_TRANSIT: ["ADMIN", "DISPATCHER", "SYSTEM"],
    DELIVERED: ["DRIVER", "ADMIN", "DISPATCHER"],
    CANCELLED: ["ADMIN", "DISPATCHER"]
  },
  DELIVERED: {},
  CANCELLED: {}
};

/**
 * Checks if a status transition is permitted.
 */
export function isTransitionAllowed(fromStatus, toStatus, userRole) {
  const allowedNext = TASK_TRANSITIONS[fromStatus];
  if (!allowedNext || !allowedNext[toStatus]) return false;
  return allowedNext[toStatus].includes(userRole);
}

/**
 * Executes an atomic task status transition, enforcing RBAC, zero-trust driver verification,
 * resource updates (driver/vehicle availability and workload counts), and audit logging.
 */
export async function transitionTaskStatus({
  taskId,
  targetStatus,
  user,
  driver = null,
  reason = "",
  metadata = {},
  io = null
}) {
  const task = await Task.findById(taskId);
  if (!task) {
    const error = new Error("Delivery task not found");
    error.statusCode = 404;
    throw error;
  }

  const currentStatus = task.status;

  // 1. Terminal state check
  if (["DELIVERED", "CANCELLED"].includes(currentStatus)) {
    const error = new Error(`Cannot transition a completed or cancelled task (${currentStatus})`);
    error.statusCode = 409;
    throw error;
  }

  // 2. Validate state transition mapping
  const allowedTargetRoles = TASK_TRANSITIONS[currentStatus]?.[targetStatus];
  if (!allowedTargetRoles) {
    const error = new Error(`Invalid state transition: Cannot advance task from ${currentStatus} to ${targetStatus}`);
    error.statusCode = 409;
    throw error;
  }

  // 3. Strict anti-impersonation: Driver lifecycle transitions can ONLY be performed by DRIVER
  const driverOnlyEvents = ["ACCEPTED", "REJECTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"];
  if (driverOnlyEvents.includes(targetStatus) && user.role !== "DRIVER") {
    const error = new Error(
      `Forbidden: Dispatchers and administrators cannot impersonate drivers on delivery lifecycle events (${targetStatus}).`
    );
    error.statusCode = 403;
    throw error;
  }

  // 4. Role authorization check
  if (!allowedTargetRoles.includes(user.role)) {
    const error = new Error(
      `Forbidden: Users with role ${user.role} are not authorized to transition tasks to ${targetStatus}`
    );
    error.statusCode = 403;
    throw error;
  }

  // 5. Zero-trust driver ownership check
  if (user.role === "DRIVER") {
    if (!driver || !driver._id) {
      const error = new Error("Unauthorized: No driver profile associated with this account");
      error.statusCode = 403;
      throw error;
    }
    if (!task.driverId || task.driverId.toString() !== driver._id.toString()) {
      const error = new Error("Forbidden: You are not authorized to operate on shipments assigned to another driver");
      error.statusCode = 403;
      throw error;
    }
  }

  // 6. Execute state-specific updates
  const assignedDriverId = task.driverId;
  const assignedVehicleId = task.vehicleId;
  const now = new Date();

  task.status = targetStatus;

  switch (targetStatus) {
    case "ACCEPTED":
      task.acceptedAt = now;
      break;

    case "REJECTED":
      task.rejectedAt = now;
      task.rejectionReason = reason || "Driver rejected assignment";
      task.driverId = null;
      task.vehicleId = null;
      task.assignmentScore = null;
      task.scoreBreakdown = null;

      // Free driver & vehicle
      if (assignedDriverId) {
        await Driver.updateOne(
          { _id: assignedDriverId },
          {
            $set: { availability: "AVAILABLE" },
            $inc: { activeTaskCount: -1 }
          }
        );
      }
      if (assignedVehicleId) {
        await Vehicle.updateOne({ _id: assignedVehicleId }, { $set: { status: "AVAILABLE" } });
      }
      break;

    case "PICKED_UP":
      task.pickedUpAt = now;
      break;

    case "IN_TRANSIT":
      // Task is actively on the road
      break;

    case "DELIVERED":
      task.deliveredAt = now;

      // Release driver and increment completion metric
      if (assignedDriverId) {
        await Driver.updateOne(
          { _id: assignedDriverId },
          {
            $set: { availability: "AVAILABLE" },
            $inc: { activeTaskCount: -1, totalDeliveries: 1 }
          }
        );
      }
      if (assignedVehicleId) {
        await Vehicle.updateOne({ _id: assignedVehicleId }, { $set: { status: "AVAILABLE" } });
      }

      await enqueueNotification({
        title: "Delivery Completed",
        message: `Task ${task.title} (${task.trackingNumber}) has been successfully delivered!`,
        type: "TASK_UPDATE",
        metadata: { taskId: task._id }
      });
      break;

    case "CANCELLED":
      task.cancelledAt = now;

      // Release driver and vehicle if currently assigned
      if (assignedDriverId) {
        await Driver.updateOne(
          { _id: assignedDriverId },
          {
            $set: { availability: "AVAILABLE" },
            $inc: { activeTaskCount: -1 }
          }
        );
      }
      if (assignedVehicleId) {
        await Vehicle.updateOne({ _id: assignedVehicleId }, { $set: { status: "AVAILABLE" } });
      }
      break;

    case "DELAYED":
      task.delayedAt = now;
      break;

    case "RECOVERY_REQUIRED":
      // Breakdown or accident occurred with cargo aboard
      break;
  }

  await task.save();

  // 7. Record immutable audit log
  const event = await TaskEvent.create({
    taskId: task._id,
    type: targetStatus,
    message: reason || `Task advanced to ${targetStatus.replace("_", " ")} by ${user.name || "System"}`,
    metadata: {
      ...metadata,
      previousStatus: currentStatus,
      targetStatus,
      driverId: assignedDriverId,
      vehicleId: assignedVehicleId
    },
    actorId: user._id || null,
    actorName: user.name || "System"
  });

  // 8. Real-time notification dispatch
  if (io) {
    io.to("dispatchers").emit("task:status:changed", { task, event });
    if (assignedDriverId) {
      io.to(`driver:${assignedDriverId}`).emit("task:status:changed", { task, event });
    }
  }

  return { task, event };
}
