import { Queue } from "bullmq";
import { redis, isRedisLive } from "../config/redis.js";
import Notification from "../models/Notification.js";

let queue = null;

try {
  queue = new Queue("notifications", {
    connection: redis,
    defaultJobOptions: {
      attempts: 4,
      backoff: {
        type: "exponential",
        delay: 1500
      },
      removeOnComplete: 150,
      removeOnFail: 500
    }
  });

  queue.on("error", (err) => {
    console.warn("[Queue Notice] BullMQ Queue connection error:", err.message);
  });
} catch (err) {
  console.warn("BullMQ queue initialization warning:", err.message);
}

export const notificationQueue = queue;

/**
 * Enqueues a notification job with deduplication / idempotency key support.
 * Resiliently falls back to direct MongoDB persistence if standalone Redis is unreachable.
 */
export async function enqueueNotification(data) {
  // Direct MongoDB persistence fallback when Redis queue is offline
  if (!queue || !isRedisLive()) {
    try {
      if (data.userId) {
        await Notification.create({
          userId: data.userId,
          title: data.title,
          message: data.message,
          type: data.type || "INFO",
          metadata: data.metadata || {}
        });
      }
      return { id: `direct_${Date.now()}` };
    } catch (dbErr) {
      console.warn("Direct notification fallback write failed:", dbErr.message);
      return null;
    }
  }

  // Idempotency: Use explicit idempotency key or deterministic composite key
  const jobId = data.idempotencyKey ||
    (data.userId ? `${data.type || "note"}_${data.userId}_${Math.floor(Date.now() / 5000)}` : undefined);

  try {
    return await queue.add("notify", data, {
      jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 }
    });
  } catch (err) {
    console.warn("enqueueNotification skipped:", err.message);
    return null;
  }
}

/**
 * Enqueues a delayed SLA deadline monitoring check for a task.
 */
export async function enqueueDelayedSlaCheck(taskId, delayMs = 60000) {
  if (!queue || !isRedisLive()) return null;
  try {
    return await queue.add(
      "sla_check",
      { taskId: String(taskId) },
      {
        delay: delayMs,
        jobId: `sla_${taskId}`,
        attempts: 2
      }
    );
  } catch (err) {
    console.warn("enqueueDelayedSlaCheck skipped:", err.message);
    return null;
  }
}

/**
 * Enqueues a recurring or periodic stale driver telemetry monitor check.
 */
export async function enqueueStaleLocationCheck() {
  if (!queue || !isRedisLive()) return null;
  try {
    return await queue.add(
      "stale_location_check",
      { initiatedAt: Date.now() },
      {
        jobId: `stale_check_${Math.floor(Date.now() / 60000)}`,
        attempts: 2
      }
    );
  } catch (err) {
    console.warn("enqueueStaleLocationCheck skipped:", err.message);
    return null;
  }
}
