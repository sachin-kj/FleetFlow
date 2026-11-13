import { redis, safeSet, safeGet, safeGeoAdd } from "../config/redis.js";
import Driver from "../models/Driver.js";
import LocationHistory from "../models/LocationHistory.js";

// In-memory rate limiting map: driverId -> timestamp
const lastPingMap = new Map();

/**
 * Validates GPS telemetry payloads against physical coordinate boundaries.
 */
export function validateGpsPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Missing or invalid payload object" };
  }

  const lon = Number(payload.longitude);
  const lat = Number(payload.latitude);
  const speed = Number(payload.speedKmh || 0);
  const heading = Number(payload.headingDeg || 0);

  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    return { valid: false, error: `Invalid longitude: ${payload.longitude}. Must be between -180 and 180.` };
  }

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { valid: false, error: `Invalid latitude: ${payload.latitude}. Must be between -90 and 90.` };
  }

  if (!Number.isFinite(speed) || speed < 0 || speed > 250) {
    return { valid: false, error: `Invalid speed: ${payload.speedKmh}. Must be between 0 and 250 km/h.` };
  }

  if (!Number.isFinite(heading) || heading < 0 || heading > 360) {
    return { valid: false, error: `Invalid heading: ${payload.headingDeg}. Must be between 0 and 360 degrees.` };
  }

  return {
    valid: true,
    data: {
      longitude: lon,
      latitude: lat,
      speedKmh: speed,
      headingDeg: heading,
      isSimulated: Boolean(payload.isSimulated),
      source: payload.isSimulated ? "SIMULATED" : "DEVICE"
    }
  };
}

/**
 * Detects whether a location timestamp is stale (> 5 minutes old).
 */
export function isLocationStale(lastSeenAt, thresholdMs = 300000) {
  if (!lastSeenAt) return true;
  const ageMs = Date.now() - new Date(lastSeenAt).getTime();
  return ageMs > thresholdMs;
}

/**
 * In-memory rate-limiter to protect against socket ping storms.
 * Enforces a minimum interval between processed updates per driver.
 */
export function isRateLimited(driverId, minIntervalMs = 400) {
  const now = Date.now();
  const lastTime = lastPingMap.get(String(driverId));
  if (lastTime && now - lastTime < minIntervalMs) {
    return true;
  }
  lastPingMap.set(String(driverId), now);
  return false;
}

/**
 * Saves driver location with validation, caching, deduplication, and persistence.
 */
export async function saveDriverLocation(driverId, longitude, latitude, options = {}) {
  const validation = validateGpsPayload({
    longitude,
    latitude,
    speedKmh: options.speedKmh,
    headingDeg: options.headingDeg,
    isSimulated: options.isSimulated
  });

  if (!validation.valid) {
    const err = new Error(validation.error);
    err.statusCode = 400;
    throw err;
  }

  const { longitude: lon, latitude: lat, speedKmh, headingDeg, isSimulated, source } = validation.data;
  const timestamp = Date.now();

  const payload = {
    driverId: String(driverId),
    longitude: lon,
    latitude: lat,
    speedKmh,
    headingDeg,
    isSimulated,
    source,
    timestamp,
    isStale: false
  };

  // 1. Cache in Redis key-value with TTL (5 minutes) and Geospatial index
  try {
    await safeSet(`driver:location:${driverId}`, JSON.stringify(payload), "EX", 300);
    await safeGeoAdd("fleet:drivers:geo", lon, lat, String(driverId));
  } catch (err) {
    // Non-fatal if Redis temporary error
  }

  // 2. Persistent update in MongoDB Driver document
  const driver = await Driver.findByIdAndUpdate(
    driverId,
    {
      $set: {
        currentLocation: { type: "Point", coordinates: [lon, lat] },
        speedKmh,
        headingDeg,
        isSimulated,
        lastSeenAt: new Date(timestamp)
      }
    },
    { new: true }
  )
    .populate("vehicleId")
    .populate("userId", "name email phone");

  // 3. Save breadcrumb to LocationHistory collection
  try {
    await LocationHistory.create({
      driverId,
      vehicleId: driver?.vehicleId?._id || null,
      location: { type: "Point", coordinates: [lon, lat] },
      speedKmh,
      headingDeg,
      isSimulated,
      recordedAt: new Date(timestamp)
    });
  } catch (histErr) {
    console.warn("Location history write error:", histErr.message);
  }

  return {
    ...payload,
    driverName: driver?.userId?.name || "Driver",
    vehicleNumber: driver?.vehicleId?.registrationNumber || "Unassigned",
    vehicleType: driver?.vehicleId?.type || "CAR",
    availability: driver?.availability || "AVAILABLE"
  };
}

/**
 * Retrieves the latest location for a driver, checking Redis cache first with MongoDB fallback.
 */
export async function getDriverLocation(driverId) {
  try {
    const raw = await safeGet(`driver:location:${driverId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      parsed.isStale = isLocationStale(parsed.timestamp);
      return parsed;
    }
  } catch {
    // fallback
  }

  const driver = await Driver.findById(driverId).populate("vehicleId").populate("userId", "name");
  if (!driver || !driver.currentLocation) return null;

  const isStale = isLocationStale(driver.lastSeenAt);

  return {
    driverId: driver._id,
    longitude: driver.currentLocation.coordinates[0],
    latitude: driver.currentLocation.coordinates[1],
    speedKmh: driver.speedKmh || 0,
    headingDeg: driver.headingDeg || 0,
    isSimulated: driver.isSimulated || false,
    source: driver.isSimulated ? "SIMULATED" : "DEVICE",
    timestamp: driver.lastSeenAt?.getTime() || Date.now(),
    isStale,
    driverName: driver.userId?.name || "Driver",
    vehicleNumber: driver.vehicleId?.registrationNumber || "Unassigned",
    availability: driver.availability
  };
}

/**
 * Returns all active driver locations, computing real-time staleness for each.
 */
export async function getAllDriverLocations() {
  const drivers = await Driver.find().populate("userId", "name email").populate("vehicleId");
  return drivers.map((d) => {
    const isStale = isLocationStale(d.lastSeenAt);
    return {
      driverId: d._id,
      driverName: d.userId?.name || "Driver",
      vehicleNumber: d.vehicleId?.registrationNumber || "Unassigned",
      vehicleType: d.vehicleId?.type || "CAR",
      coordinates: d.currentLocation?.coordinates || [76.6394, 12.2958],
      availability: d.availability,
      speedKmh: d.speedKmh || 0,
      headingDeg: d.headingDeg || 0,
      isSimulated: d.isSimulated || false,
      source: d.isSimulated ? "SIMULATED" : "DEVICE",
      lastSeenAt: d.lastSeenAt,
      isStale
    };
  });
}

/**
 * Finds drivers within radius using Redis GEORADIUS or MongoDB geospatial index.
 */
export async function getDriversWithinRadius(longitude, latitude, radiusKm = 10) {
  try {
    const results = await redis.georadius(
      "fleet:drivers:geo",
      longitude,
      latitude,
      radiusKm,
      "km",
      "WITHCOORD",
      "WITHDIST"
    );
    return results.map(([id, dist, coords]) => ({
      driverId: id,
      distanceKm: Number(dist),
      coordinates: [Number(coords[0]), Number(coords[1])]
    }));
  } catch {
    const drivers = await Driver.find({
      currentLocation: {
        $near: {
          $geometry: { type: "Point", coordinates: [Number(longitude), Number(latitude)] },
          $maxDistance: radiusKm * 1000
        }
      }
    });
    return drivers.map((d) => ({
      driverId: d._id,
      coordinates: d.currentLocation.coordinates
    }));
  }
}
