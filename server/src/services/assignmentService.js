import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import Task from "../models/Task.js";
import TaskEvent from "../models/TaskEvent.js";
import { safeSet } from "../config/redis.js";

const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Calculates great-circle distance between two GPS coordinates in kilometers.
 */
export function haversineDistanceKm(coords1, coords2) {
  if (!coords1 || !coords2) return 10;
  const [lon1, lat1] = coords1;
  const [lon2, lat2] = coords2;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c; // Earth's radius in km
}

/**
 * Validates whether a driver and their assigned vehicle are eligible to carry a specific task.
 * Used identically for both automatic intelligent dispatch and manual dispatcher allocation.
 *
 * Checks:
 * 1. Driver availability status === AVAILABLE
 * 2. Driver shift status !== OFFLINE
 * 3. Driver workload limit: activeTaskCount < 3
 * 4. Vehicle assignment: Driver must have an assigned vehicle
 * 5. Vehicle availability: vehicle.status === AVAILABLE
 * 6. Weight capacity: vehicle.capacityKg >= task.cargoKg
 * 7. Volume capacity: vehicle.volumeM3 >= task.volumeM3
 * 8. Vehicle type compatibility: vehicle.type === task.requiredVehicleType
 */
export function validateDriverEligibility(driver, vehicle, task) {
  const issues = [];

  if (!driver) {
    issues.push("Driver record not found");
    return { eligible: false, issues };
  }

  if (driver.availability !== "AVAILABLE") {
    issues.push(`Driver availability is '${driver.availability}' (must be AVAILABLE)`);
  }

  if (driver.shiftStatus === "INACTIVE" || driver.shiftStatus === "OFFLINE") {
    issues.push(`Driver shift is '${driver.shiftStatus}'`);
  }

  if ((driver.activeTaskCount || 0) >= 3) {
    issues.push(`Driver has reached maximum concurrent workload limit (3 tasks)`);
  }

  if (!vehicle) {
    issues.push("Driver does not have an assigned operational vehicle");
    return { eligible: false, issues };
  }

  if (vehicle.status !== "AVAILABLE") {
    issues.push(`Vehicle ${vehicle.registrationNumber} status is '${vehicle.status}' (must be AVAILABLE)`);
  }

  if (vehicle.capacityKg < task.cargoKg) {
    issues.push(
      `Vehicle capacity (${vehicle.capacityKg} kg) is insufficient for cargo weight (${task.cargoKg} kg)`
    );
  }

  if (task.volumeM3 && vehicle.volumeM3 && vehicle.volumeM3 < task.volumeM3) {
    issues.push(
      `Vehicle volume capacity (${vehicle.volumeM3} m³) is insufficient for cargo volume (${task.volumeM3} m³)`
    );
  }

  if (task.requiredVehicleType && vehicle.type !== task.requiredVehicleType) {
    issues.push(
      `Vehicle type mismatch: shipment requires ${task.requiredVehicleType}, vehicle is ${vehicle.type}`
    );
  }

  return {
    eligible: issues.length === 0,
    issues
  };
}

/**
 * Calculates weighted scores for a driver for a specific task.
 * Score = 0.40 * DistanceScore + 0.25 * AvailabilityScore + 0.20 * WorkloadScore + 0.15 * DeadlineScore
 */
export function calculateDriverScore(driver, task) {
  const driverCoords = driver.currentLocation?.coordinates || [76.6394, 12.2958];
  const pickupCoords = task.pickup.coordinates;
  const distanceKm = haversineDistanceKm(driverCoords, pickupCoords);

  // 1. Distance score (closer = higher score, 0-100)
  // 0 km = 100, 10 km = 65, 25 km = 12.5, >=28.5 km = 0
  const distanceScore = Math.max(0, Math.min(100, 100 - distanceKm * 3.5));

  // 2. Availability score (ready on active shift = 100, on break = 60, unavailable = 0)
  let availabilityScore = 100;
  if (driver.shiftStatus === "ON_BREAK") availabilityScore = 60;
  else if (driver.availability !== "AVAILABLE") availabilityScore = 0;

  // 3. Workload score (fewer active tasks = higher score)
  const activeCount = driver.activeTaskCount || 0;
  const workloadScore = Math.max(0, 100 - activeCount * 30);

  // 4. Deadline score
  let deadlineScore = 85;
  if (task.deadline) {
    const minutesRemaining = (new Date(task.deadline).getTime() - Date.now()) / 60000;
    const estTripMinutes = (distanceKm / 35) * 60 + 20; // 35 km/h avg speed + 20m buffer
    const buffer = minutesRemaining - estTripMinutes;

    if (buffer >= 90) deadlineScore = 95;
    else if (buffer >= 45) deadlineScore = 100;
    else if (buffer >= 15) deadlineScore = 80;
    else if (buffer >= 0) deadlineScore = 65;
    else deadlineScore = 30; // already tight or at risk
  }

  // Final weighted score
  const totalScore =
    0.40 * distanceScore +
    0.25 * availabilityScore +
    0.20 * workloadScore +
    0.15 * deadlineScore;

  const explanation = `Driver is ${distanceKm.toFixed(1)}km away (dist score: ${distanceScore.toFixed(0)}), ` +
    `availability: ${driver.availability} (${availabilityScore}/100), ` +
    `active tasks: ${activeCount} (${workloadScore}/100), ` +
    `deadline margin: ${deadlineScore}/100.`;

  return {
    totalScore: Number(totalScore.toFixed(1)),
    distanceKm: Number(distanceKm.toFixed(2)),
    explanation,
    breakdown: {
      distanceScore: Number(distanceScore.toFixed(1)),
      availabilityScore: Number(availabilityScore.toFixed(1)),
      workloadScore: Number(workloadScore.toFixed(1)),
      deadlineScore: Number(deadlineScore.toFixed(1)),
      distanceKm: Number(distanceKm.toFixed(2))
    }
  };
}

/**
 * Finds and ranks all eligible drivers for a given task using unified eligibility rules.
 */
export async function getEligibleDrivers(task) {
  const drivers = await Driver.find({ availability: "AVAILABLE" })
    .populate("userId", "name email phone")
    .populate("vehicleId");

  const eligible = drivers.filter((driver) => {
    const validation = validateDriverEligibility(driver, driver.vehicleId, task);
    return validation.eligible;
  });

  const ranked = eligible
    .map((driver) => {
      const scoring = calculateDriverScore(driver, task);
      return {
        driver,
        vehicle: driver.vehicleId,
        score: scoring.totalScore,
        distanceKm: scoring.distanceKm,
        explanation: scoring.explanation,
        breakdown: scoring.breakdown
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked;
}

/**
 * Concurrency-safe atomic automatic task assignment.
 * Employs optimistic locking on the Task document and conditional reservations
 * on both Driver and Vehicle to guarantee no double-allocations or race conditions.
 */
export async function assignTask(taskId, io = null) {
  const task = await Task.findById(taskId);
  if (!task) {
    const err = new Error("Delivery task not found");
    err.statusCode = 404;
    throw err;
  }

  if (!["CREATED", "ASSIGNING", "REJECTED"].includes(task.status)) {
    const err = new Error(`Cannot assign task in status: ${task.status}`);
    err.statusCode = 409;
    throw err;
  }

  // Atomically lock task into ASSIGNING status to prevent concurrent assignment attempts
  const lock = await Task.findOneAndUpdate(
    { _id: task._id, status: { $in: ["CREATED", "ASSIGNING", "REJECTED"] } },
    { $set: { status: "ASSIGNING" } },
    { new: true }
  );
  if (!lock) {
    const err = new Error("Task was concurrently modified or assigned. Please retry.");
    err.statusCode = 409;
    throw err;
  }

  try {
    const candidates = await getEligibleDrivers(task);
    if (!candidates.length) {
      // Revert task status back to CREATED
      await Task.updateOne({ _id: task._id }, { $set: { status: "CREATED" } });
      const err = new Error("No eligible available driver and vehicle found matching cargo and capacity requirements.");
      err.statusCode = 422;
      throw err;
    }

    for (const candidate of candidates) {
      const driver = candidate.driver;
      const vehicle = candidate.vehicle;

      // 1. Atomic reservation of the driver
      const reservedDriver = await Driver.findOneAndUpdate(
        { _id: driver._id, availability: "AVAILABLE" },
        { $set: { availability: "BUSY" }, $inc: { activeTaskCount: 1 } },
        { new: true }
      );
      if (!reservedDriver) continue; // Concurrently claimed, attempt next best ranked candidate

      // 2. Atomic reservation of the vehicle
      const reservedVehicle = await Vehicle.findOneAndUpdate(
        { _id: vehicle._id, status: "AVAILABLE" },
        { $set: { status: "BUSY" } },
        { new: true }
      );
      if (!reservedVehicle) {
        // Rollback driver reservation
        await Driver.updateOne(
          { _id: driver._id },
          { $set: { availability: "AVAILABLE" }, $inc: { activeTaskCount: -1 } }
        );
        continue;
      }

      // 3. Final atomic assignment update to Task
      const assigned = await Task.findOneAndUpdate(
        { _id: task._id, status: "ASSIGNING" },
        {
          $set: {
            status: "ASSIGNED",
            driverId: driver._id,
            vehicleId: vehicle._id,
            assignmentScore: candidate.score,
            scoreBreakdown: candidate.breakdown,
            assignedAt: new Date()
          }
        },
        { new: true }
      )
        .populate({ path: "driverId", populate: { path: "userId", select: "name email phone" } })
        .populate("vehicleId");

      if (!assigned) {
        // Rollback both driver and vehicle
        await Vehicle.updateOne({ _id: vehicle._id }, { $set: { status: "AVAILABLE" } });
        await Driver.updateOne(
          { _id: driver._id },
          { $set: { availability: "AVAILABLE" }, $inc: { activeTaskCount: -1 } }
        );
        const err = new Error("Failed to finalize task assignment due to concurrent modification.");
        err.statusCode = 409;
        throw err;
      }

      // Record audit event
      await TaskEvent.create({
        taskId: task._id,
        type: "ASSIGNED",
        message: `Auto-assigned to ${driver.userId?.name || "Driver"} (${vehicle.registrationNumber}) with score ${candidate.score}`,
        metadata: {
          score: candidate.score,
          breakdown: candidate.breakdown,
          explanation: candidate.explanation,
          driverId: driver._id,
          vehicleId: vehicle._id
        }
      });

      // Update Redis availability cache
      try {
        await safeSet(`driver:availability:${driver._id}`, "BUSY", "EX", 86400);
      } catch (err) {
        console.warn("Redis availability update warning:", err.message);
      }

      // Emit real-time updates via Socket.IO
      if (io) {
        io.to("dispatchers").emit("task:assigned", {
          task: assigned,
          driverId: driver._id,
          score: candidate.score,
          breakdown: candidate.breakdown
        });
        io.to(`driver:${driver._id}`).emit("task:assigned", { task: assigned });
        if (driver.userId?._id) {
          io.to(`user:${driver.userId._id}`).emit("task:assigned", { task: assigned });
        }
      }

      return {
        success: true,
        task: assigned,
        driverId: driver._id,
        vehicleId: vehicle._id,
        score: candidate.score,
        breakdown: candidate.breakdown,
        explanation: candidate.explanation
      };
    }

    // All candidates were concurrently claimed
    await Task.updateOne({ _id: task._id }, { $set: { status: "CREATED" } });
    const err = new Error("All eligible candidates were concurrently assigned. Please retry.");
    err.statusCode = 409;
    throw err;
  } catch (err) {
    await Task.updateOne({ _id: task._id, status: "ASSIGNING" }, { $set: { status: "CREATED" } });
    throw err;
  }
}

/**
 * Concurrency-safe atomic manual task assignment.
 * Enforces the exact same validation rules as automatic assignment.
 */
export async function manualAssignTask({ taskId, driverId, user, io = null }) {
  const task = await Task.findById(taskId);
  if (!task) {
    const err = new Error("Delivery task not found");
    err.statusCode = 404;
    throw err;
  }

  if (!["CREATED", "ASSIGNING", "REJECTED"].includes(task.status)) {
    const err = new Error(`Cannot assign task in status: ${task.status}`);
    err.statusCode = 409;
    throw err;
  }

  const driver = await Driver.findById(driverId)
    .populate("userId", "name email phone")
    .populate("vehicleId");

  if (!driver) {
    const err = new Error("Selected driver not found");
    err.statusCode = 404;
    throw err;
  }

  // Enforce parity with auto-assignment validation rules
  const validation = validateDriverEligibility(driver, driver.vehicleId, task);
  if (!validation.eligible) {
    const err = new Error(`Driver ineligible: ${validation.issues.join("; ")}`);
    err.statusCode = 422;
    err.issues = validation.issues;
    throw err;
  }

  const vehicle = driver.vehicleId;

  // Atomically lock task into ASSIGNING status
  const lock = await Task.findOneAndUpdate(
    { _id: task._id, status: { $in: ["CREATED", "ASSIGNING", "REJECTED"] } },
    { $set: { status: "ASSIGNING" } },
    { new: true }
  );
  if (!lock) {
    const err = new Error("Task was concurrently modified or assigned. Please retry.");
    err.statusCode = 409;
    throw err;
  }

  try {
    // 1. Atomic reservation of the driver
    const reservedDriver = await Driver.findOneAndUpdate(
      { _id: driver._id, availability: "AVAILABLE" },
      { $set: { availability: "BUSY" }, $inc: { activeTaskCount: 1 } },
      { new: true }
    );
    if (!reservedDriver) {
      await Task.updateOne({ _id: task._id }, { $set: { status: "CREATED" } });
      const err = new Error("Selected driver was concurrently assigned or is no longer available.");
      err.statusCode = 409;
      throw err;
    }

    // 2. Atomic reservation of the vehicle
    const reservedVehicle = await Vehicle.findOneAndUpdate(
      { _id: vehicle._id, status: "AVAILABLE" },
      { $set: { status: "BUSY" } },
      { new: true }
    );
    if (!reservedVehicle) {
      await Driver.updateOne(
        { _id: driver._id },
        { $set: { availability: "AVAILABLE" }, $inc: { activeTaskCount: -1 } }
      );
      await Task.updateOne({ _id: task._id }, { $set: { status: "CREATED" } });
      const err = new Error("Selected driver's vehicle was concurrently reserved or is unavailable.");
      err.statusCode = 409;
      throw err;
    }

    // 3. Compute transparent score breakdown for manual assignment
    const scoreData = calculateDriverScore(driver, task);

    // 4. Final atomic assignment update to Task
    const assigned = await Task.findOneAndUpdate(
      { _id: task._id, status: "ASSIGNING" },
      {
        $set: {
          status: "ASSIGNED",
          driverId: driver._id,
          vehicleId: vehicle._id,
          assignmentScore: scoreData.totalScore,
          scoreBreakdown: scoreData.breakdown,
          assignedAt: new Date()
        }
      },
      { new: true }
    )
      .populate({ path: "driverId", populate: { path: "userId", select: "name email phone" } })
      .populate("vehicleId");

    if (!assigned) {
      await Vehicle.updateOne({ _id: vehicle._id }, { $set: { status: "AVAILABLE" } });
      await Driver.updateOne(
        { _id: driver._id },
        { $set: { availability: "AVAILABLE" }, $inc: { activeTaskCount: -1 } }
      );
      const err = new Error("Failed to finalize manual task assignment due to concurrent modification.");
      err.statusCode = 409;
      throw err;
    }

    // Record audit event
    await TaskEvent.create({
      taskId: task._id,
      type: "ASSIGNED",
      message: `Manually assigned to ${driver.userId?.name || "Driver"} (${vehicle.registrationNumber}) by ${user.name} (Score: ${scoreData.totalScore})`,
      metadata: {
        score: scoreData.totalScore,
        breakdown: scoreData.breakdown,
        explanation: scoreData.explanation,
        driverId: driver._id,
        vehicleId: vehicle._id,
        isManual: true,
        assignedBy: user._id
      },
      actorId: user._id,
      actorName: user.name
    });

    // Update Redis cache
    try {
      await safeSet(`driver:availability:${driver._id}`, "BUSY", "EX", 86400);
    } catch (err) {
      console.warn("Redis availability update warning:", err.message);
    }

    // Real-time socket events
    if (io) {
      io.to("dispatchers").emit("task:assigned", {
        task: assigned,
        driverId: driver._id,
        score: scoreData.totalScore,
        breakdown: scoreData.breakdown,
        isManual: true
      });
      io.to(`driver:${driver._id}`).emit("task:assigned", { task: assigned });
      if (driver.userId?._id) {
        io.to(`user:${driver.userId._id}`).emit("task:assigned", { task: assigned });
      }
    }

    return {
      success: true,
      task: assigned,
      driverId: driver._id,
      vehicleId: vehicle._id,
      score: scoreData.totalScore,
      breakdown: scoreData.breakdown,
      explanation: scoreData.explanation
    };
  } catch (err) {
    await Task.updateOne({ _id: task._id, status: "ASSIGNING" }, { $set: { status: "CREATED" } });
    throw err;
  }
}
