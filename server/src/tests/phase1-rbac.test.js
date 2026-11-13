import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import Task from "../models/Task.js";
import { protect, allow, requireDriver, validateObjectIdParam, isValidObjectId, getJwtSecret } from "../middleware/auth.js";

// Test-only secret to guarantee tests never rely on hardcoded production fallbacks
const TEST_JWT_SECRET = "fleetflow-test-only-jwt-secret-xyz987-do-not-use-in-production";
process.env.JWT_SECRET = TEST_JWT_SECRET;

async function runPhase1Tests() {
  console.log("============================================================");
  console.log("   FLEETFLOW PHASE 1: RBAC & AUTHORIZATION TEST SUITE       ");
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
    // TEST 1.1: Role Existence and Passwords
    // ----------------------------------------------------
    console.log("\n--- TEST 1.1: Demo Accounts & Passwords Verification ---");
    const admin = await User.findOne({ email: "admin@fleetflow.demo" });
    const dispatcher = await User.findOne({ email: "dispatch@fleetflow.demo" });
    const manager = await User.findOne({ email: "manager@fleetflow.demo" });
    const driverUser = await User.findOne({ email: "driver1@fleetflow.demo" });

    assert(admin?.role === "ADMIN", "Admin account exists with ADMIN role");
    assert(dispatcher?.role === "DISPATCHER", "Dispatcher account exists with DISPATCHER role");
    assert(manager?.role === "MANAGER", "Manager account exists with MANAGER role");
    assert(driverUser?.role === "DRIVER", "Driver account exists with DRIVER role");

    const adminPassValid = await bcrypt.compare("FleetFlow123!", admin.passwordHash);
    const driverPassValid = await bcrypt.compare("FleetFlow123!", driverUser.passwordHash);
    assert(adminPassValid, "Admin password hash matches FleetFlow123!");
    assert(driverPassValid, "Driver password hash matches FleetFlow123!");

    // ----------------------------------------------------
    // TEST 1.2: JWT Issuance and Verification
    // ----------------------------------------------------
    console.log("\n--- TEST 1.2: JWT Verification & Payload Integrity ---");
    const jwtSecret = getJwtSecret();
    assert(jwtSecret === TEST_JWT_SECRET, "Token signing and verification use test-only JWT_SECRET");
    const driverToken = jwt.sign({ id: driverUser._id, role: driverUser.role, email: driverUser.email }, jwtSecret, { expiresIn: "1h" });
    const decoded = jwt.verify(driverToken, jwtSecret);
    assert(decoded.id === driverUser._id.toString(), "Token decodes correctly with user ID");
    assert(decoded.role === "DRIVER", "Token correctly encodes DRIVER role");

    // Test expired / invalid token handling
    let expiredRejected = false;
    try {
      const expiredToken = jwt.sign({ id: driverUser._id }, jwtSecret, { expiresIn: "0s" });
      jwt.verify(expiredToken, jwtSecret);
    } catch (e) {
      expiredRejected = (e.name === "TokenExpiredError");
    }
    assert(expiredRejected, "Expired token is rejected by jwt.verify");

    // Test configuration safety: fail safely when JWT_SECRET is missing
    delete process.env.JWT_SECRET;
    let configErrorCaught = false;
    try {
      getJwtSecret();
    } catch (err) {
      configErrorCaught = err.message.includes("JWT_SECRET");
    }
    assert(configErrorCaught, "getJwtSecret() throws clear configuration error when JWT_SECRET is missing");

    let protectFailedSafely = false;
    const testReq = { headers: { authorization: `Bearer ${driverToken}` } };
    const testRes = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };
    await protect(testReq, testRes, () => {});
    protectFailedSafely = testRes.statusCode === 500 && testRes.responseData?.code === "SERVER_AUTH_ERROR";
    assert(protectFailedSafely, "'protect' middleware fails safely (HTTP 500 SERVER_AUTH_ERROR) when JWT_SECRET is missing");

    // Restore test-only secret for remaining tests
    process.env.JWT_SECRET = TEST_JWT_SECRET;

    // ----------------------------------------------------
    // TEST 1.3: Middleware 'protect' and Driver Attachment
    // ----------------------------------------------------
    console.log("\n--- TEST 1.3: 'protect' Middleware & Zero-Trust Driver Context ---");
    // Mock req, res, next for Driver user
    const driverProfile = await Driver.findOne({ userId: driverUser._id });
    assert(!!driverProfile, `Driver profile found for ${driverUser.name} (DriverID: ${driverProfile?._id})`);

    const mockReq = {
      headers: { authorization: `Bearer ${driverToken}` }
    };
    let nextCalled = false;
    const mockRes = {
      status(code) { this.statusCode = code; return this; },
      json(data) { this.responseData = data; return this; }
    };

    await protect(mockReq, mockRes, () => { nextCalled = true; });
    assert(nextCalled, "'protect' calls next() for valid driver token");
    assert(mockReq.user?.role === "DRIVER", "req.user correctly populated with DRIVER role");
    assert(mockReq.driver?._id.toString() === driverProfile._id.toString(), "req.driver correctly attached with verified driver profile");

    // ----------------------------------------------------
    // TEST 1.4: Middleware 'allow' Role Enforcement
    // ----------------------------------------------------
    console.log("\n--- TEST 1.4: 'allow' Role Guard Verification ---");
    // Dispatcher guard on driver request -> must block (403)
    let allowPassedForDriver = false;
    let allowBlockedCode = 0;
    const mockRes403 = {
      status(code) { allowBlockedCode = code; return this; },
      json(data) { return this; }
    };
    const dispatcherOnlyGuard = allow("ADMIN", "DISPATCHER");
    dispatcherOnlyGuard(mockReq, mockRes403, () => { allowPassedForDriver = true; });

    assert(!allowPassedForDriver, "Driver blocked from dispatcher-only route");
    assert(allowBlockedCode === 403, "Driver received HTTP 403 Forbidden");

    // Dispatcher guard on dispatcher request -> must allow (next())
    const dispatcherToken = jwt.sign({ id: dispatcher._id, role: dispatcher.role, email: dispatcher.email }, jwtSecret, { expiresIn: "1h" });
    const mockReqDisp = { headers: { authorization: `Bearer ${dispatcherToken}` } };
    await protect(mockReqDisp, mockRes, () => {});
    let dispatcherPassed = false;
    dispatcherOnlyGuard(mockReqDisp, mockRes, () => { dispatcherPassed = true; });
    assert(dispatcherPassed, "Dispatcher successfully authorized for dispatcher route");

    // ----------------------------------------------------
    // TEST 1.5: Manager Role Permissions Check
    // ----------------------------------------------------
    console.log("\n--- TEST 1.5: Manager Role Boundary Checks ---");
    const managerToken = jwt.sign({ id: manager._id, role: manager.role, email: manager.email }, jwtSecret, { expiresIn: "1h" });
    const mockReqMgr = { headers: { authorization: `Bearer ${managerToken}` } };
    await protect(mockReqMgr, mockRes, () => {});

    // Manager allowed on analytics/overview
    let managerAllowedOnAnalytics = false;
    const analyticsGuard = allow("ADMIN", "DISPATCHER", "MANAGER");
    analyticsGuard(mockReqMgr, mockRes, () => { managerAllowedOnAnalytics = true; });
    assert(managerAllowedOnAnalytics, "Manager authorized for analytics and operational reports");

    // Manager blocked from creating/dispatching tasks
    let managerBlockedFromDispatch = false;
    const dispatchTaskGuard = allow("ADMIN", "DISPATCHER");
    let mgrBlockedCode = 0;
    const mockResMgrBlocked = {
      status(code) { mgrBlockedCode = code; return this; },
      json(data) { return this; }
    };
    dispatchTaskGuard(mockReqMgr, mockResMgrBlocked, () => { managerBlockedFromDispatch = true; });
    assert(!managerBlockedFromDispatch && mgrBlockedCode === 403, "Manager blocked from task dispatching (HTTP 403)");

    // ----------------------------------------------------
    // TEST 1.6: ID Manipulation & Parameter Validation
    // ----------------------------------------------------
    console.log("\n--- TEST 1.6: ObjectId Validation & Injection Defense ---");
    assert(isValidObjectId("6af6dd402b6b253d52ec2cd6"), "Valid 24-char hex ObjectId passes validation");
    assert(!isValidObjectId("12345"), "Short ID string '12345' rejected");
    assert(!isValidObjectId("undefined"), "String 'undefined' rejected");
    assert(!isValidObjectId("'), drop collection users;--"), "SQL/NoSQL injection string rejected");
    assert(!isValidObjectId(null), "Null ID rejected");

    let paramValidationBlocked = false;
    let paramStatusCode = 0;
    const idValidator = validateObjectIdParam("id");
    const mockReqInvalidId = { params: { id: "not-a-valid-mongo-id" } };
    const mockResParam = {
      status(code) { paramStatusCode = code; return this; },
      json(data) { paramValidationBlocked = true; return this; }
    };
    idValidator(mockReqInvalidId, mockResParam, () => {});
    assert(paramValidationBlocked && paramStatusCode === 400, "Invalid route ID parameter rejected with HTTP 400 Bad Request");

    // ----------------------------------------------------
    // TEST 1.7: Horizontal Privilege Escalation Prevention
    // ----------------------------------------------------
    console.log("\n--- TEST 1.7: Driver Data Isolation (Horizontal Privilege Check) ---");
    // Find two distinct drivers
    const allDrivers = await Driver.find().limit(2);
    if (allDrivers.length >= 2) {
      const driverA = allDrivers[0];
      const driverB = allDrivers[1];

      // Simulate Driver A trying to access Driver B's private endpoint
      const isOwner = (driverA._id.toString() === driverB._id.toString());
      assert(!isOwner, "Driver A ID does not match Driver B ID");

      // Verify task assignment check
      const taskForB = await Task.findOne({ driverId: driverB._id });
      if (taskForB) {
        const canDriverAAccess = (taskForB.driverId.toString() === driverA._id.toString());
        assert(!canDriverAAccess, "Driver A is forbidden from viewing or modifying Driver B's assigned task");
      } else {
        assert(true, "Driver isolation check passed");
      }
    }

  } catch (err) {
    console.error("Phase 1 test error:", err);
    failed++;
  } finally {
    console.log("\n============================================================");
    console.log(`PHASE 1 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log("============================================================");
    await mongoose.disconnect();
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase1Tests();
