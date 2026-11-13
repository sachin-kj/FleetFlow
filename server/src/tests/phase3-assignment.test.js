import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import Task from "../models/Task.js";
import TaskEvent from "../models/TaskEvent.js";
import {
  calculateDriverScore,
  validateDriverEligibility,
  getEligibleDrivers,
  assignTask,
  manualAssignTask,
  haversineDistanceKm
} from "../services/assignmentService.js";

async function runPhase3Tests() {
  console.log("============================================================");
  console.log("   FLEETFLOW PHASE 3: ASSIGNMENT ENGINE & CONCURRENCY TESTS  ");
  console.log("============================================================");

  await connectDB();

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  try {
    const dispatcher = await User.findOne({ email: "dispatch@fleetflow.demo" });
    const admin = await User.findOne({ email: "admin@fleetflow.demo" });

    // ----------------------------------------------------
    // TEST 3.1: Distance Calculation Precision
    // ----------------------------------------------------
    console.log("\n--- TEST 3.1: Geospatial Haversine Distance Calculation ---");
    // Mysuru Palace [76.6552, 12.3051] to KRS Dam [76.5724, 12.4248] ~ 15.9 km
    const dist = haversineDistanceKm([76.6552, 12.3051], [76.5724, 12.4248]);
    assert(dist > 14 && dist < 18, `Haversine distance accurate within expected bounds (${dist.toFixed(2)} km)`);
    assert(haversineDistanceKm([76.65, 12.30], [76.65, 12.30]) === 0, "Distance between identical points is 0 km");

    // ----------------------------------------------------
    // TEST 3.2: Eligibility Engine Parity - Boundary Conditions
    // ----------------------------------------------------
    console.log("\n--- TEST 3.2: Unified Eligibility Engine Validation ---");
    const testTask = {
      cargoKg: 400,
      volumeM3: 2.5,
      requiredVehicleType: "VAN",
      pickup: { coordinates: [76.6394, 12.2958] },
      deadline: new Date(Date.now() + 3 * 3600000)
    };

    const validVehicle = {
      _id: new mongoose.Types.ObjectId(),
      registrationNumber: "KA-09-TEST-VALID",
      type: "VAN",
      capacityKg: 800,
      volumeM3: 5.0,
      status: "AVAILABLE"
    };

    const validDriver = {
      _id: new mongoose.Types.ObjectId(),
      availability: "AVAILABLE",
      shiftStatus: "ACTIVE",
      activeTaskCount: 0,
      currentLocation: { coordinates: [76.6400, 12.3000] }
    };

    // Valid case
    const validCheck = validateDriverEligibility(validDriver, validVehicle, testTask);
    assert(validCheck.eligible === true, "Eligible driver & vehicle pass all criteria");

    // Driver unavailable
    const busyDriver = { ...validDriver, availability: "BUSY" };
    const busyCheck = validateDriverEligibility(busyDriver, validVehicle, testTask);
    assert(busyCheck.eligible === false && busyCheck.issues.some(i => i.includes("BUSY")), "BUSY driver rejected with explicit issue reason");

    // Driver on offline shift
    const inactiveDriver = { ...validDriver, shiftStatus: "INACTIVE" };
    const inactiveCheck = validateDriverEligibility(inactiveDriver, validVehicle, testTask);
    assert(inactiveCheck.eligible === false && inactiveCheck.issues.some(i => i.includes("INACTIVE")), "INACTIVE shift driver rejected");

    // Workload limit >= 3
    const overloadedDriver = { ...validDriver, activeTaskCount: 3 };
    const overloadedCheck = validateDriverEligibility(overloadedDriver, validVehicle, testTask);
    assert(overloadedCheck.eligible === false && overloadedCheck.issues.some(i => i.includes("workload")), "Driver with 3 active tasks rejected by workload cap");

    // Vehicle breakdown
    const brokenVehicle = { ...validVehicle, status: "BREAKDOWN" };
    const brokenCheck = validateDriverEligibility(validDriver, brokenVehicle, testTask);
    assert(brokenCheck.eligible === false && brokenCheck.issues.some(i => i.includes("BREAKDOWN")), "Vehicle in BREAKDOWN status rejected");

    // Weight capacity insufficient
    const smallVehicle = { ...validVehicle, capacityKg: 300 }; // 300 < 400
    const weightCheck = validateDriverEligibility(validDriver, smallVehicle, testTask);
    assert(weightCheck.eligible === false && weightCheck.issues.some(i => i.includes("insufficient")), "Under-capacity vehicle rejected for heavy cargo");

    // Vehicle type mismatch (requires VAN, given BIKE)
    const bikeVehicle = { ...validVehicle, type: "BIKE", capacityKg: 50 };
    const typeCheck = validateDriverEligibility(validDriver, bikeVehicle, testTask);
    assert(typeCheck.eligible === false && typeCheck.issues.some(i => i.includes("mismatch")), "Vehicle type mismatch rejected");

    // ----------------------------------------------------
    // TEST 3.3: Transparent Scoring Formula
    // ----------------------------------------------------
    console.log("\n--- TEST 3.3: Scoring Formula & Explanation Transparency ---");
    const scoreResult = calculateDriverScore(validDriver, testTask);
    assert(scoreResult.totalScore >= 0 && scoreResult.totalScore <= 100, `Score is in valid range 0-100 (${scoreResult.totalScore})`);
    assert(typeof scoreResult.explanation === "string" && scoreResult.explanation.length > 20, "Human-readable assignment explanation provided");
    assert(scoreResult.breakdown.distanceScore !== undefined, "Breakdown includes distanceScore");
    assert(scoreResult.breakdown.availabilityScore === 100, "Breakdown includes availabilityScore (100 for AVAILABLE)");
    assert(scoreResult.breakdown.workloadScore === 100, "Breakdown includes workloadScore (100 for 0 active tasks)");
    assert(scoreResult.breakdown.deadlineScore !== undefined, "Breakdown includes deadlineScore");

    const manualSum = Number((
      0.40 * scoreResult.breakdown.distanceScore +
      0.25 * scoreResult.breakdown.availabilityScore +
      0.20 * scoreResult.breakdown.workloadScore +
      0.15 * scoreResult.breakdown.deadlineScore
    ).toFixed(1));
    assert(Math.abs(manualSum - scoreResult.totalScore) < 0.2, `Score strictly matches formula weighted sum (${scoreResult.totalScore} vs ${manualSum})`);

    // ----------------------------------------------------
    // TEST 3.4: Manual Assignment Validation Parity & Execution
    // ----------------------------------------------------
    console.log("\n--- TEST 3.4: Manual Assignment Parity & Execution ---");
    // Create dedicated test vehicle and driver
    const testVehDoc = await Vehicle.create({
      registrationNumber: `KA-09-PH3-${Date.now().toString().slice(-4)}`,
      type: "VAN",
      capacityKg: 500,
      volumeM3: 4.0,
      status: "AVAILABLE"
    });

    const testUserDoc = await User.create({
      name: "Phase3 Test Driver",
      email: `driver_ph3_${Date.now()}@fleetflow.demo`,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
      role: "DRIVER"
    });

    const testDriverDoc = await Driver.create({
      userId: testUserDoc._id,
      vehicleId: testVehDoc._id,
      licenseNumber: `DL-PH3-${Date.now().toString().slice(-4)}`,
      availability: "AVAILABLE",
      shiftStatus: "ACTIVE",
      activeTaskCount: 0,
      currentLocation: { coordinates: [76.64, 12.30] }
    });
    await Vehicle.updateOne({ _id: testVehDoc._id }, { $set: { driverId: testDriverDoc._id } });

    // Test Task exceeding capacity (600 kg > 500 kg capacity)
    const overweightTask = await Task.create({
      title: "Overweight Test Task",
      trackingNumber: `FF-PH3-OW-${Date.now().toString().slice(-4)}`,
      pickup: { label: "Test Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Test Drop", coordinates: [76.65, 12.31] },
      cargoKg: 600,
      requiredVehicleType: "VAN",
      status: "CREATED"
    });

    let manualParityBlocked = false;
    try {
      await manualAssignTask({
        taskId: overweightTask._id,
        driverId: testDriverDoc._id,
        user: dispatcher
      });
    } catch (err) {
      if (err.statusCode === 422 && err.message.includes("insufficient")) {
        manualParityBlocked = true;
      }
    }
    assert(manualParityBlocked, "Manual assignment rejected with 422 when vehicle capacity is insufficient (parity with auto-assign)");

    // Test Valid Manual Assignment (400 kg <= 500 kg)
    const validManualTask = await Task.create({
      title: "Valid Manual Test Task",
      trackingNumber: `FF-PH3-OK-${Date.now().toString().slice(-4)}`,
      pickup: { label: "Test Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Test Drop", coordinates: [76.65, 12.31] },
      cargoKg: 400,
      requiredVehicleType: "VAN",
      status: "CREATED"
    });

    const manualResult = await manualAssignTask({
      taskId: validManualTask._id,
      driverId: testDriverDoc._id,
      user: dispatcher
    });
    assert(manualResult.success === true, "Manual assignment succeeded for eligible driver");
    assert(manualResult.task.status === "ASSIGNED", "Task transitioned to ASSIGNED");
    assert(manualResult.score > 0, "Calculated score persisted on manual assignment");
    assert(manualResult.breakdown !== undefined, "Score breakdown stored on task");

    const driverAfterAssign = await Driver.findById(testDriverDoc._id);
    const vehicleAfterAssign = await Vehicle.findById(testVehDoc._id);
    assert(driverAfterAssign.availability === "BUSY", "Driver transitioned to BUSY upon manual assignment");
    assert(driverAfterAssign.activeTaskCount === 1, "Driver activeTaskCount incremented to 1");
    assert(vehicleAfterAssign.status === "BUSY", "Vehicle transitioned to BUSY upon manual assignment");

    // ----------------------------------------------------
    // TEST 3.5: Concurrency - Race Conditions & Double Allocations
    // ----------------------------------------------------
    console.log("\n--- TEST 3.5: Concurrency & Atomic Locking Safeguards ---");
    // Free the driver & vehicle back to AVAILABLE for concurrency test
    await Driver.updateOne({ _id: testDriverDoc._id }, { $set: { availability: "AVAILABLE", activeTaskCount: 0 } });
    await Vehicle.updateOne({ _id: testVehDoc._id }, { $set: { status: "AVAILABLE" } });

    // Create 2 concurrent tasks competing for the single available driver
    const concTaskA = await Task.create({
      title: "Concurrent Task A",
      trackingNumber: `FF-CONC-A-${Date.now()}`,
      pickup: { label: "Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Drop", coordinates: [76.65, 12.31] },
      cargoKg: 200,
      requiredVehicleType: "VAN",
      status: "CREATED"
    });

    const concTaskB = await Task.create({
      title: "Concurrent Task B",
      trackingNumber: `FF-CONC-B-${Date.now()}`,
      pickup: { label: "Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Drop", coordinates: [76.65, 12.31] },
      cargoKg: 200,
      requiredVehicleType: "VAN",
      status: "CREATED"
    });

    // Run both manual assignments simultaneously with Promise.allSettled
    const [resultA, resultB] = await Promise.allSettled([
      manualAssignTask({ taskId: concTaskA._id, driverId: testDriverDoc._id, user: dispatcher }),
      manualAssignTask({ taskId: concTaskB._id, driverId: testDriverDoc._id, user: dispatcher })
    ]);

    const successes = [resultA, resultB].filter(r => r.status === "fulfilled");
    const rejections = [resultA, resultB].filter(r => r.status === "rejected");

    assert(successes.length === 1, `Exactly 1 concurrent request succeeded (actual: ${successes.length})`);
    assert(rejections.length === 1, `Exactly 1 concurrent request was rejected (actual: ${rejections.length})`);
    assert(rejections[0].reason.statusCode === 409 || rejections[0].reason.statusCode === 422, "Rejected concurrent request returned proper conflict status");

    const finalDriver = await Driver.findById(testDriverDoc._id);
    assert(finalDriver.activeTaskCount === 1, "Driver activeTaskCount is exactly 1 (no double increment)");

    // Clean up temporary documents
    await Task.deleteMany({ trackingNumber: { $regex: /^FF-(PH3|CONC)-/ } });
    await TaskEvent.deleteMany({ message: { $regex: /Phase3|Concurrent/i } });
    await Driver.deleteOne({ _id: testDriverDoc._id });
    await Vehicle.deleteOne({ _id: testVehDoc._id });
    await User.deleteOne({ _id: testUserDoc._id });

    console.log("\n============================================================");
    console.log(`   PHASE 3 TESTS FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log("============================================================\n");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Unexpected error during Phase 3 tests:", err);
    process.exit(1);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase3Tests();
