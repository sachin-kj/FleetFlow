import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import Task from "../models/Task.js";
import TaskEvent from "../models/TaskEvent.js";
import Notification from "../models/Notification.js";
import { Worker } from "bullmq";
import { processNotificationJob, startWorker } from "../workers/notificationWorker.js";
import { enqueueNotification, enqueueDelayedSlaCheck } from "../queues/notificationQueue.js";
import { getWorkerRedisConnection, closeWorkerRedisConnection } from "../config/redis.js";

async function runPhase6Tests() {
  console.log("============================================================");
  console.log("   FLEETFLOW PHASE 6: BULLMQ BACKGROUND WORKER & SLA TESTS   ");
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
    const admin = await User.findOne({ email: "admin@fleetflow.demo" });
    const dispatcher = await User.findOne({ email: "dispatch@fleetflow.demo" });

    // ----------------------------------------------------
    // TEST 6.1: Direct Notification Job Processing
    // ----------------------------------------------------
    console.log("\n--- TEST 6.1: Direct User Notification Worker Processing ---");
    const testNotifyJob = {
      name: "notify",
      data: {
        userId: dispatcher._id,
        title: "Test Background Notification",
        message: "Automated verification message from BullMQ job processor",
        type: "ASSIGNMENT",
        metadata: { sourceTest: "phase6" }
      }
    };

    const notifyResult = await processNotificationJob(testNotifyJob);
    assert(notifyResult.status === "processed", "Worker processed notification job successfully");

    const createdNote = await Notification.findOne({
      userId: dispatcher._id,
      title: "Test Background Notification"
    });
    assert(createdNote !== null, "Notification document created in MongoDB");
    assert(createdNote.type === "ASSIGNMENT", "Notification type matches ASSIGNMENT");

    // ----------------------------------------------------
    // TEST 6.2: Staff Broadcast Notification
    // ----------------------------------------------------
    console.log("\n--- TEST 6.2: Staff Broadcast Notification ---");
    const testBroadcastJob = {
      name: "notify",
      data: {
        userId: null, // Broadcast
        title: "Fleet Emergency Broadcast",
        message: "Weather alert: heavy rain in south corridor",
        type: "SYSTEM_ALERT"
      }
    };

    const broadcastResult = await processNotificationJob(testBroadcastJob);
    assert(broadcastResult.status === "processed", "Worker processed staff broadcast job");

    const adminNote = await Notification.findOne({
      userId: admin._id,
      title: "Fleet Emergency Broadcast"
    });
    const dispatchNote = await Notification.findOne({
      userId: dispatcher._id,
      title: "Fleet Emergency Broadcast"
    });
    assert(adminNote !== null, "Admin received broadcast notification");
    assert(dispatchNote !== null, "Dispatcher received broadcast notification");

    // ----------------------------------------------------
    // TEST 6.3: Automated SLA Breach Detection (sla_check)
    // ----------------------------------------------------
    console.log("\n--- TEST 6.3: SLA Breach Detection & State Transition ---");
    // Create an overdue task (deadline was 2 hours ago)
    const overdueTask = await Task.create({
      title: "Overdue Delivery Shipment",
      trackingNumber: `FF-SLA-OVR-${Date.now().toString().slice(-4)}`,
      pickup: { label: "Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Drop", coordinates: [76.65, 12.31] },
      cargoKg: 100,
      requiredVehicleType: "VAN",
      status: "ASSIGNED",
      deadline: new Date(Date.now() - 7200000) // 2 hours in the past
    });

    const slaOverdueJob = {
      name: "sla_check",
      data: { taskId: String(overdueTask._id) }
    };

    const slaResult = await processNotificationJob(slaOverdueJob);
    assert(slaResult.status === "sla_breach_marked", "Worker flagged task as SLA breach");

    const taskAfterSla = await Task.findById(overdueTask._id);
    assert(taskAfterSla.status === "DELAYED", "Task status automatically transitioned to DELAYED");
    assert(taskAfterSla.delayedAt instanceof Date, "delayedAt timestamp recorded");

    const delayedEvent = await TaskEvent.findOne({ taskId: overdueTask._id, type: "DELAYED" });
    assert(delayedEvent !== null, "Audit TaskEvent DELAYED created by background worker");

    // Test on-time task (deadline is 3 hours in the future)
    const onTimeTask = await Task.create({
      title: "On-Time Delivery Shipment",
      trackingNumber: `FF-SLA-ONT-${Date.now().toString().slice(-4)}`,
      pickup: { label: "Hub", coordinates: [76.63, 12.29] },
      destination: { label: "Drop", coordinates: [76.65, 12.31] },
      cargoKg: 100,
      requiredVehicleType: "VAN",
      status: "ASSIGNED",
      deadline: new Date(Date.now() + 10800000) // 3 hours in the future
    });

    const onTimeResult = await processNotificationJob({
      name: "sla_check",
      data: { taskId: String(onTimeTask._id) }
    });
    assert(onTimeResult.status === "on_time", "On-time task correctly identified as on-time");

    const taskAfterOnTime = await Task.findById(onTimeTask._id);
    assert(taskAfterOnTime.status === "ASSIGNED", "On-time task remains in ASSIGNED status");

    // ----------------------------------------------------
    // TEST 6.4: Stale Telemetry Auditor
    // ----------------------------------------------------
    console.log("\n--- TEST 6.4: Scheduled Inactive Telemetry Auditor ---");
    const staleResult = await processNotificationJob({
      name: "stale_location_check",
      data: { initiatedAt: Date.now() }
    });
    assert(staleResult.status === "stale_check_complete", "Stale telemetry check completed cleanly");
    assert(typeof staleResult.count === "number", "Stale telemetry check returned count of inactive signals");

    // ----------------------------------------------------
    // TEST 6.5: Direct Resilient Fallback Enqueue
    // ----------------------------------------------------
    console.log("\n--- TEST 6.5: Resilient Queue Fallback ---");
    const fallbackResult = await enqueueNotification({
      userId: dispatcher._id,
      title: "Resilience Fallback Test",
      message: "Guaranteed delivery across standalone and clustered Redis modes",
      type: "INFO"
    });
    assert(fallbackResult !== null && fallbackResult.id !== undefined, "Notification enqueued with valid job ID");

    // Clean up temporary documents
    await Task.deleteMany({ trackingNumber: { $regex: /^FF-SLA-/ } });
    await TaskEvent.deleteMany({ message: { $regex: /Overdue|SLA/i } });
    await Notification.deleteMany({ title: { $regex: /Test Background|Fleet Emergency|SLA Warning|Resilience/i } });

    // ----------------------------------------------------
    // TEST 6.6: BullMQ Dedicated Worker Connection & Live Processing
    // ----------------------------------------------------
    console.log("\n--- TEST 6.6: BullMQ Worker Dedicated Redis Connection & Processing ---");
    const workerRedis = getWorkerRedisConnection();
    assert(workerRedis.options.maxRetriesPerRequest === null, "Worker Redis connection has maxRetriesPerRequest: null");

    const { worker } = startWorker();
    assert(worker instanceof Worker, "BullMQ Worker instantiated successfully with dedicated connection");

    const testLiveTitle = `Live Worker Test ${Date.now()}`;
    const liveJob = await enqueueNotification({
      userId: dispatcher._id,
      title: testLiveTitle,
      message: "Verifying live BullMQ worker consumes from notifications queue",
      type: "INFO",
      idempotencyKey: `live_worker_test_${Date.now()}`
    });
    assert(liveJob !== null && liveJob.id !== undefined, "Live test job enqueued to notifications queue");

    // Wait for the worker to process the job
    let liveJobProcessed = false;
    for (let i = 0; i < 30; i++) {
      const createdNote = await Notification.findOne({ title: testLiveTitle });
      if (createdNote) {
        liveJobProcessed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert(liveJobProcessed, "BullMQ Worker picked up and successfully processed the queued notification job");

    await worker.close();
    await closeWorkerRedisConnection();
    await Notification.deleteMany({ title: testLiveTitle });

    console.log("\n============================================================");
    console.log(`   PHASE 6 TESTS FINISHED: ${passed} PASSED, ${failed} FAILED`);
    console.log("============================================================\n");

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Unexpected error during Phase 6 tests:", err);
    process.exit(1);
  } finally {
    try {
      await mongoose.disconnect();
    } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

runPhase6Tests();
