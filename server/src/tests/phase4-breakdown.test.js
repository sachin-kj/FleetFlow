import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import Task from "../models/Task.js";
import TaskEvent from "../models/TaskEvent.js";
import Incident from "../models/Incident.js";
import { reportBreakdown, dispatchRecoveryUnit, resolveIncident } from "../services/incidentService.js";

async function runPhase4Tests() {
  console.log("============================================================");
  console.log("   FLEETFLOW PHASE 4: BREAKDOWN & RECOVERY CONSISTENCY TESTS ");
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

    // ----------------------------------------------------
    // Setup test vehicle and driver
    // ----------------------------------------------------
    const brokenVeh = await Vehicle.create({
      registrationNumber: `KA-09-BRK-${Date.now().toString().slice(-4)}`,
      type: "VAN",
      capacityKg: 800,
      volumeM3: 5.0,
      status: "AVAILABLE"
    });

    const brokenUser = await User.create({
      name: "Broken Vehicle Driver",
      email: `driver_brk_${Date.now()}@fleetflow.demo`,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
      role: "DRIVER"
    });

    const brokenDriver = await Driver.create({
      userId: brokenUser._id,
      vehicleId: brokenVeh._id,
      licenseNumber: `DL-BRK-${Date.now().toString().slice(-4)}`,
      availability: "AVAILABLE",
      shiftStatus: "ACTIVE",
      activeTaskCount: 2,
      currentLocation: { coordinates: [76.6450, 12.3100] }
    });
    await Vehicle.updateOne({ _id: brokenVeh._id }, { $set: { driverId: brokenDriver._id, status: "BUSY" } });

    // Task 1: Unpicked shipment (ACCEPTED)
    const unpickedTask = await Task.create({
      title: "Breakdown Unpicked Shipment",
      trackingNumber: `FF-BRK-UNP-${Date.now().toString().slice(-4)}`,
      pickup: { label: "Depot A", coordinates: [76.64, 12.30] },
      destination: { label: "Drop A", coordinates: [76.66, 12.32] },
      cargoKg: 200,
      requiredVehicleType: "VAN",
      status: "ACCEPTED",
      driverId: brokenDriver._id,
      vehicleId: brokenVeh._id
    });

    // Task 2: In-transit shipment (IN_TRANSIT) - cargo physically loaded in vehicle!
    const inTransitTask = await Task.create({
      title: "Breakdown In-Transit Shipment",
      trackingNumber: `FF-BRK-TRN-${Date.now().toString().slice(-4)}`,
      pickup: { label: "Depot B", coordinates: [76.64, 12.30] },
      destination: { label: "Drop B", coordinates: [76.68, 12.34] },
      cargoKg: 350,
      requiredVehicleType: "VAN",
      status: "IN_TRANSIT",
      pickedUpAt: new Date(Date.now() - 1800000),
      driverId: brokenDriver._id,
      vehicleId: brokenVeh._id
    });

    // ----------------------------------------------------
    // TEST 4.1: Breakdown Reporting & Resource State Update
    // ----------------------------------------------------
    console.log("\n--- TEST 4.1: Breakdown Triage & Resource Status Updates ---");
    const breakdownResult = await reportBreakdown(brokenVeh._id, null, {
      type: "ENGINE_FAILURE",
      severity: "CRITICAL",
      description: "Severe engine overheating and radiator failure on Ring Road",
      coordinates: [76.6450, 12.3100],
      reportedByName: dispatcher.name
    });

    const updatedVehicle = await Vehicle.findById(brokenVeh._id);
    const updatedDriver = await Driver.findById(brokenDriver._id);

    assert(updatedVehicle.status === "BREAKDOWN", "Vehicle marked BREAKDOWN");
    assert(updatedDriver.availability === "OFFLINE", "Assigned driver transitioned to OFFLINE");
    assert(breakdownResult.incident.status === "OPEN", "Incident created in OPEN status");
    assert(breakdownResult.incident.severity === "CRITICAL", "Incident severity recorded as CRITICAL");
    assert(breakdownResult.incident.recoveryActions.length >= 1, "Incident recorded initial BREAKDOWN_REPORTED action");

    // ----------------------------------------------------
    // TEST 4.2: Cargo Triage Separation (Unpicked vs In-Transit)
    // ----------------------------------------------------
    console.log("\n--- TEST 4.2: Safe Unassignment vs Cargo Stranded Protection ---");
    const afterUnpicked = await Task.findById(unpickedTask._id);
    const afterInTransit = await Task.findById(inTransitTask._id);

    // Unpicked task should NOT remain with broken vehicle
    assert(
      ["CREATED", "ASSIGNED"].includes(afterUnpicked.status),
      `Unpicked task safely removed from disabled vehicle (Status: ${afterUnpicked.status})`
    );
    if (afterUnpicked.status === "CREATED") {
      assert(afterUnpicked.driverId === null, "Unpicked task driverId unlinked");
      assert(afterUnpicked.vehicleId === null, "Unpicked task vehicleId unlinked");
    }

    // In-transit task MUST NOT be blindly reassigned: marked RECOVERY_REQUIRED
    assert(
      afterInTransit.status === "RECOVERY_REQUIRED",
      "In-transit task with physical cargo strictly marked RECOVERY_REQUIRED"
    );
    assert(
      afterInTransit.notes.includes("GPS coordinates"),
      "Stranded GPS coordinates appended to recovery task notes"
    );
    assert(
      afterInTransit.driverId.toString() === brokenDriver._id.toString(),
      "Cargo physical custody remains linked to breakdown incident until recovery transfer"
    );

    // Workload count verification: 1 unpicked task decremented, 1 in-transit stranded task remains
    const driverAfterTriage = await Driver.findById(brokenDriver._id);
    assert(
      driverAfterTriage.activeTaskCount === 1,
      `Broken driver activeTaskCount accurately reflects only stranded cargo (Expected: 1, Actual: ${driverAfterTriage.activeTaskCount})`
    );

    // ----------------------------------------------------
    // TEST 4.3: Physical Recovery Dispatch
    // ----------------------------------------------------
    console.log("\n--- TEST 4.3: Physical Cargo Recovery Dispatch ---");
    // Create recovery vehicle and recovery driver
    const recoveryVeh = await Vehicle.create({
      registrationNumber: `KA-09-RCV-${Date.now().toString().slice(-4)}`,
      type: "VAN",
      capacityKg: 1000,
      volumeM3: 6.0,
      status: "AVAILABLE"
    });

    const recoveryUser = await User.create({
      name: "Cargo Recovery Specialist",
      email: `driver_rcv_${Date.now()}@fleetflow.demo`,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
      role: "DRIVER"
    });

    const recoveryDriver = await Driver.create({
      userId: recoveryUser._id,
      vehicleId: recoveryVeh._id,
      licenseNumber: `DL-RCV-${Date.now().toString().slice(-4)}`,
      availability: "AVAILABLE",
      shiftStatus: "ACTIVE",
      activeTaskCount: 0,
      currentLocation: { coordinates: [76.6400, 12.3000] }
    });
    await Vehicle.updateOne({ _id: recoveryVeh._id }, { $set: { driverId: recoveryDriver._id } });

    // Under-capacity recovery vehicle should be rejected
    const smallRecoveryVeh = await Vehicle.create({
      registrationNumber: `KA-09-RCV-SM-${Date.now().toString().slice(-4)}`,
      type: "VAN",
      capacityKg: 100, // 100 < 350 kg cargo
      volumeM3: 1.0,
      status: "AVAILABLE"
    });
    const smallUser = await User.create({
      name: "Small Capacity Driver",
      email: `driver_sm_${Date.now()}@fleetflow.demo`,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
      role: "DRIVER"
    });
    const smallDriver = await Driver.create({
      userId: smallUser._id,
      vehicleId: smallRecoveryVeh._id,
      licenseNumber: `DL-SM-${Date.now().toString().slice(-4)}`,
      availability: "AVAILABLE",
      shiftStatus: "ACTIVE",
      activeTaskCount: 0
    });

    let recoveryCapacityBlocked = false;
    try {
      await dispatchRecoveryUnit({
        taskId: afterInTransit._id,
        recoveryDriverId: smallDriver._id,
        user: dispatcher,
        incidentId: breakdownResult.incident._id
      });
    } catch (err) {
      if (err.statusCode === 422 && err.message.includes("insufficient")) {
        recoveryCapacityBlocked = true;
      }
    }
    assert(recoveryCapacityBlocked, "Recovery vehicle with insufficient capacity is rejected (422)");

    // Valid recovery dispatch
    const recoveryResult = await dispatchRecoveryUnit({
      taskId: afterInTransit._id,
      recoveryDriverId: recoveryDriver._id,
      user: dispatcher,
      incidentId: breakdownResult.incident._id,
      recoveryNotes: "Cargo transferred safely at breakdown site. Transponder verified."
    });

    assert(recoveryResult.success === true, "Physical recovery unit dispatched successfully");
    assert(recoveryResult.task.status === "IN_TRANSIT", "Recovered task resumed to IN_TRANSIT");
    assert(
      recoveryResult.task.driverId.toString() === recoveryDriver._id.toString(),
      "Custody transferred to recovery driver"
    );
    assert(
      recoveryResult.task.vehicleId.toString() === recoveryVeh._id.toString(),
      "Custody transferred to recovery vehicle"
    );

    // Verify workload counts after recovery handoff
    const brokenDriverAfterRecovery = await Driver.findById(brokenDriver._id);
    const recoveryDriverAfterRecovery = await Driver.findById(recoveryDriver._id);
    assert(
      brokenDriverAfterRecovery.activeTaskCount === 0,
      "Broken driver activeTaskCount decremented to 0 following recovery custody handoff"
    );
    assert(
      recoveryDriverAfterRecovery.activeTaskCount === 1,
      "Recovery driver activeTaskCount incremented to 1"
    );

    // Verify incident recovery actions audit trail
    const updatedIncident = await Incident.findById(breakdownResult.incident._id);
    const cargoAction = updatedIncident.recoveryActions.find(a => a.action === "CARGO_RECOVERED");
    assert(cargoAction !== undefined, "CARGO_RECOVERED action recorded in Incident recoveryActions");
    assert(
      cargoAction.recoveryDriverId.toString() === recoveryDriver._id.toString(),
      "Recovery driver ID recorded in incident recovery action audit log"
    );

    // ----------------------------------------------------
    // TEST 4.4: Incident Resolution & Return to Service
    // ----------------------------------------------------
    console.log("\n--- TEST 4.4: Incident Resolution & Fleet Depot Clearance ---");
    const resolvedIncident = await resolveIncident(
      breakdownResult.incident._id,
      {
        resolutionNotes: "Engine overhaul complete at Depot 2. New coolant system installed.",
        returnVehicleToService: true
      },
      dispatcher
    );

    assert(resolvedIncident.status === "RESOLVED", "Incident status updated to RESOLVED");
    assert(resolvedIncident.resolvedAt instanceof Date, "resolvedAt timestamp recorded");

    const vehicleAfterFix = await Vehicle.findById(brokenVeh._id);
    assert(vehicleAfterFix.status === "AVAILABLE", "Vehicle status restored to AVAILABLE");
    assert(vehicleAfterFix.lastMaintenanceDate instanceof Date, "Vehicle lastMaintenanceDate updated");

    const driverAfterFix = await Driver.findById(brokenDriver._id);
    assert(driverAfterFix.availability === "AVAILABLE", "Driver restored to AVAILABLE upon resolution");

    // Clean up temporary documents
    await Task.deleteMany({ trackingNumber: { $regex: /^FF-BRK-/ } });
    await TaskEvent.deleteMany({ message: { $regex: /KA-09-BRK|KA-09-RCV/i } });
    await Incident.deleteOne({ _id: breakdownResult.incident._id });
    await Driver.deleteMany({ _id: { $in: [brokenDriver._id, recoveryDriver._id, smallDriver._id] } });
    await Vehicle.deleteMany({ _id: { $in: [brokenVeh._id, recoveryVeh._id, smallRecoveryVeh._id] } });
    await User.deleteMany({ _id: { $in: [brokenUser._id, recoveryUser._id, smallUser._id] } });

    console.log("\n============================================================");
    console.log(`   PHASE 4 TESTS FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log("============================================================\n");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Unexpected error during Phase 4 tests:", err);
    process.exit(1);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase4Tests();
