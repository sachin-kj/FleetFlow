import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import LocationHistory from "../models/LocationHistory.js";
import {
  validateGpsPayload,
  isLocationStale,
  isRateLimited,
  saveDriverLocation,
  getDriverLocation,
  getAllDriverLocations
} from "../services/locationService.js";

async function runPhase5Tests() {
  console.log("============================================================");
  console.log("   FLEETFLOW PHASE 5: TELEMETRY, REDIS & STALENESS TESTS     ");
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
    // ----------------------------------------------------
    // TEST 5.1: GPS Schema & Boundary Validation
    // ----------------------------------------------------
    console.log("\n--- TEST 5.1: GPS Payload Validation ---");
    const validPing = { longitude: 76.6394, latitude: 12.2958, speedKmh: 45, headingDeg: 180 };
    assert(validateGpsPayload(validPing).valid === true, "Valid GPS coordinate payload passes schema");

    // Invalid Longitude (> 180)
    const badLon = { longitude: 195.0, latitude: 12.0 };
    assert(validateGpsPayload(badLon).valid === false, "Out of bounds longitude (> 180) rejected");

    // Invalid Latitude (> 90)
    const badLat = { longitude: 76.0, latitude: 98.0 };
    assert(validateGpsPayload(badLat).valid === false, "Out of bounds latitude (> 90) rejected");

    // Unrealistic Speed (> 250 km/h)
    const supersonic = { longitude: 76.0, latitude: 12.0, speedKmh: 350 };
    assert(validateGpsPayload(supersonic).valid === false, "Unrealistic speed (> 250 km/h) rejected");

    // Negative Speed
    const negativeSpeed = { longitude: 76.0, latitude: 12.0, speedKmh: -20 };
    assert(validateGpsPayload(negativeSpeed).valid === false, "Negative speed value rejected");

    // Simulated vs Actual labeling
    const simPing = validateGpsPayload({ ...validPing, isSimulated: true });
    assert(simPing.data.isSimulated === true && simPing.data.source === "SIMULATED", "Simulated ping clearly labelled as SIMULATED");

    const devPing = validateGpsPayload({ ...validPing, isSimulated: false });
    assert(devPing.data.isSimulated === false && devPing.data.source === "DEVICE", "Device ping clearly labelled as DEVICE");

    // ----------------------------------------------------
    // TEST 5.2: Stale Location Detection
    // ----------------------------------------------------
    console.log("\n--- TEST 5.2: Stale Location Detection ---");
    const freshTimestamp = new Date();
    assert(isLocationStale(freshTimestamp) === false, "Recent location (< 5 min) identified as fresh");

    const staleTimestamp = new Date(Date.now() - 6 * 60000); // 6 minutes ago
    assert(isLocationStale(staleTimestamp) === true, "Location older than 5 minutes detected as stale");

    assert(isLocationStale(null) === true, "Null lastSeenAt correctly treated as stale");

    // ----------------------------------------------------
    // TEST 5.3: Rate-Limiting Protection
    // ----------------------------------------------------
    console.log("\n--- TEST 5.3: Rate Limiting & DoS Protection ---");
    const testDriverId = new mongoose.Types.ObjectId().toString();
    const firstCall = isRateLimited(testDriverId, 400);
    assert(firstCall === false, "First location ping is allowed");

    const rapidSecondCall = isRateLimited(testDriverId, 400);
    assert(rapidSecondCall === true, "Immediate second ping (< 400ms) is rate-limited");

    // Wait 450ms
    await new Promise(r => setTimeout(r, 450));
    const thirdCall = isRateLimited(testDriverId, 400);
    assert(thirdCall === false, "Subsequent ping after interval is allowed");

    // ----------------------------------------------------
    // TEST 5.4: Location Persistence & Breadcrumbs
    // ----------------------------------------------------
    console.log("\n--- TEST 5.4: Dual Persistence (Redis Cache & Mongo History) ---");
    const testVeh = await Vehicle.create({
      registrationNumber: `KA-09-TLM-${Date.now().toString().slice(-4)}`,
      type: "VAN",
      capacityKg: 800,
      status: "AVAILABLE"
    });

    const testUser = await User.create({
      name: "Telemetry Test Driver",
      email: `driver_tlm_${Date.now()}@fleetflow.demo`,
      passwordHash: "$2a$10$abcdefghijklmnopqrstuv",
      role: "DRIVER"
    });

    const testDriver = await Driver.create({
      userId: testUser._id,
      vehicleId: testVeh._id,
      licenseNumber: `DL-TLM-${Date.now().toString().slice(-4)}`,
      availability: "AVAILABLE",
      shiftStatus: "ACTIVE"
    });

    const savedLoc = await saveDriverLocation(testDriver._id, 76.6500, 12.3100, {
      speedKmh: 52,
      headingDeg: 90,
      isSimulated: true
    });

    assert(savedLoc.longitude === 76.6500, "Longitude saved accurately");
    assert(savedLoc.latitude === 12.3100, "Latitude saved accurately");
    assert(savedLoc.speedKmh === 52, "Speed saved accurately");
    assert(savedLoc.source === "SIMULATED", "Source flagged as SIMULATED");

    // Verify MongoDB breadcrumb history
    const breadcrumb = await LocationHistory.findOne({ driverId: testDriver._id });
    assert(breadcrumb !== null, "LocationHistory breadcrumb persisted in MongoDB");
    assert(breadcrumb.speedKmh === 52, "Breadcrumb records speed telemetry");

    // Verify retrieval
    const retrieved = await getDriverLocation(testDriver._id);
    assert(retrieved.longitude === 76.6500, "getDriverLocation returns correct coordinates");
    assert(retrieved.isStale === false, "Retrieved location computed as not stale");

    // Verify all driver locations listing includes staleness and source
    const allLocs = await getAllDriverLocations();
    const thisDriver = allLocs.find(d => d.driverId.toString() === testDriver._id.toString());
    assert(thisDriver !== undefined, "getAllDriverLocations includes test driver");
    assert(thisDriver.source === "SIMULATED", "getAllDriverLocations identifies simulated telemetry source");
    assert(typeof thisDriver.isStale === "boolean", "getAllDriverLocations provides boolean isStale indicator");

    // Clean up
    await LocationHistory.deleteMany({ driverId: testDriver._id });
    await Driver.deleteOne({ _id: testDriver._id });
    await Vehicle.deleteOne({ _id: testVeh._id });
    await User.deleteOne({ _id: testUser._id });

    console.log("\n============================================================");
    console.log(`   PHASE 5 TESTS FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log("============================================================\n");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Unexpected error during Phase 5 tests:", err);
    process.exit(1);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase5Tests();
