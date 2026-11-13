import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import Task from "../models/Task.js";
import TaskEvent from "../models/TaskEvent.js";
import { transitionTaskStatus, isTransitionAllowed, TASK_TRANSITIONS } from "../services/taskService.js";

async function runPhase2Tests() {
  console.log("============================================================");
  console.log("   FLEETFLOW PHASE 2: TASK LIFECYCLE & STATE MACHINE TESTS   ");
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
    // Fetch test users & drivers
    const dispatcher = await User.findOne({ email: "dispatch@fleetflow.demo" });
    const admin = await User.findOne({ email: "admin@fleetflow.demo" });
    const driverUser1 = await User.findOne({ email: "driver1@fleetflow.demo" });
    const driver1 = await Driver.findOne({ userId: driverUser1._id });
    
    // Find or create second driver for ownership testing
    let driverUser2 = await User.findOne({ email: "driver2@fleetflow.demo" });
    let driver2 = await Driver.findOne({ userId: driverUser2?._id });

    if (!driver2) {
      const driverUser2Doc = await User.create({
        name: "Driver Two Demo",
        email: "driver2@fleetflow.demo",
        passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
        role: "DRIVER"
      });
      driver2 = await Driver.create({
        userId: driverUser2Doc._id,
        licenseNumber: "DL-TEST-002",
        availability: "AVAILABLE",
        shiftStatus: "ACTIVE"
      });
      driverUser2 = driverUser2Doc;
    }

    // Vehicle for testing
    let testVehicle = await Vehicle.findOne({ status: "AVAILABLE" });
    if (!testVehicle) {
      testVehicle = await Vehicle.create({
        registrationNumber: "KA-09-TEST-999",
        type: "VAN",
        capacityKg: 1000,
        volumeM3: 6,
        status: "AVAILABLE"
      });
    }

    // ----------------------------------------------------
    // TEST 2.1: State Transition Matrix Integrity
    // ----------------------------------------------------
    console.log("\n--- TEST 2.1: Transition Matrix Rules & Permitted Roles ---");
    assert(isTransitionAllowed("CREATED", "ASSIGNED", "DISPATCHER"), "Dispatcher can transition CREATED -> ASSIGNED");
    assert(isTransitionAllowed("CREATED", "ASSIGNED", "ADMIN"), "Admin can transition CREATED -> ASSIGNED");
    assert(!isTransitionAllowed("CREATED", "ASSIGNED", "DRIVER"), "Driver CANNOT transition CREATED -> ASSIGNED");
    assert(isTransitionAllowed("ASSIGNED", "ACCEPTED", "DRIVER"), "Driver can transition ASSIGNED -> ACCEPTED");
    assert(!isTransitionAllowed("ASSIGNED", "ACCEPTED", "DISPATCHER"), "Dispatcher CANNOT transition ASSIGNED -> ACCEPTED (anti-impersonation)");
    assert(isTransitionAllowed("ASSIGNED", "REJECTED", "DRIVER"), "Driver can transition ASSIGNED -> REJECTED");
    assert(isTransitionAllowed("ACCEPTED", "PICKED_UP", "DRIVER"), "Driver can transition ACCEPTED -> PICKED_UP");
    assert(isTransitionAllowed("PICKED_UP", "IN_TRANSIT", "DRIVER"), "Driver can transition PICKED_UP -> IN_TRANSIT");
    assert(isTransitionAllowed("IN_TRANSIT", "DELIVERED", "DRIVER"), "Driver can transition IN_TRANSIT -> DELIVERED");
    assert(!isTransitionAllowed("DELIVERED", "IN_TRANSIT", "DRIVER"), "Terminal DELIVERED has no valid outward transitions");
    assert(!isTransitionAllowed("CANCELLED", "ACCEPTED", "DRIVER"), "Terminal CANCELLED has no valid outward transitions");
    assert(!isTransitionAllowed("CREATED", "DELIVERED", "DRIVER"), "Direct jump CREATED -> DELIVERED is forbidden");

    // ----------------------------------------------------
    // TEST 2.2: Anti-Impersonation Protection
    // ----------------------------------------------------
    console.log("\n--- TEST 2.2: Anti-Impersonation Enforcement ---");
    const testTask1 = await Task.create({
      title: "Anti-Impersonation Test Shipment",
      trackingNumber: `FF-TEST-${Date.now().toString().slice(-6)}`,
      pickup: { label: "Test Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Test Client", coordinates: [76.65, 12.31] },
      cargoKg: 200,
      requiredVehicleType: "VAN",
      status: "ASSIGNED",
      driverId: driver1._id,
      vehicleId: testVehicle._id
    });

    let dispatcherImpersonateBlocked = false;
    try {
      await transitionTaskStatus({
        taskId: testTask1._id,
        targetStatus: "ACCEPTED",
        user: dispatcher,
        driver: null
      });
    } catch (err) {
      if (err.statusCode === 403 && err.message.includes("cannot impersonate")) {
        dispatcherImpersonateBlocked = true;
      }
    }
    assert(dispatcherImpersonateBlocked, "Dispatcher is blocked (403) from impersonating driver on ACCEPTED");

    let adminImpersonateBlocked = false;
    try {
      await transitionTaskStatus({
        taskId: testTask1._id,
        targetStatus: "ACCEPTED",
        user: admin,
        driver: null
      });
    } catch (err) {
      if (err.statusCode === 403 && err.message.includes("cannot impersonate")) {
        adminImpersonateBlocked = true;
      }
    }
    assert(adminImpersonateBlocked, "Admin is blocked (403) from impersonating driver on ACCEPTED");

    // Also test admin blocked from DELIVERED on an IN_TRANSIT task
    const testTaskTransit = await Task.create({
      title: "Admin In-Transit Delivery Attempt",
      trackingNumber: `FF-TEST-${Date.now().toString().slice(-6)}-T`,
      pickup: { label: "Test Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Test Client", coordinates: [76.65, 12.31] },
      cargoKg: 200,
      requiredVehicleType: "VAN",
      status: "IN_TRANSIT",
      driverId: driver1._id,
      vehicleId: testVehicle._id
    });

    let adminTransitDeliverBlocked = false;
    try {
      await transitionTaskStatus({
        taskId: testTaskTransit._id,
        targetStatus: "DELIVERED",
        user: admin,
        driver: null
      });
    } catch (err) {
      if (err.statusCode === 403 && err.message.includes("cannot impersonate")) {
        adminTransitDeliverBlocked = true;
      }
    }
    assert(adminTransitDeliverBlocked, "Admin is blocked (403) from impersonating driver on DELIVERED");

    // ----------------------------------------------------
    // TEST 2.3: Zero-Trust Driver Ownership
    // ----------------------------------------------------
    console.log("\n--- TEST 2.3: Cross-Driver Tampering Protection ---");
    let crossDriverBlocked = false;
    try {
      await transitionTaskStatus({
        taskId: testTask1._id,
        targetStatus: "ACCEPTED",
        user: driverUser2,
        driver: driver2
      });
    } catch (err) {
      if (err.statusCode === 403 && err.message.includes("assigned to another driver")) {
        crossDriverBlocked = true;
      }
    }
    assert(crossDriverBlocked, "Driver 2 is blocked (403) from accepting Driver 1's shipment");

    // ----------------------------------------------------
    // TEST 2.4: Happy Path End-to-End Lifecycle
    // ----------------------------------------------------
    console.log("\n--- TEST 2.4: Complete Delivery Lifecycle (ASSIGNED -> DELIVERED) ---");
    // Initial state: Driver 1 accepts task 1
    const { task: acceptedTask, event: acceptEvent } = await transitionTaskStatus({
      taskId: testTask1._id,
      targetStatus: "ACCEPTED",
      user: driverUser1,
      driver: driver1
    });
    assert(acceptedTask.status === "ACCEPTED", "Task successfully advanced to ACCEPTED by assigned driver");
    assert(acceptedTask.acceptedAt instanceof Date, "acceptedAt timestamp recorded");
    assert(acceptEvent.type === "ACCEPTED", "Audit event ACCEPTED recorded");

    // Advance to PICKED_UP
    const { task: pickedUpTask } = await transitionTaskStatus({
      taskId: testTask1._id,
      targetStatus: "PICKED_UP",
      user: driverUser1,
      driver: driver1
    });
    assert(pickedUpTask.status === "PICKED_UP", "Task successfully advanced to PICKED_UP");
    assert(pickedUpTask.pickedUpAt instanceof Date, "pickedUpAt timestamp recorded");

    // Advance to IN_TRANSIT
    const { task: inTransitTask } = await transitionTaskStatus({
      taskId: testTask1._id,
      targetStatus: "IN_TRANSIT",
      user: driverUser1,
      driver: driver1
    });
    assert(inTransitTask.status === "IN_TRANSIT", "Task successfully advanced to IN_TRANSIT");

    // Advance to DELIVERED
    const initialDeliveries = driver1.totalDeliveries || 0;
    const { task: deliveredTask, event: deliverEvent } = await transitionTaskStatus({
      taskId: testTask1._id,
      targetStatus: "DELIVERED",
      user: driverUser1,
      driver: driver1
    });
    assert(deliveredTask.status === "DELIVERED", "Task successfully advanced to DELIVERED");
    assert(deliveredTask.deliveredAt instanceof Date, "deliveredAt timestamp recorded");
    assert(deliverEvent.type === "DELIVERED", "Audit event DELIVERED recorded");

    // Verify driver & vehicle release
    const updatedDriver = await Driver.findById(driver1._id);
    assert(updatedDriver.availability === "AVAILABLE", "Driver reset to AVAILABLE upon delivery");
    assert(updatedDriver.totalDeliveries === initialDeliveries + 1, "Driver totalDeliveries incremented by 1");

    // ----------------------------------------------------
    // TEST 2.5: Terminal State Immutability
    // ----------------------------------------------------
    console.log("\n--- TEST 2.5: Terminal State Protection ---");
    let deliveredMutationBlocked = false;
    try {
      await transitionTaskStatus({
        taskId: deliveredTask._id,
        targetStatus: "IN_TRANSIT",
        user: driverUser1,
        driver: driver1
      });
    } catch (err) {
      if (err.statusCode === 409) {
        deliveredMutationBlocked = true;
      }
    }
    assert(deliveredMutationBlocked, "Mutating a DELIVERED task is blocked (409 Conflict)");

    // ----------------------------------------------------
    // TEST 2.6: Driver Rejection Lifecycle
    // ----------------------------------------------------
    console.log("\n--- TEST 2.6: Driver Rejection & Resource Release ---");
    // Assign driver to a new test task
    const testTask2 = await Task.create({
      title: "Rejection Test Shipment",
      trackingNumber: `FF-TEST-${Date.now().toString().slice(-6)}-2`,
      pickup: { label: "Test Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Test Client", coordinates: [76.65, 12.31] },
      cargoKg: 150,
      requiredVehicleType: "VAN",
      status: "ASSIGNED",
      driverId: driver1._id,
      vehicleId: testVehicle._id
    });
    await Driver.updateOne({ _id: driver1._id }, { $set: { availability: "BUSY" }, $inc: { activeTaskCount: 1 } });
    await Vehicle.updateOne({ _id: testVehicle._id }, { $set: { status: "BUSY" } });

    const { task: rejectedTask, event: rejectEvent } = await transitionTaskStatus({
      taskId: testTask2._id,
      targetStatus: "REJECTED",
      user: driverUser1,
      driver: driver1,
      reason: "Vehicle mechanical check needed"
    });
    assert(rejectedTask.status === "REJECTED", "Task status is REJECTED");
    assert(rejectedTask.rejectionReason === "Vehicle mechanical check needed", "Rejection reason recorded");
    assert(rejectedTask.driverId === null, "Driver unlinked from rejected task");
    assert(rejectedTask.vehicleId === null, "Vehicle unlinked from rejected task");

    const driverAfterReject = await Driver.findById(driver1._id);
    const vehicleAfterReject = await Vehicle.findById(testVehicle._id);
    assert(driverAfterReject.availability === "AVAILABLE", "Driver released to AVAILABLE after rejection");
    assert(vehicleAfterReject.status === "AVAILABLE", "Vehicle released to AVAILABLE after rejection");
    assert(rejectEvent.type === "REJECTED", "Audit event REJECTED recorded in TaskEvent collection");

    // ----------------------------------------------------
    // TEST 2.7: Cancellation Lifecycle & Permissions
    // ----------------------------------------------------
    console.log("\n--- TEST 2.7: Cancellation Control & Role Boundaries ---");
    const testTask3 = await Task.create({
      title: "Cancellation Test Shipment",
      trackingNumber: `FF-TEST-${Date.now().toString().slice(-6)}-3`,
      pickup: { label: "Test Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Test Client", coordinates: [76.65, 12.31] },
      cargoKg: 100,
      requiredVehicleType: "VAN",
      status: "ASSIGNED",
      driverId: driver1._id,
      vehicleId: testVehicle._id
    });

    let driverCancelBlocked = false;
    try {
      await transitionTaskStatus({
        taskId: testTask3._id,
        targetStatus: "CANCELLED",
        user: driverUser1,
        driver: driver1
      });
    } catch (err) {
      if (err.statusCode === 403) {
        driverCancelBlocked = true;
      }
    }
    assert(driverCancelBlocked, "Driver is blocked (403) from cancelling a delivery task");

    const { task: cancelledTask } = await transitionTaskStatus({
      taskId: testTask3._id,
      targetStatus: "CANCELLED",
      user: dispatcher,
      reason: "Customer requested cancellation"
    });
    assert(cancelledTask.status === "CANCELLED", "Dispatcher successfully cancelled the delivery task");
    assert(cancelledTask.cancelledAt instanceof Date, "cancelledAt timestamp recorded");

    // ----------------------------------------------------
    // TEST 2.8: SLA Breach Detection (DELAYED State)
    // ----------------------------------------------------
    console.log("\n--- TEST 2.8: Exceptional State - SLA Breach (DELAYED) ---");
    const testTask4 = await Task.create({
      title: "SLA Delayed Test Shipment",
      trackingNumber: `FF-TEST-${Date.now().toString().slice(-6)}-4`,
      pickup: { label: "Test Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Test Client", coordinates: [76.65, 12.31] },
      cargoKg: 80,
      requiredVehicleType: "VAN",
      status: "ASSIGNED",
      driverId: driver1._id,
      vehicleId: testVehicle._id,
      deadline: new Date(Date.now() - 3600000) // 1 hour ago
    });

    const { task: delayedTask, event: delayedEvent } = await transitionTaskStatus({
      taskId: testTask4._id,
      targetStatus: "DELAYED",
      user: { role: "SYSTEM", name: "SLA Monitor" },
      reason: "Automated SLA breach detection: Deadline exceeded"
    });
    assert(delayedTask.status === "DELAYED", "Task transitioned to DELAYED state upon SLA breach");
    assert(delayedTask.delayedAt instanceof Date, "delayedAt timestamp recorded");
    assert(delayedEvent.type === "DELAYED", "TaskEvent record created for DELAYED state");

    // Clean up temporary test data
    await Task.deleteMany({ trackingNumber: { $regex: /^FF-TEST-/ } });
    await TaskEvent.deleteMany({ message: { $regex: /Test Shipment/i } });

    console.log("\n============================================================");
    console.log(`   PHASE 2 TESTS FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log("============================================================\n");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Unexpected error during Phase 2 tests:", err);
    process.exit(1);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase2Tests();
