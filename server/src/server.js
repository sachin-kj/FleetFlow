import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import jwt from "jsonwebtoken";
import { connectDB } from "./config/db.js";
import { redis } from "./config/redis.js";
import { getJwtSecret } from "./middleware/auth.js";
import { saveDriverLocation, validateGpsPayload, isRateLimited } from "./services/locationService.js";
import { simulationEngine } from "./services/simulationService.js";
import authRoutes from "./routes/authRoutes.js";
import fleetRoutes from "./routes/fleetRoutes.js";
import User from "./models/User.js";
import Driver from "./models/Driver.js";

await connectDB();

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"]
  }
});

let pubClient = null;
let subClient = null;

// Setup Redis adapter for Socket.IO multi-instance scaling
try {
  pubClient = createClient({ url: process.env.REDIS_URL || "redis://127.0.0.1:6379" });
  pubClient.on("error", (err) => console.warn("[Socket.IO Redis pubClient Notice]", err.message));
  subClient = pubClient.duplicate();
  subClient.on("error", (err) => console.warn("[Socket.IO Redis subClient Notice]", err.message));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));
  console.log("Socket.IO Redis adapter enabled for multi-node clustering");
} catch (err) {
  console.warn("Socket.IO running with default in-memory adapter (Redis adapter fallback):", err.message);
}

// Authentication middleware for Socket.IO
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized: Token missing"));
    const jwtSecret = getJwtSecret();
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.id).select("-passwordHash");
    if (!user) return next(new Error("Unauthorized: User not found"));
    socket.user = user;
    next();
  } catch (err) {
    if (err.message?.includes("JWT_SECRET")) {
      console.error("[Socket.IO Auth] Configuration error:", err.message);
      return next(new Error(err.message));
    }
    next(new Error("Unauthorized"));
  }
});

// Socket.IO connection and real-time events
io.on("connection", async (socket) => {
  const user = socket.user;

  if (["ADMIN", "DISPATCHER", "MANAGER"].includes(user.role)) {
    socket.join("dispatchers");
  }

  if (user.role === "DRIVER") {
    socket.join(`user:${user._id}`);
    const driver = await Driver.findOne({ userId: user._id });
    if (driver) {
      socket.join(`driver:${driver._id}`);
    }
  }

  // Real-time GPS location update sent by driver device
  socket.on("driver:location:update", async (payload, callback) => {
    try {
      if (user.role !== "DRIVER") {
        if (typeof callback === "function") callback({ error: "Unauthorized: Driver role required" });
        return;
      }

      const driver = await Driver.findOne({ userId: user._id });
      if (!driver) {
        if (typeof callback === "function") callback({ error: "Driver profile not found" });
        return;
      }

      // Rate limiting: Protect against socket event flooding
      if (isRateLimited(driver._id, 300)) {
        if (typeof callback === "function") callback({ status: "rate_limited" });
        return;
      }

      // Validate payload coordinates and physics bounds
      const validation = validateGpsPayload(payload);
      if (!validation.valid) {
        if (typeof callback === "function") callback({ error: validation.error });
        return;
      }

      const location = await saveDriverLocation(
        driver._id,
        validation.data.longitude,
        validation.data.latitude,
        {
          speedKmh: validation.data.speedKmh,
          headingDeg: validation.data.headingDeg,
          isSimulated: validation.data.isSimulated
        }
      );

      io.to("dispatchers").emit("fleet:location:changed", location);
      if (typeof callback === "function") callback({ success: true, timestamp: location.timestamp });
    } catch (err) {
      console.error("Error processing driver location:", err.message);
      if (typeof callback === "function") callback({ error: err.message });
    }
  });

  // Driver changes availability state (AVAILABLE, ON_BREAK, OFFLINE)
  socket.on("driver:availability:update", async ({ availability }, callback) => {
    try {
      if (user.role !== "DRIVER") return;
      const validStates = ["AVAILABLE", "BUSY", "OFFLINE", "ON_BREAK"];
      if (!validStates.includes(availability)) {
        if (typeof callback === "function") callback({ error: "Invalid availability status" });
        return;
      }

      const driver = await Driver.findOneAndUpdate(
        { userId: user._id },
        { $set: { availability } },
        { new: true }
      );
      if (driver) {
        io.to("dispatchers").emit("driver:availability:changed", {
          driverId: driver._id,
          availability: driver.availability
        });
        if (typeof callback === "function") callback({ success: true, availability: driver.availability });
      }
    } catch (err) {
      console.error("Error updating driver availability:", err.message);
      if (typeof callback === "function") callback({ error: err.message });
    }
  });

  socket.on("disconnect", () => {
    // client disconnected
  });
});

// Health check endpoint
app.get("/api/health", (_req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date(),
    service: "FleetFlow Operations API",
    simulationActive: simulationEngine.getStatus().isRunning
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/fleet", fleetRoutes(io));

// Global Error Handler
app.use((err, _req, res, _next) => {
  console.error("API error:", err);
  res.status(err.status || 400).json({
    message: err.message || "An unexpected server error occurred."
  });
});

const port = process.env.PORT || 5050;
const runningServer = server.listen(port, () => {
  console.log(`FleetFlow API server listening on http://127.0.0.1:${port}`);
});

// Graceful Shutdown Handler
async function gracefulShutdown(signal) {
  console.log(`\n[Process] Received ${signal}. Starting graceful shutdown...`);
  runningServer.close(async () => {
    console.log("[HTTP] Server stopped listening for new connections.");
    try {
      simulationEngine.stop(io);
      io.close();
      if (pubClient && subClient) {
        await Promise.all([
          pubClient.quit().catch(() => pubClient.disconnect()),
          subClient.quit().catch(() => subClient.disconnect())
        ]);
        console.log("[Socket.IO Redis] Adapter clients closed cleanly.");
      }
      if (redis && redis.status !== "end") {
        redis.disconnect();
        console.log("[Redis] Client connection closed cleanly.");
      }
      await mongoose.connection.close(false);
      console.log("[MongoDB] Connection closed cleanly.");
    } catch (shutdownErr) {
      console.error("[Shutdown] Error during clean resource teardown:", shutdownErr.message);
    }
    console.log("[Process] Graceful shutdown complete. Exiting.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("[Shutdown] Force exit timeout reached (10s).");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
