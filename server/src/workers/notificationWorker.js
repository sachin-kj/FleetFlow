import "dotenv/config";
import mongoose from "mongoose";
import { Worker } from "bullmq";
import { getWorkerRedisConnection, closeWorkerRedisConnection } from "../config/redis.js";
import { connectDB } from "../config/db.js";
import Notification from "../models/Notification.js";
import Task from "../models/Task.js";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import { transitionTaskStatus } from "../services/taskService.js";

/**
 * Core business processor for BullMQ jobs.
 * Handles notification broadcasting, delayed SLA breach monitoring, and stale telemetry audits.
 */
export async function processNotificationJob(job) {
  const { name, data } = job;

  if (name === "notify") {
    const { userId, title, message, type = "INFO", metadata = {} } = data;

    if (userId) {
      await Notification.create({
        userId,
        title,
        message,
        type,
        metadata
      });
    } else {
      // Broadcast to all active dispatchers, admins, and managers
      const staff = await User.find({ role: { $in: ["ADMIN", "DISPATCHER", "MANAGER"] } });
      await Promise.all(
        staff.map((u) =>
          Notification.create({
            userId: u._id,
            title,
            message,
            type,
            metadata
          })
        )
      );
    }
    return { status: "processed", title };
  }

  if (name === "sla_check") {
    const { taskId } = data;
    const task = await Task.findById(taskId);
    if (!task) return { status: "task_not_found" };

    // Check if task is still in progress and deadline has lapsed
    if (!["DELIVERED", "CANCELLED", "DELAYED"].includes(task.status)) {
      if (task.deadline && new Date() > new Date(task.deadline)) {
        console.warn(`[Worker] SLA Breach Alert: Task ${task.trackingNumber || task._id} is delayed!`);

        // Automatically transition task status to DELAYED via taskService
        try {
          await transitionTaskStatus({
            taskId: task._id,
            targetStatus: "DELAYED",
            user: { role: "SYSTEM", name: "BullMQ SLA Monitor" },
            reason: `Automated SLA deadline breach: deadline was ${new Date(task.deadline).toISOString()}`
          });
        } catch (transErr) {
          console.warn(`[Worker] Could not transition task to DELAYED:`, transErr.message);
        }

        // Notify dispatchers
        const dispatchers = await User.find({ role: { $in: ["DISPATCHER", "ADMIN"] } });
        await Promise.all(
          dispatchers.map((d) =>
            Notification.create({
              userId: d._id,
              title: "SLA Warning: Delivery Delayed",
              message: `Task "${task.title}" (${task.trackingNumber}) breached delivery deadline.`,
              type: "SYSTEM_ALERT",
              metadata: { taskId: task._id }
            })
          )
        );

        return { status: "sla_breach_marked", taskId: task._id };
      }
    }
    return { status: "on_time", taskId: task._id };
  }

  if (name === "stale_location_check") {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60000);
    const staleDrivers = await Driver.find({
      availability: { $in: ["AVAILABLE", "BUSY"] },
      $or: [
        { lastSeenAt: { $lt: tenMinutesAgo } },
        { lastSeenAt: null }
      ]
    }).populate("userId", "name");

    if (staleDrivers.length > 0) {
      console.warn(`[Worker] Stale location check: ${staleDrivers.length} driver(s) telemetry inactive`);
      const dispatchers = await User.find({ role: { $in: ["DISPATCHER", "ADMIN"] } });
      await Promise.all(
        dispatchers.map((d) =>
          Notification.create({
            userId: d._id,
            title: "Telemetry Warning: Inactive Driver Signal",
            message: `${staleDrivers.length} on-shift driver(s) have not transmitted GPS pings in over 10 minutes.`,
            type: "SYSTEM_ALERT",
            metadata: { count: staleDrivers.length }
          })
        )
      );
    }
    return { status: "stale_check_complete", count: staleDrivers.length };
  }

  return { status: "unknown_job_type", name };
}

/**
 * Instantiates and starts the BullMQ Worker with the dedicated Redis connection.
 */
export function startWorker(customConnection = null) {
  const workerRedis = customConnection || getWorkerRedisConnection();

  const worker = new Worker("notifications", processNotificationJob, {
    connection: workerRedis,
    concurrency: 5
  });

  worker.on("completed", (job) => {
    console.log(`[Worker] Completed job ${job.id} (${job.name})`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[Worker] BullMQ Worker error:", err.message);
  });

  return { worker, workerRedis };
}

// Start worker only when run as standalone script
if (process.argv[1]?.includes("notificationWorker.js")) {
  await connectDB();

  const { worker } = startWorker();

  console.log("FleetFlow BullMQ notification worker active and listening on queue 'notifications'");

  // Graceful shutdown handling
  let isShuttingDown = false;
  async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n[Worker Process] Received ${signal}. Starting graceful shutdown...`);

    const forceExitTimer = setTimeout(() => {
      console.error("[Worker Shutdown] Force exit timeout reached (10s).");
      process.exit(1);
    }, 10000);
    forceExitTimer.unref();

    try {
      if (worker) {
        console.log("[Worker] Closing BullMQ worker...");
        await worker.close();
        console.log("[Worker] BullMQ worker closed successfully.");
      }
      await closeWorkerRedisConnection();
      await mongoose.connection.close(false);
      console.log("[MongoDB] Connection closed cleanly.");
    } catch (shutdownErr) {
      console.error("[Worker Shutdown] Error during clean resource teardown:", shutdownErr.message);
    }

    console.log("[Worker Process] Graceful shutdown complete. Exiting.");
    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}
