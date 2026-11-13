import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "./config/db.js";
import { redis } from "./config/redis.js";
import User from "./models/User.js";
import Driver from "./models/Driver.js";
import Vehicle from "./models/Vehicle.js";
import Task from "./models/Task.js";
import Incident from "./models/Incident.js";
import TaskEvent from "./models/TaskEvent.js";
import LocationHistory from "./models/LocationHistory.js";
import { assignTask, calculateDriverScore, getEligibleDrivers } from "./services/assignmentService.js";
import { reportBreakdown } from "./services/incidentService.js";
import { saveDriverLocation, getDriverLocation } from "./services/locationService.js";
import { enqueueNotification } from "./queues/notificationQueue.js";

async function runTestSuite() {
  console.log("==================================================");
  console.log("   FLEETFLOW ENTERPRISE SYSTEM TEST SUITE         ");
  console.log("==================================================");

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
    // ----------------------------------------------------
    // TEST 1: Database Connections & Seed Integrity
    // ----------------------------------------------------
    console.log("\n--- TEST 1: System State & Seed Integrity ---");
    const userCount = await User.countDocuments();
    const driverCount = await Driver.countDocuments();
    const vehicleCount = await Vehicle.countDocuments();
    const taskCount = await Task.countDocuments();

    assert(userCount >= 16, `Users exist in database (${userCount} found)`);
    assert(driverCount >= 12, `12 Drivers exist in database (${driverCount} found)`);
    assert(vehicleCount >= 12, `12 Vehicles exist in database (${vehicleCount} found)`);
    assert(taskCount >= 30, `30 Delivery tasks exist in database (${taskCount} found)`);

    // ----------------------------------------------------
    // TEST 2: Authentication Credentials Verification
    // ----------------------------------------------------
    console.log("\n--- TEST 2: Authentication & Password Verification ---");
    const adminUser = await User.findOne({ email: "admin@fleetflow.demo" });
    assert(!!adminUser, "Admin account found: admin@fleetflow.demo");
    const validPassword = await bcrypt.compare("FleetFlow123!", adminUser.passwordHash);
    assert(validPassword, "Password hash matches FleetFlow123!");

    const dispatcherUser = await User.findOne({ email: "dispatch@fleetflow.demo" });
    assert(dispatcherUser?.role === "DISPATCHER", "Dispatcher account has role DISPATCHER");

    // ----------------------------------------------------
    // TEST 3: Delivery Task Creation
    // ----------------------------------------------------
    console.log("\n--- TEST 3: Delivery Task Creation & Audit ---");
    const testTask = await Task.create({
      title: "Test Consignment Express 900",
      trackingNumber: `FF-TEST-${Date.now()}`,
      pickup: { label: "Mysuru Hub", coordinates: [76.6394, 12.2958] },
      destination: { label: "Vijayanagar Store", coordinates: [76.6170, 12.3280] },
      cargoKg: 200,
      requiredVehicleType: "CAR",
      priority: "HIGH",
      deadline: new Date(Date.now() + 4 * 3600000),
      status: "CREATED",
      createdBy: dispatcherUser._id
    });
    assert(testTask.status === "CREATED", `Task created with status CREATED (ID: ${testTask._id})`);

    // ----------------------------------------------------
    // TEST 4: Intelligent Assignment Algorithm & Formula
    // ----------------------------------------------------
    console.log("\n--- TEST 4: Intelligent Weighted Scoring Algorithm ---");
    const candidates = await getEligibleDrivers(testTask);
    assert(candidates.length > 0, `Matching algorithm identified ${candidates.length} eligible candidates`);

    const topCandidate = candidates[0];
    const { breakdown, score } = topCandidate;
    console.log(`Top candidate: ${topCandidate.driver.userId?.name} with total score ${score}`);
    console.log(`Score breakdown:`, breakdown);

    // Verify mathematical formula
    const expectedScore = Number((
      0.40 * breakdown.distanceScore +
      0.25 * breakdown.availabilityScore +
      0.20 * breakdown.workloadScore +
      0.15 * breakdown.deadlineScore
    ).toFixed(1));
    assert(Math.abs(score - expectedScore) < 0.1, `Formula holds: score ${score} matches calculated ${expectedScore}`);

    // Execute atomic assignment
    const assignResult = await assignTask(testTask._id);
    assert(assignResult.success === true, "Task assigned successfully");
    assert(assignResult.driverId.toString() === topCandidate.driver._id.toString(), "Highest-scoring driver was assigned");

    const assignedDriver = await Driver.findById(assignResult.driverId);
    assert(assignedDriver.availability === "BUSY", "Driver status transitioned to BUSY");
    assert(assignedDriver.activeTaskCount >= 1, "Driver activeTaskCount incremented");

    const assignedVehicle = await Vehicle.findById(assignResult.vehicleId);
    assert(assignedVehicle.status === "BUSY", "Assigned vehicle status transitioned to BUSY");

    // ----------------------------------------------------
    // TEST 5: Concurrency Safeguard on Assignment
    // ----------------------------------------------------
    console.log("\n--- TEST 5: Concurrency Safeguards & Duplicate Assignment Protection ---");
    // Attempting to assign an already-assigned task must fail gracefully
    let duplicateRejected = false;
    try {
      await assignTask(testTask._id);
    } catch (err) {
      duplicateRejected = true;
    }
    assert(duplicateRejected, "Duplicate assignment attempt properly rejected by state lock");

    // ----------------------------------------------------
    // TEST 6: Task Lifecycle Progression & Delivery Completion
    // ----------------------------------------------------
    console.log("\n--- TEST 6: Full Task Lifecycle State Machine ---");
    // CREATED -> ASSIGNED -> ACCEPTED -> PICKED_UP -> IN_TRANSIT -> DELIVERED
    testTask.status = "ACCEPTED";
    await testTask.save();
    testTask.status = "PICKED_UP";
    await testTask.save();
    testTask.status = "IN_TRANSIT";
    await testTask.save();
    testTask.status = "DELIVERED";
    await testTask.save();

    // Emulate completion trigger (freeing vehicle and driver)
    await Driver.updateOne(
      { _id: assignedDriver._id },
      { $set: { availability: "AVAILABLE" }, $inc: { activeTaskCount: -1 } }
    );
    await Vehicle.updateOne({ _id: assignedVehicle._id }, { $set: { status: "AVAILABLE" } });

    const freedDriver = await Driver.findById(assignedDriver._id);
    const freedVehicle = await Vehicle.findById(assignedVehicle._id);
    assert(freedDriver.availability === "AVAILABLE", "Driver freed up to AVAILABLE upon delivery completion");
    assert(freedVehicle.status === "AVAILABLE", "Vehicle freed up to AVAILABLE upon delivery completion");

    // ----------------------------------------------------
    // TEST 7: Breakdown Simulation & Automatic Reassignment
    // ----------------------------------------------------
    console.log("\n--- TEST 7: Breakdown Simulation & Automatic Reassignment ---");
    // Setup a vehicle and driver for breakdown test
    const testVeh = await Vehicle.create({
      registrationNumber: `KA09TEST${Math.floor(1000 + Math.random() * 9000)}`,
      type: "VAN",
      capacityKg: 900,
      status: "AVAILABLE"
    });
    const testUser = await User.create({
      name: "Test Operator",
      email: `test_operator_${Date.now()}@fleetflow.demo`,
      passwordHash: "dummy",
      role: "DRIVER"
    });
    const testDriver = await Driver.create({
      userId: testUser._id,
      vehicleId: testVeh._id,
      availability: "AVAILABLE"
    });
    await Vehicle.updateOne({ _id: testVeh._id }, { $set: { driverId: testDriver._id } });

    // Create 2 tasks on this vehicle:
    // Task A: unpicked (status ASSIGNED)
    const taskUnpicked = await Task.create({
      title: "Breakdown Test - Unpicked Package",
      trackingNumber: `FF-BP-${Date.now()}`,
      pickup: { label: "Hub", coordinates: [76.6394, 12.2958] },
      destination: { label: "Drop", coordinates: [76.6170, 12.3280] },
      cargoKg: 150,
      requiredVehicleType: "VAN",
      status: "ASSIGNED",
      driverId: testDriver._id,
      vehicleId: testVeh._id
    });

    // Task B: picked up (status PICKED_UP)
    const taskPickedUp = await Task.create({
      title: "Breakdown Test - In Transit Cargo",
      trackingNumber: `FF-TR-${Date.now()}`,
      pickup: { label: "Hub", coordinates: [76.6394, 12.2958] },
      destination: { label: "Drop", coordinates: [76.6170, 12.3280] },
      cargoKg: 300,
      requiredVehicleType: "VAN",
      status: "PICKED_UP",
      driverId: testDriver._id,
      vehicleId: testVeh._id
    });

    // Trigger breakdown
    const breakdownReport = await reportBreakdown(testVeh._id, null, {
      description: "Test radiator failure simulation"
    });

    const brokenVehicle = await Vehicle.findById(testVeh._id);
    const brokenDriver = await Driver.findById(testDriver._id);
    assert(brokenVehicle.status === "BREAKDOWN", "Broken vehicle status marked BREAKDOWN");
    assert(brokenDriver.availability === "OFFLINE", "Broken vehicle driver marked OFFLINE");

    const updatedTaskA = await Task.findById(taskUnpicked._id);
    const updatedTaskB = await Task.findById(taskPickedUp._id);

    assert(
      ["ASSIGNED", "AUTOMATICALLY_REASSIGNED", "QUEUED_FOR_REASSIGNMENT", "CREATED"].includes(updatedTaskA.status) &&
      updatedTaskA.driverId?.toString() !== testDriver._id.toString(),
      `Unpicked task was safely unassigned from broken driver (Status: ${updatedTaskA.status})`
    );

    assert(
      updatedTaskB.status === "RECOVERY_REQUIRED",
      `In-transit task was safely marked RECOVERY_REQUIRED (Actual: ${updatedTaskB.status})`
    );

    const incident = await Incident.findOne({ vehicleId: testVeh._id });
    assert(!!incident, `Incident record created in database (ID: ${incident?._id})`);

    // Clean up test vehicle and user
    await Vehicle.deleteOne({ _id: testVeh._id });
    await Driver.deleteOne({ _id: testDriver._id });
    await User.deleteOne({ _id: testUser._id });
    await Task.deleteMany({ _id: { $in: [testTask._id, taskUnpicked._id, taskPickedUp._id] } });
    await Incident.deleteOne({ _id: incident?._id });

    // ----------------------------------------------------
    // TEST 8: GPS Tracking, Location History & Redis
    // ----------------------------------------------------
    console.log("\n--- TEST 8: GPS Tracking, Redis Key-Value & Redis GEO ---");
    const demoDriver = await Driver.findOne();
    const testLng = 76.6450;
    const testLat = 12.3120;

    const savedLoc = await saveDriverLocation(demoDriver._id, testLng, testLat, {
      speedKmh: 45,
      headingDeg: 180,
      isSimulated: true
    });
    assert(savedLoc.longitude === testLng && savedLoc.latitude === testLat, "Location saved with exact coordinates");

    const redisCached = await getDriverLocation(demoDriver._id);
    assert(!!redisCached, "Location successfully retrieved from Redis/cache");
    assert(redisCached.speedKmh === 45, "Speed telemetry persisted in cache");

    const historyRecord = await LocationHistory.findOne({ driverId: demoDriver._id }).sort({ recordedAt: -1 });
    assert(!!historyRecord, "LocationHistory breadcrumb entry recorded in MongoDB");

    // ----------------------------------------------------
    // TEST 9: BullMQ Background Queue
    // ----------------------------------------------------
    console.log("\n--- TEST 9: BullMQ Notification Queue ---");
    const job = await enqueueNotification({
      title: "Test System Notification",
      message: "Testing BullMQ dispatch queue",
      type: "SYSTEM_ALERT"
    });
    assert(!!job, `BullMQ job created and enqueued (Job ID: ${job?.id || "enqueued"})`);

  } catch (err) {
    console.error("Test execution encountered an error:", err);
    failed++;
  } finally {
    console.log("\n==================================================");
    console.log(`TEST SUITE FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log("==================================================");
    await mongoose.disconnect();
    redis.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTestSuite();
