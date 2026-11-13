import Vehicle from "../models/Vehicle.js";
import Driver from "../models/Driver.js";
import Task from "../models/Task.js";
import Incident from "../models/Incident.js";
import TaskEvent from "../models/TaskEvent.js";
import { assignTask, validateDriverEligibility } from "./assignmentService.js";
import { enqueueNotification } from "../queues/notificationQueue.js";

/**
 * Handles vehicle breakdown and automatic recovery triage:
 * 1. Sets vehicle status to BREAKDOWN
 * 2. Sets assigned driver availability to OFFLINE
 * 3. Creates an Incident record with GPS coordinates and affected tasks
 * 4. Triage for affected tasks:
 *    - Unpicked tasks (ASSIGNED, ACCEPTED): Safely unassigned, driver workload decremented,
 *      and automatically re-dispatched via the intelligent matching engine.
 *    - In-transit tasks (PICKED_UP, IN_TRANSIT): Marked RECOVERY_REQUIRED. Cargo is physically
 *      stranded inside the broken vehicle; it is NEVER blindly reassigned without physical recovery.
 * 5. Emits real-time notifications via Socket.IO and BullMQ.
 */
export async function reportBreakdown(vehicleId, io = null, details = {}) {
  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) {
    const err = new Error("Vehicle not found");
    err.statusCode = 404;
    throw err;
  }

  // Mark vehicle broken down
  vehicle.status = "BREAKDOWN";
  await vehicle.save();

  // Find associated driver and set OFFLINE
  const driver = await Driver.findOne({ vehicleId: vehicle._id }).populate("userId");
  if (driver) {
    driver.availability = "OFFLINE";
    await driver.save();
  }

  // Find all active affected tasks
  const affectedTasks = await Task.find({
    vehicleId: vehicle._id,
    status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] }
  });

  const breakdownCoordinates = driver?.currentLocation?.coordinates || details.coordinates || [76.6394, 12.2958];

  const incident = await Incident.create({
    vehicleId: vehicle._id,
    driverId: driver?._id || null,
    type: details.type || "BREAKDOWN",
    severity: details.severity || "HIGH",
    description: details.description || `Emergency breakdown reported for ${vehicle.registrationNumber}`,
    coordinates: breakdownCoordinates,
    affectedTaskIds: affectedTasks.map((t) => t._id),
    status: "OPEN",
    recoveryActions: [
      {
        action: "BREAKDOWN_REPORTED",
        notes: details.description || `Breakdown reported at coordinates [${breakdownCoordinates.join(", ")}]`,
        performedByName: details.reportedByName || "System",
        performedAt: new Date()
      }
    ]
  });

  const results = [];
  let unpickedCount = 0;

  for (const task of affectedTasks) {
    // A. Cargo already picked up or in transit: Physical cargo is inside the disabled vehicle.
    // Strict safety rule: NEVER blindly reassign in-transit cargo to another driver!
    if (["PICKED_UP", "IN_TRANSIT"].includes(task.status)) {
      task.status = "RECOVERY_REQUIRED";
      task.notes =
        (task.notes ? task.notes + " | " : "") +
        `Vehicle ${vehicle.registrationNumber} broke down during transit. Physical cargo recovery required at GPS coordinates [${breakdownCoordinates.join(", ")}].`;
      await task.save();

      await TaskEvent.create({
        taskId: task._id,
        type: "RECOVERY_REQUIRED",
        message: `Vehicle ${vehicle.registrationNumber} disabled. Physical cargo recovery dispatched for safety.`,
        metadata: {
          incidentId: incident._id,
          vehicleId: vehicle._id,
          driverId: driver?._id,
          coordinates: breakdownCoordinates
        }
      });

      results.push({
        taskId: task._id,
        title: task.title,
        status: task.status,
        outcome: "RECOVERY_REQUIRED",
        message: "Cargo already in vehicle; manual recovery unit required"
      });

      await enqueueNotification({
        title: "CRITICAL: Cargo Recovery Required",
        message: `Task ${task.title} has cargo stranded in broken vehicle ${vehicle.registrationNumber}. Dispatch recovery unit.`,
        type: "RECOVERY",
        metadata: { taskId: task._id, incidentId: incident._id }
      });

      continue;
    }

    // B. Cargo has NOT been picked up yet (ASSIGNED or ACCEPTED).
    // Safely unassign and trigger intelligent reassignment to another driver.
    unpickedCount++;

    await Task.updateOne(
      { _id: task._id },
      {
        $set: {
          status: "CREATED",
          driverId: null,
          vehicleId: null,
          assignmentScore: null,
          scoreBreakdown: null
        }
      }
    );

    await TaskEvent.create({
      taskId: task._id,
      type: "BREAKDOWN_ALERT",
      message: `Assigned vehicle ${vehicle.registrationNumber} broke down prior to pickup. Task returned to queue for intelligent auto-reassignment.`,
      metadata: { incidentId: incident._id }
    });

    try {
      const reassignment = await assignTask(task._id, io);
      results.push({
        taskId: task._id,
        title: task.title,
        outcome: "AUTOMATICALLY_REASSIGNED",
        newDriverId: reassignment.driverId,
        newScore: reassignment.score
      });
    } catch (assignErr) {
      results.push({
        taskId: task._id,
        title: task.title,
        outcome: "QUEUED_FOR_REASSIGNMENT",
        message: "No immediate replacement found; waiting in dispatch pool"
      });
    }
  }

  // Update driver's workload: Decrement by the number of unpicked tasks that were unassigned
  if (driver && unpickedCount > 0) {
    const newCount = Math.max(0, (driver.activeTaskCount || 0) - unpickedCount);
    await Driver.updateOne({ _id: driver._id }, { $set: { activeTaskCount: newCount } });
  }

  // Socket.IO real-time alert dispatch
  if (io) {
    io.to("dispatchers").emit("vehicle:breakdown", {
      vehicleId: vehicle._id,
      registrationNumber: vehicle.registrationNumber,
      incidentId: incident._id,
      results
    });
    io.to("dispatchers").emit("incident:created", incident);
  }

  // Background notification
  await enqueueNotification({
    title: `Vehicle Breakdown: ${vehicle.registrationNumber}`,
    message: `Vehicle reported breakdown. ${affectedTasks.length} affected task(s) processed.`,
    type: "BREAKDOWN",
    metadata: { incidentId: incident._id, vehicleId: vehicle._id }
  });

  return { incident, vehicle, affectedCount: affectedTasks.length, results };
}

/**
 * Dispatches a physical cargo recovery unit for a task in RECOVERY_REQUIRED status.
 * Safely transfers custody of stranded cargo to an eligible replacement driver & vehicle.
 */
export async function dispatchRecoveryUnit({
  taskId,
  recoveryDriverId,
  user,
  incidentId = null,
  recoveryNotes = "",
  io = null
}) {
  const task = await Task.findById(taskId);
  if (!task) {
    const err = new Error("Delivery task not found");
    err.statusCode = 404;
    throw err;
  }

  if (task.status !== "RECOVERY_REQUIRED") {
    const err = new Error(`Cannot dispatch recovery for task in status: ${task.status}. Must be RECOVERY_REQUIRED.`);
    err.statusCode = 409;
    throw err;
  }

  const recoveryDriver = await Driver.findById(recoveryDriverId)
    .populate("userId", "name email phone")
    .populate("vehicleId");

  if (!recoveryDriver || !recoveryDriver.vehicleId) {
    const err = new Error("Recovery driver or vehicle not found");
    err.statusCode = 404;
    throw err;
  }

  // Validate recovery vehicle capacity for stranded cargo
  const recoveryVehicle = recoveryDriver.vehicleId;
  const validation = validateDriverEligibility(recoveryDriver, recoveryVehicle, task);
  if (!validation.eligible) {
    const err = new Error(`Recovery vehicle ineligible: ${validation.issues.join("; ")}`);
    err.statusCode = 422;
    err.issues = validation.issues;
    throw err;
  }

  // Atomically reserve recovery driver and recovery vehicle
  const reservedDriver = await Driver.findOneAndUpdate(
    { _id: recoveryDriver._id, availability: "AVAILABLE" },
    { $set: { availability: "BUSY" }, $inc: { activeTaskCount: 1 } },
    { new: true }
  );
  if (!reservedDriver) {
    const err = new Error("Recovery driver was concurrently assigned or is no longer available.");
    err.statusCode = 409;
    throw err;
  }

  const reservedVehicle = await Vehicle.findOneAndUpdate(
    { _id: recoveryVehicle._id, status: "AVAILABLE" },
    { $set: { status: "BUSY" } },
    { new: true }
  );
  if (!reservedVehicle) {
    await Driver.updateOne(
      { _id: recoveryDriver._id },
      { $set: { availability: "AVAILABLE" }, $inc: { activeTaskCount: -1 } }
    );
    const err = new Error("Recovery vehicle is no longer available.");
    err.statusCode = 409;
    throw err;
  }

  // Decrement broken driver's stranded active task count
  const previousDriverId = task.driverId;
  if (previousDriverId) {
    await Driver.updateOne(
      { _id: previousDriverId },
      { $inc: { activeTaskCount: -1 } }
    );
  }

  // Transfer custody to recovery driver and resume IN_TRANSIT
  task.status = "IN_TRANSIT";
  task.driverId = recoveryDriver._id;
  task.vehicleId = recoveryVehicle._id;
  task.notes = (task.notes ? task.notes + " | " : "") +
    `Physical cargo recovery completed by ${recoveryDriver.userId?.name} (${recoveryVehicle.registrationNumber}). Resuming transit.`;
  await task.save();

  // Audit event
  const event = await TaskEvent.create({
    taskId: task._id,
    type: "IN_TRANSIT",
    message: `Physical recovery custody transferred to ${recoveryDriver.userId?.name} (${recoveryVehicle.registrationNumber}) by ${user.name}. In transit to destination.`,
    metadata: {
      action: "RECOVERY_CUSTODY_TRANSFER",
      previousDriverId,
      recoveryDriverId: recoveryDriver._id,
      recoveryVehicleId: recoveryVehicle._id,
      recoveryNotes: recoveryNotes || "Cargo verified intact and loaded into recovery unit."
    },
    actorId: user._id,
    actorName: user.name
  });

  // Record recovery action in Incident
  if (incidentId) {
    await Incident.updateOne(
      { _id: incidentId },
      {
        $push: {
          recoveryActions: {
            action: "CARGO_RECOVERED",
            notes: recoveryNotes || `Custody transferred to ${recoveryDriver.userId?.name} (${recoveryVehicle.registrationNumber})`,
            performedBy: user._id,
            performedByName: user.name,
            performedAt: new Date(),
            taskId: task._id,
            recoveryDriverId: recoveryDriver._id
          }
        }
      }
    );
  }

  if (io) {
    io.to("dispatchers").emit("task:status:changed", { task, event });
    io.to(`driver:${recoveryDriver._id}`).emit("task:assigned", { task });
  }

  return { success: true, task, event };
}

/**
 * Resolves an incident, records recovery notes, and optionally returns the vehicle to service.
 */
export async function resolveIncident(
  incidentId,
  { resolutionNotes = "", returnVehicleToService = true },
  user = null,
  io = null
) {
  const incident = await Incident.findById(incidentId).populate("vehicleId").populate("driverId");
  if (!incident) {
    const err = new Error("Incident not found");
    err.statusCode = 404;
    throw err;
  }

  incident.status = "RESOLVED";
  incident.resolutionNotes = resolutionNotes || "Maintenance completed. Vehicle inspected and certified.";
  incident.resolvedAt = new Date();
  if (user) {
    incident.resolvedBy = user._id;
  }

  incident.recoveryActions.push({
    action: "INCIDENT_RESOLVED",
    notes: resolutionNotes || "Depot maintenance complete. All systems nominal.",
    performedBy: user?._id || null,
    performedByName: user?.name || "Dispatcher",
    performedAt: new Date()
  });

  await incident.save();

  // Return vehicle to service if requested
  if (returnVehicleToService && incident.vehicleId) {
    await Vehicle.updateOne(
      { _id: incident.vehicleId._id },
      { $set: { status: "AVAILABLE", lastMaintenanceDate: new Date() } }
    );
  }

  // Restore driver to AVAILABLE if activeTaskCount is 0
  if (incident.driverId) {
    const currentDriver = await Driver.findById(incident.driverId._id);
    if (currentDriver && currentDriver.activeTaskCount === 0) {
      await Driver.updateOne(
        { _id: incident.driverId._id },
        { $set: { availability: "AVAILABLE" } }
      );
    }
  }

  if (io) {
    io.to("dispatchers").emit("incident:resolved", incident);
  }

  return incident;
}
