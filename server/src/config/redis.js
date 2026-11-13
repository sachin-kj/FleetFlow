import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

let isRedisConnected = false;
const inMemoryCache = new Map();
const inMemoryGeo = new Map();

// Real ioredis instance with bounded reconnection attempts
export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  enableReadyCheck: false,
  lazyConnect: true,
  retryStrategy(times) {
    if (times > 3) {
      // Don't hammer if offline, retry every 10 seconds
      return 10000;
    }
    return Math.min(times * 300, 2000);
  }
});

// Attempt initial connection asynchronously
redis.connect().then(() => {
  isRedisConnected = true;
  console.log("Connected to Redis at", redisUrl);
}).catch((err) => {
  isRedisConnected = false;
  console.warn(`[Redis Notice] Standalone Redis not reachable at ${redisUrl}. Activating resilient in-memory fallback cache: ${err.message}`);
});

redis.on("connect", () => {
  isRedisConnected = true;
  console.log("Connected to Redis at", redisUrl);
});

redis.on("ready", () => {
  isRedisConnected = true;
});

redis.on("close", () => {
  isRedisConnected = false;
});

redis.on("error", (err) => {
  isRedisConnected = false;
});

/**
 * Resilient Redis GeoAdd fallback
 */
export async function safeGeoAdd(key, longitude, latitude, member) {
  if (isRedisConnected) {
    try {
      return await redis.geoadd(key, longitude, latitude, String(member));
    } catch {
      // fallback
    }
  }
  if (!inMemoryGeo.has(key)) inMemoryGeo.set(key, new Map());
  inMemoryGeo.get(key).set(String(member), [Number(longitude), Number(latitude)]);
  return 1;
}

/**
 * Resilient Redis Set with TTL fallback
 */
export async function safeSet(key, value, ...args) {
  if (isRedisConnected) {
    try {
      return await redis.set(key, value, ...args);
    } catch {
      // fallback
    }
  }
  inMemoryCache.set(key, value);
  return "OK";
}

/**
 * Resilient Redis Get fallback
 */
export async function safeGet(key) {
  if (isRedisConnected) {
    try {
      return await redis.get(key);
    } catch {
      // fallback
    }
  }
  return inMemoryCache.get(key) || null;
}

export function isRedisLive() {
  return isRedisConnected || redis.status === "ready";
}

let workerRedisInstance = null;

/**
 * Creates a dedicated ioredis connection specifically for BullMQ Worker.
 * BullMQ Worker performs blocking commands (BLMOVE/BRPOPLPUSH) and requires maxRetriesPerRequest: null.
 */
export function createWorkerRedisConnection(customOptions = {}) {
  const connection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      if (times > 10) {
        return 10000;
      }
      return Math.min(times * 500, 3000);
    },
    ...customOptions
  });

  connection.on("connect", () => {
    console.log(`[Worker Redis] Connected to Redis at ${redisUrl}`);
  });

  connection.on("error", (err) => {
    console.error(`[Worker Redis] Connection error: ${err.message}`);
  });

  return connection;
}

/**
 * Returns a singleton dedicated ioredis instance for the BullMQ Worker.
 * Kept lazy to avoid unnecessary duplicate connections in non-worker processes.
 */
export function getWorkerRedisConnection(customOptions = {}) {
  if (!workerRedisInstance || workerRedisInstance.status === "end") {
    workerRedisInstance = createWorkerRedisConnection(customOptions);
  }
  return workerRedisInstance;
}

/**
 * Cleanly closes the dedicated worker Redis connection.
 */
export async function closeWorkerRedisConnection() {
  if (workerRedisInstance && workerRedisInstance.status !== "end") {
    try {
      await workerRedisInstance.quit();
    } catch {
      workerRedisInstance.disconnect();
    } finally {
      workerRedisInstance = null;
    }
  }
}

export default redis;
