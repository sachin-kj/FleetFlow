import { Router } from "express";
import Driver from "../models/Driver.js";
import Vehicle from "../models/Vehicle.js";
import User from "../models/User.js";
import Task from "../models/Task.js";
import Incident from "../models/Incident.js";
import TaskEvent from "../models/TaskEvent.js";
import Notification from "../models/Notification.js";
import LocationHistory from "../models/LocationHistory.js";
import { protect, allow, requireDriver, validateObjectIdParam, isValidObjectId } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { assignTask, manualAssignTask, getEligibleDrivers, validateDriverEligibility } from "../services/assignmentService.js";
import { transitionTaskStatus } from "../services/taskService.js";
import { reportBreakdown, resolveIncident, dispatchRecoveryUnit } from "../services/incidentService.js";
import { saveDriverLocation, getAllDriverLocations } from "../services/locationService.js";
import { simulationEngine } from "../services/simulationService.js";
import { enqueueNotification, enqueueDelayedSlaCheck } from "../queues/notificationQueue.js";

export default function fleetRoutes(io) {
  const router = Router();
  router.use(protect);

  // -------------------------------------------------------------
  // 1. OVERVIEW & KPIS (Staff only: ADMIN, DISPATCHER, MANAGER)
  // -------------------------------------------------------------
  router.get(
    "/overview",
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (req, res) => {
      const now = new Date();

      const [
        vehiclesTotal,
        vehiclesBusy,
        availableDrivers,
        activeTasks,
        completedTasks,
        delayedTasks,
        openIncidents,
        recentEvents,
        statusCounts
      ] = await Promise.all([
        Vehicle.countDocuments(),
        Vehicle.countDocuments({ status: "BUSY" }),
        Driver.countDocuments({ availability: "AVAILABLE" }),
        Task.countDocuments({ status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] } }),
        Task.countDocuments({ status: "DELIVERED" }),
        Task.countDocuments({
          status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] },
          deadline: { $lt: now }
        }),
        Incident.countDocuments({ status: "OPEN" }),
        TaskEvent.find().sort({ createdAt: -1 }).limit(10).populate("taskId", "title trackingNumber status"),
        Task.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }])
      ]);

      const fleetUtilizationPct = vehiclesTotal > 0 ? Math.round((vehiclesBusy / vehiclesTotal) * 100) : 0;

      res.json({
        vehicles: vehiclesTotal,
        vehiclesBusy,
        availableDrivers,
        activeTasks,
        completedTasks,
        delayedTasks,
        openIncidents,
        fleetUtilizationPct,
        recentEvents,
        statusBreakdown: statusCounts.reduce((acc, curr) => {
          acc[curr._id] = curr.count;
          return acc;
        }, {})
      });
    })
  );

  // -------------------------------------------------------------
  // 2. DRIVER MANAGEMENT
  // -------------------------------------------------------------
  // List all drivers: Staff only
  router.get(
    "/drivers",
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (_req, res) => {
      const drivers = await Driver.find()
        .populate("userId", "name email phone role")
        .populate("vehicleId")
        .sort({ createdAt: -1 });
      res.json(drivers);
    })
  );

  // Create driver: ADMIN and DISPATCHER only
  router.post(
    "/drivers",
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const { name, email, password, phone, licenseNumber } = req.body;
      if (!name || !email) {
        return res.status(400).json({ message: "Name and email are required" });
      }

      const bcrypt = (await import("bcryptjs")).default;
      const normalizedEmail = String(email).trim().toLowerCase();
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(409).json({ message: "A user with this email already exists" });
      }

      const user = await User.create({
        name: String(name).trim(),
        email: normalizedEmail,
        phone: phone || "",
        passwordHash: await bcrypt.hash(password || "Driver123!", 10),
        role: "DRIVER"
      });

      const driver = await Driver.create({
        userId: user._id,
        phone: phone || "",
        licenseNumber: licenseNumber || `DL-${Math.floor(100000 + Math.random() * 900000)}`,
        availability: "AVAILABLE"
      });

      const populated = await Driver.findById(driver._id).populate("userId", "name email phone");
      res.status(201).json(populated);
    })
  );

  // Get driver by ID: Staff can view any; Drivers can view ONLY their own profile
  router.get(
    "/drivers/:id",
    validateObjectIdParam("id"),
    asyncHandler(async (req, res) => {
      if (req.user.role === "DRIVER") {
        if (!req.driver || req.driver._id.toString() !== req.params.id) {
          return res.status(403).json({
            message: "Unauthorized: Drivers are restricted to viewing their own driver profile"
          });
        }
      }

      const driver = await Driver.findById(req.params.id)
        .populate("userId", "name email phone")
        .populate("vehicleId");
      if (!driver) return res.status(404).json({ message: "Driver not found" });

      const activeDeliveries = await Task.find({
        driverId: driver._id,
        status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] }
      });

      res.json({ driver, activeDeliveries });
    })
  );

  // Update driver: ADMIN & DISPATCHER can update any; DRIVER can update only their own phone/availability
  router.put(
    "/drivers/:id",
    validateObjectIdParam("id"),
    asyncHandler(async (req, res) => {
      const isDriver = req.user.role === "DRIVER";
      if (isDriver) {
        if (!req.driver || req.driver._id.toString() !== req.params.id) {
          return res.status(403).json({ message: "Unauthorized: You may only modify your own driver profile" });
        }
      } else if (!["ADMIN", "DISPATCHER"].includes(req.user.role)) {
        return res.status(403).json({ message: "Forbidden: Insufficient privileges to modify driver records" });
      }

      const driver = await Driver.findById(req.params.id);
      if (!driver) return res.status(404).json({ message: "Driver not found" });

      const { phone, licenseNumber, availability, shiftStatus } = req.body;

      if (phone !== undefined) driver.phone = String(phone).trim();
      if (availability !== undefined) {
        const validAvailabilities = ["AVAILABLE", "BUSY", "OFFLINE", "ON_BREAK"];
        if (!validAvailabilities.includes(availability)) {
          return res.status(400).json({ message: `Invalid availability value: ${availability}` });
        }
        driver.availability = availability;
      }
      if (shiftStatus !== undefined) {
        const validShifts = ["ACTIVE", "INACTIVE", "ON_BREAK"];
        if (!validShifts.includes(shiftStatus)) {
          return res.status(400).json({ message: `Invalid shift status: ${shiftStatus}` });
        }
        driver.shiftStatus = shiftStatus;
      }

      // Only staff can update licenseNumber
      if (licenseNumber !== undefined && !isDriver) {
        driver.licenseNumber = String(licenseNumber).trim();
      }

      await driver.save();
      const updated = await Driver.findById(driver._id).populate("userId", "name email phone").populate("vehicleId");
      res.json(updated);
    })
  );

  // Delete driver: ADMIN only
  router.delete(
    "/drivers/:id",
    validateObjectIdParam("id"),
    allow("ADMIN"),
    asyncHandler(async (req, res) => {
      const driver = await Driver.findById(req.params.id);
      if (!driver) return res.status(404).json({ message: "Driver not found" });

      // Unassign vehicle
      if (driver.vehicleId) {
        await Vehicle.updateOne({ _id: driver.vehicleId }, { $set: { driverId: null } });
      }
      await User.deleteOne({ _id: driver.userId });
      await Driver.deleteOne({ _id: driver._id });
      res.json({ message: "Driver deleted successfully" });
    })
  );

  // Driver GPS breadcrumb history: Staff or self driver only
  router.get(
    "/drivers/:id/history",
    validateObjectIdParam("id"),
    asyncHandler(async (req, res) => {
      if (req.user.role === "DRIVER") {
        if (!req.driver || req.driver._id.toString() !== req.params.id) {
          return res.status(403).json({ message: "Forbidden: Drivers can only view their own location history" });
        }
      } else if (!["ADMIN", "DISPATCHER", "MANAGER"].includes(req.user.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const history = await LocationHistory.find({ driverId: req.params.id })
        .sort({ recordedAt: -1 })
        .limit(50);
      res.json(history);
    })
  );

  // -------------------------------------------------------------
  // 3. VEHICLE MANAGEMENT
  // -------------------------------------------------------------
  // List all vehicles: Staff only
  router.get(
    "/vehicles",
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (_req, res) => {
      const vehicles = await Vehicle.find().populate({
        path: "driverId",
        populate: { path: "userId", select: "name email phone" }
      }).sort({ createdAt: -1 });
      res.json(vehicles);
    })
  );

  // Create vehicle: ADMIN and DISPATCHER only
  router.post(
    "/vehicles",
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const { registrationNumber, type, capacityKg, volumeM3, modelName } = req.body;
      if (!registrationNumber || !capacityKg) {
        return res.status(400).json({ message: "Registration number and capacity are required" });
      }

      const normalizedReg = registrationNumber.toUpperCase().trim();
      const existing = await Vehicle.findOne({ registrationNumber: normalizedReg });
      if (existing) {
        return res.status(409).json({ message: "Vehicle with this registration number already exists" });
      }

      const vehicle = await Vehicle.create({
        registrationNumber: normalizedReg,
        type: type || "VAN",
        capacityKg: Number(capacityKg),
        volumeM3: Number(volumeM3) || 5,
        modelName: modelName || "Standard Fleet Vehicle"
      });
      res.status(201).json(vehicle);
    })
  );

  // Get vehicle by ID: Staff only
  router.get(
    "/vehicles/:id",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (req, res) => {
      const vehicle = await Vehicle.findById(req.params.id).populate({
        path: "driverId",
        populate: { path: "userId", select: "name email phone" }
      });
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      res.json(vehicle);
    })
  );

  // Update vehicle: ADMIN and DISPATCHER only
  router.put(
    "/vehicles/:id",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const vehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
      res.json(vehicle);
    })
  );

  // Delete vehicle: ADMIN only
  router.delete(
    "/vehicles/:id",
    validateObjectIdParam("id"),
    allow("ADMIN"),
    asyncHandler(async (req, res) => {
      const vehicle = await Vehicle.findById(req.params.id);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

      if (vehicle.driverId) {
        await Driver.updateOne({ _id: vehicle.driverId }, { $set: { vehicleId: null } });
      }
      await Vehicle.deleteOne({ _id: vehicle._id });
      res.json({ message: "Vehicle deleted successfully" });
    })
  );

  // Assign driver to vehicle: ADMIN and DISPATCHER only
  router.post(
    "/vehicles/:id/assign-driver",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const vehicle = await Vehicle.findById(req.params.id);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

      const { driverId } = req.body;
      if (!driverId) {
        // Unassign current driver
        if (vehicle.driverId) {
          await Driver.updateOne({ _id: vehicle.driverId }, { $set: { vehicleId: null } });
          vehicle.driverId = null;
          await vehicle.save();
        }
        return res.json({ vehicle, driver: null });
      }

      if (!isValidObjectId(driverId)) {
        return res.status(400).json({ message: "Invalid driver ID format" });
      }

      const driver = await Driver.findById(driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });

      // Unlink previous vehicle from this driver if any
      if (driver.vehicleId && driver.vehicleId.toString() !== vehicle._id.toString()) {
        await Vehicle.updateOne({ _id: driver.vehicleId }, { $set: { driverId: null } });
      }

      vehicle.driverId = driver._id;
      await vehicle.save();

      driver.vehicleId = vehicle._id;
      await driver.save();

      res.json({ vehicle, driver });
    })
  );

  // Report breakdown: ADMIN, DISPATCHER, or the DRIVER assigned to this vehicle
  router.post(
    "/vehicles/:id/breakdown",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER", "DRIVER"),
    asyncHandler(async (req, res) => {
      const vehicle = await Vehicle.findById(req.params.id);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

      // If called by DRIVER, verify that this driver is actually assigned to this vehicle
      if (req.user.role === "DRIVER") {
        if (!req.driver || !vehicle.driverId || vehicle.driverId.toString() !== req.driver._id.toString()) {
          return res.status(403).json({
            message: "Unauthorized: Drivers can only report breakdowns for their currently assigned vehicle."
          });
        }
      }

      const result = await reportBreakdown(vehicle._id, io, req.body);
      res.json(result);
    })
  );

  // -------------------------------------------------------------
  // 4. DELIVERY TASK MANAGEMENT
  // -------------------------------------------------------------
  // List tasks: Drivers see ONLY their own tasks; Staff can filter all
  router.get(
    "/tasks",
    asyncHandler(async (req, res) => {
      const { status, priority, vehicleType, search } = req.query;
      const filter = {};

      if (status) filter.status = status;
      if (priority) filter.priority = priority;
      if (vehicleType) filter.requiredVehicleType = vehicleType;

      if (search) {
        filter.$or = [
          { title: { $regex: search, $options: "i" } },
          { trackingNumber: { $regex: search, $options: "i" } },
          { "pickup.label": { $regex: search, $options: "i" } },
          { "destination.label": { $regex: search, $options: "i" } }
        ];
      }

      // Strict role isolation: Drivers can only access tasks assigned to them
      if (req.user.role === "DRIVER") {
        if (!req.driver) return res.json([]);
        filter.driverId = req.driver._id;
      }

      const tasks = await Task.find(filter)
        .sort({ createdAt: -1 })
        .limit(150)
        .populate({ path: "driverId", populate: { path: "userId", select: "name email phone" } })
        .populate("vehicleId");

      res.json(tasks);
    })
  );

  // Create delivery task: ADMIN and DISPATCHER only
  router.post(
    "/tasks",
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const { title, pickup, destination, cargoKg, volumeM3, requiredVehicleType, priority, deadline, notes } = req.body;
      if (!title || !pickup?.coordinates || !destination?.coordinates || !cargoKg) {
        return res.status(400).json({ message: "Task title, pickup, destination, and cargo weight are required" });
      }

      const trackingNumber = `FF-${Math.floor(100000 + Math.random() * 900000)}`;

      const task = await Task.create({
        title: String(title).trim(),
        trackingNumber,
        pickup,
        destination,
        cargoKg: Number(cargoKg),
        volumeM3: Number(volumeM3) || 1,
        requiredVehicleType: requiredVehicleType || "VAN",
        priority: priority || "NORMAL",
        deadline: deadline ? new Date(deadline) : new Date(Date.now() + 4 * 3600000),
        notes: notes || "",
        createdBy: req.user._id,
        status: "CREATED"
      });

      await TaskEvent.create({
        taskId: task._id,
        type: "CREATED",
        message: `Delivery task ${trackingNumber} created`,
        actorId: req.user._id,
        actorName: req.user.name
      });

      enqueueDelayedSlaCheck(task._id, 120000);

      io?.to("dispatchers").emit("task:created", task);
      res.status(201).json(task);
    })
  );

  // Get task by ID: Staff can view all; Driver can view ONLY their own assigned task
  router.get(
    "/tasks/:id",
    validateObjectIdParam("id"),
    asyncHandler(async (req, res) => {
      const task = await Task.findById(req.params.id)
        .populate({ path: "driverId", populate: { path: "userId", select: "name email phone" } })
        .populate("vehicleId");
      if (!task) return res.status(404).json({ message: "Task not found" });

      if (req.user.role === "DRIVER") {
        if (!req.driver || !task.driverId || task.driverId._id.toString() !== req.driver._id.toString()) {
          return res.status(403).json({ message: "Forbidden: You are not authorized to view this shipment" });
        }
      }

      const events = await TaskEvent.find({ taskId: task._id }).sort({ createdAt: 1 });
      res.json({ task, events });
    })
  );

  // Edit task details: ADMIN and DISPATCHER only
  router.put(
    "/tasks/:id",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const task = await Task.findById(req.params.id);
      if (!task) return res.status(404).json({ message: "Task not found" });

      const updates = req.body;
      delete updates.status; // status changes only via state machine
      delete updates.driverId; // assignments only via assign endpoints
      delete updates.vehicleId;
      Object.assign(task, updates);
      await task.save();

      res.json(task);
    })
  );

  // Cancel task: ADMIN and DISPATCHER only
  router.post(
    "/tasks/:id/cancel",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      try {
        const { task, event } = await transitionTaskStatus({
          taskId: req.params.id,
          targetStatus: "CANCELLED",
          user: req.user,
          driver: req.driver,
          reason: req.body?.reason || `Task cancelled by ${req.user.name}`,
          io
        });
        res.json(task);
      } catch (err) {
        return res.status(err.statusCode || 500).json({ message: err.message });
      }
    })
  );

  // Preview eligible drivers: ADMIN and DISPATCHER only
  router.get(
    "/tasks/:id/eligible-drivers",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const task = await Task.findById(req.params.id);
      if (!task) return res.status(404).json({ message: "Task not found" });
      const candidates = await getEligibleDrivers(task);
      res.json(candidates);
    })
  );

  // Auto assign using intelligent algorithm: ADMIN and DISPATCHER only
  router.post(
    "/tasks/:id/assign",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const result = await assignTask(req.params.id, io);

      if (result.task?.driverId) {
        const driver = await Driver.findById(result.driverId).populate("userId");
        if (driver?.userId) {
          await enqueueNotification({
            userId: driver.userId._id,
            title: "New Delivery Assignment",
            message: `You have been dispatched for task "${result.task.title}". Priority: ${result.task.priority}.`,
            type: "ASSIGNMENT",
            metadata: { taskId: result.task._id }
          });
        }
      }

      res.json(result);
    })
  );

  // Manual assign: ADMIN and DISPATCHER only (uses identical eligibility engine and atomic locks)
  router.post(
    "/tasks/:id/manual-assign",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const { driverId } = req.body;
      if (!isValidObjectId(driverId)) {
        return res.status(400).json({ message: "Invalid driver ID format" });
      }

      try {
        const result = await manualAssignTask({
          taskId: req.params.id,
          driverId,
          user: req.user,
          io
        });

        // Enqueue notification for assigned driver
        const driver = await Driver.findById(driverId).populate("userId");
        if (driver?.userId) {
          await enqueueNotification({
            userId: driver.userId._id,
            title: "Manual Delivery Assignment",
            message: `Dispatcher ${req.user.name} assigned you to task "${result.task.title}". Priority: ${result.task.priority}.`,
            type: "ASSIGNMENT",
            metadata: { taskId: result.task._id }
          });
        }

        res.json(result);
      } catch (err) {
        return res.status(err.statusCode || 500).json({
          message: err.message,
          issues: err.issues || []
        });
      }
    })
  );

  // State transitions: DRIVER, ADMIN, DISPATCHER only (MANAGER blocked)
  // Enforces valid lifecycle transitions and strict anti-impersonation
  router.patch(
    "/tasks/:id/status",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER", "DRIVER"),
    asyncHandler(async (req, res) => {
      const { status, reason, metadata } = req.body;
      if (!status) {
        return res.status(400).json({ message: "Target status is required" });
      }

      try {
        const { task, event } = await transitionTaskStatus({
          taskId: req.params.id,
          targetStatus: status,
          user: req.user,
          driver: req.driver,
          reason,
          metadata,
          io
        });

        res.json({ success: true, task, event });
      } catch (err) {
        return res.status(err.statusCode || 500).json({ message: err.message });
      }
    })
  );

  // Task event audit trail: Staff or assigned driver
  router.get(
    "/tasks/:id/events",
    validateObjectIdParam("id"),
    asyncHandler(async (req, res) => {
      const task = await Task.findById(req.params.id);
      if (!task) return res.status(404).json({ message: "Task not found" });

      if (req.user.role === "DRIVER") {
        if (!req.driver || !task.driverId || task.driverId.toString() !== req.driver._id.toString()) {
          return res.status(403).json({ message: "Forbidden" });
        }
      }

      const events = await TaskEvent.find({ taskId: req.params.id }).sort({ createdAt: 1 });
      res.json(events);
    })
  );

  // -------------------------------------------------------------
  // 5. INCIDENTS MANAGEMENT
  // -------------------------------------------------------------
  // List incidents: Staff only
  router.get(
    "/incidents",
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (_req, res) => {
      const incidents = await Incident.find()
        .populate("vehicleId")
        .populate({ path: "driverId", populate: { path: "userId", select: "name email phone" } })
        .populate("affectedTaskIds")
        .sort({ createdAt: -1 });
      res.json(incidents);
    })
  );

  // Report incident: Staff or assigned Driver
  router.post(
    "/incidents",
    allow("ADMIN", "DISPATCHER", "DRIVER"),
    asyncHandler(async (req, res) => {
      const { vehicleId, type, severity, description, coordinates } = req.body;
      if (!isValidObjectId(vehicleId)) {
        return res.status(400).json({ message: "Invalid vehicle ID format" });
      }

      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });

      if (req.user.role === "DRIVER") {
        if (!req.driver || !vehicle.driverId || vehicle.driverId.toString() !== req.driver._id.toString()) {
          return res.status(403).json({ message: "Unauthorized: You can only report an incident for your own assigned vehicle." });
        }
      }

      const driver = await Driver.findOne({ vehicleId: vehicle._id });
      const incident = await Incident.create({
        vehicleId,
        driverId: driver?._id,
        type: type || "BREAKDOWN",
        severity: severity || "HIGH",
        description: description || "Reported operational incident",
        coordinates: coordinates || driver?.currentLocation?.coordinates || [76.6394, 12.2958],
        status: "OPEN"
      });

      res.status(201).json(incident);
    })
  );

  // Resolve incident: ADMIN and DISPATCHER only
  router.post(
    "/incidents/:id/resolve",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const { resolutionNotes, returnVehicleToService } = req.body;
      const incident = await resolveIncident(
        req.params.id,
        { resolutionNotes, returnVehicleToService },
        req.user,
        io
      );
      res.json(incident);
    })
  );

  // Dispatch recovery unit for stranded cargo in an incident: ADMIN and DISPATCHER only
  router.post(
    "/incidents/:id/dispatch-recovery",
    validateObjectIdParam("id"),
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const { taskId, recoveryDriverId, recoveryNotes } = req.body;
      if (!isValidObjectId(taskId) || !isValidObjectId(recoveryDriverId)) {
        return res.status(400).json({ message: "Valid taskId and recoveryDriverId are required" });
      }

      try {
        const result = await dispatchRecoveryUnit({
          incidentId: req.params.id,
          taskId,
          recoveryDriverId,
          user: req.user,
          recoveryNotes,
          io
        });
        res.json(result);
      } catch (err) {
        return res.status(err.statusCode || 500).json({
          message: err.message,
          issues: err.issues || []
        });
      }
    })
  );

  // -------------------------------------------------------------
  // 6. ANALYTICS (Staff only - Authentic Calculations from Database)
  // -------------------------------------------------------------
  router.get(
    "/analytics",
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (_req, res) => {
      const now = new Date();

      const [
        tasksByStatusAgg,
        vehicleUtilizationAgg,
        totalTasks,
        deliveredTasksDocs,
        totalDelayed,
        totalIncidents,
        recentIncidents,
        vehiclesTotal,
        vehiclesBusy,
        driversTotal,
        driversBusy,
        assignedTasksCount,
        topDriversList
      ] = await Promise.all([
        Task.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
        Vehicle.aggregate([
          {
            $group: {
              _id: "$type",
              total: { $sum: 1 },
              busy: { $sum: { $cond: [{ $eq: ["$status", "BUSY"] }, 1, 0] } }
            }
          }
        ]),
        Task.countDocuments(),
        Task.find({ status: "DELIVERED" }),
        Task.countDocuments({
          $or: [
            { status: "DELAYED" },
            {
              status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] },
              deadline: { $lt: now }
            }
          ]
        }),
        Incident.countDocuments(),
        Incident.find().populate("vehicleId", "registrationNumber").sort({ createdAt: -1 }).limit(5),
        Vehicle.countDocuments(),
        Vehicle.countDocuments({ status: "BUSY" }),
        Driver.countDocuments(),
        Driver.countDocuments({ availability: "BUSY" }),
        Task.countDocuments({
          status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"] }
        }),
        Driver.find().populate("userId", "name").sort({ totalDeliveries: -1 }).limit(6)
      ]);

      // 1. Calculate actual on-time rate from deliveredAt vs deadline
      let onTimeCount = 0;
      let totalDurationMin = 0;
      let validDurationCount = 0;

      for (const t of deliveredTasksDocs) {
        if (t.deadline && t.deliveredAt) {
          if (new Date(t.deliveredAt) <= new Date(t.deadline)) {
            onTimeCount++;
          }
        } else {
          onTimeCount++; // On-time if delivered without SLA violation
        }

        if (t.pickedUpAt && t.deliveredAt) {
          const diffMinutes = (new Date(t.deliveredAt).getTime() - new Date(t.pickedUpAt).getTime()) / 60000;
          if (diffMinutes > 0) {
            totalDurationMin += diffMinutes;
            validDurationCount++;
          }
        }
      }

      const totalDelivered = deliveredTasksDocs.length;
      const onTimeRate = totalDelivered > 0
        ? Number(((onTimeCount / totalDelivered) * 100).toFixed(1))
        : null;

      const avgDeliveryDurationMin = validDurationCount > 0
        ? Math.round(totalDurationMin / validDurationCount)
        : null;

      // 2. Resource utilization rates
      const vehicleUtilizationRate = vehiclesTotal > 0
        ? Number(((vehiclesBusy / vehiclesTotal) * 100).toFixed(1))
        : null;

      const driverUtilizationRate = driversTotal > 0
        ? Number(((driversBusy / driversTotal) * 100).toFixed(1))
        : null;

      // 3. Incident frequency and assignment success rate
      const incidentFrequencyPct = totalTasks > 0
        ? Number(((totalIncidents / totalTasks) * 100).toFixed(1))
        : null;

      const assignmentSuccessRate = totalTasks > 0
        ? Number(((assignedTasksCount / totalTasks) * 100).toFixed(1))
        : null;

      // 4. Calculate actual individual driver metrics
      const topDrivers = await Promise.all(
        topDriversList.map(async (d) => {
          const driverDeliveries = await Task.find({ driverId: d._id, status: "DELIVERED" });
          let driverOnTime = 0;
          for (const dt of driverDeliveries) {
            if (!dt.deadline || !dt.deliveredAt || new Date(dt.deliveredAt) <= new Date(dt.deadline)) {
              driverOnTime++;
            }
          }
          const driverOnTimeRate = driverDeliveries.length > 0
            ? Number(((driverOnTime / driverDeliveries.length) * 100).toFixed(1))
            : null;

          return {
            driverId: d._id,
            name: d.userId?.name || "Driver",
            totalDeliveries: d.totalDeliveries || 0,
            rating: d.rating ?? null,
            onTimeRate: driverOnTimeRate
          };
        })
      );

      res.json({
        onTimeRate,
        avgDeliveryDurationMin,
        vehicleUtilizationRate,
        driverUtilizationRate,
        incidentFrequencyPct,
        assignmentSuccessRate,
        totalTasks,
        completedDeliveries: totalDelivered,
        delayedDeliveries: totalDelayed,
        totalIncidents,
        tasksByStatus: tasksByStatusAgg.map((s) => ({ name: s._id, count: s.count })),
        vehicleUtilization: vehicleUtilizationAgg.map((v) => ({
          type: v._id,
          total: v.total,
          busy: v.busy,
          utilizationRate: v.total > 0 ? Math.round((v.busy / v.total) * 100) : 0
        })),
        topDrivers,
        recentIncidents
      });
    })
  );

  // -------------------------------------------------------------
  // 7. NOTIFICATIONS
  // -------------------------------------------------------------
  router.get(
    "/notifications",
    asyncHandler(async (req, res) => {
      const query = ["ADMIN", "DISPATCHER"].includes(req.user.role)
        ? { $or: [{ userId: req.user._id }, { userId: null }] }
        : { userId: req.user._id };

      const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(40);
      const unreadCount = await Notification.countDocuments({ ...query, read: false });
      res.json({ notifications, unreadCount });
    })
  );

  router.patch(
    "/notifications/:id/read",
    validateObjectIdParam("id"),
    asyncHandler(async (req, res) => {
      const query = ["ADMIN", "DISPATCHER"].includes(req.user.role)
        ? { _id: req.params.id }
        : { _id: req.params.id, userId: req.user._id };

      const updated = await Notification.findOneAndUpdate(query, {
        $set: { read: true, readAt: new Date() }
      });
      if (!updated) return res.status(404).json({ message: "Notification not found" });
      res.json({ success: true });
    })
  );

  router.post(
    "/notifications/read-all",
    asyncHandler(async (req, res) => {
      const query = ["ADMIN", "DISPATCHER"].includes(req.user.role)
        ? { $or: [{ userId: req.user._id }, { userId: null }] }
        : { userId: req.user._id };

      await Notification.updateMany(query, { $set: { read: true, readAt: new Date() } });
      res.json({ success: true });
    })
  );

  // -------------------------------------------------------------
  // 8. GPS SIMULATION CONTROLS (Staff only)
  // -------------------------------------------------------------
  router.get(
    "/simulation/status",
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (_req, res) => {
      res.json(simulationEngine.getStatus());
    })
  );

  router.post(
    "/simulation/start",
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const interval = Number(req.body.intervalMs) || 3000;
      await simulationEngine.start(io, interval);
      res.json({ message: "Simulation started", status: simulationEngine.getStatus() });
    })
  );

  router.post(
    "/simulation/stop",
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (_req, res) => {
      simulationEngine.stop(io);
      res.json({ message: "Simulation stopped", status: simulationEngine.getStatus() });
    })
  );

  router.post(
    "/simulation/speed",
    allow("ADMIN", "DISPATCHER"),
    asyncHandler(async (req, res) => {
      const multiplier = Number(req.body.multiplier) || 1;
      simulationEngine.setSpeed(multiplier, io);
      res.json({ message: `Speed updated to ${multiplier}x`, status: simulationEngine.getStatus() });
    })
  );

  // -------------------------------------------------------------
  // 9. SETTINGS & ALGORITHM WEIGHTS
  // -------------------------------------------------------------
  let algorithmSettings = {
    distanceWeight: 0.40,
    availabilityWeight: 0.25,
    workloadWeight: 0.20,
    deadlineWeight: 0.15,
    maxWorkloadPerDriver: 3,
    autoDispatchEnabled: true,
    speedMultiplier: 1.0
  };

  router.get(
    "/settings",
    allow("ADMIN", "DISPATCHER", "MANAGER"),
    asyncHandler(async (_req, res) => {
      res.json(algorithmSettings);
    })
  );

  router.put(
    "/settings",
    allow("ADMIN", "MANAGER"),
    asyncHandler(async (req, res) => {
      algorithmSettings = { ...algorithmSettings, ...req.body };
      res.json(algorithmSettings);
    })
  );

  // -------------------------------------------------------------
  // 10. DRIVER PORTAL (DRIVER role only)
  // -------------------------------------------------------------
  router.get(
    "/driver-portal/current-task",
    requireDriver,
    asyncHandler(async (req, res) => {
      const driver = req.driver;

      const activeTask = await Task.findOne({
        driverId: driver._id,
        status: { $in: ["ASSIGNED", "ACCEPTED", "PICKED_UP", "IN_TRANSIT"] }
      }).populate("vehicleId");

      const history = await Task.find({
        driverId: driver._id,
        status: "DELIVERED"
      }).sort({ deliveredAt: -1 }).limit(10);

      res.json({ driver, activeTask, history });
    })
  );

  router.post(
    "/driver-portal/update-location",
    requireDriver,
    asyncHandler(async (req, res) => {
      const driver = req.driver;
      const { longitude, latitude, speedKmh = 0, headingDeg = 0 } = req.body;

      const lng = Number(longitude);
      const lat = Number(latitude);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({ message: "Invalid geographic coordinates supplied" });
      }

      const location = await saveDriverLocation(driver._id, lng, lat, {
        speedKmh: Math.max(0, Number(speedKmh) || 0),
        headingDeg: Math.max(0, Math.min(360, Number(headingDeg) || 0)),
        isSimulated: false
      });

      io?.to("dispatchers").emit("fleet:location:changed", location);
      res.json(location);
    })
  );

  return router;
}
