import mongoose from "mongoose";

const locationPointSchema = {
  label: { type: String, required: true },
  address: { type: String, default: "" },
  coordinates: { type: [Number], required: true } // [longitude, latitude]
};

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  trackingNumber: { type: String, unique: true, index: true },
  pickup: { type: locationPointSchema, required: true },
  destination: { type: locationPointSchema, required: true },
  cargoKg: { type: Number, required: true, min: 1 },
  volumeM3: { type: Number, default: 1 },
  requiredVehicleType: { 
    type: String, 
    enum: ["BIKE", "CAR", "VAN", "TRUCK"], 
    default: "VAN",
    index: true 
  },
  priority: { 
    type: String, 
    enum: ["LOW", "NORMAL", "HIGH", "URGENT"], 
    default: "NORMAL",
    index: true 
  },
  deadline: { type: Date },
  status: { 
    type: String, 
    enum: [
      "CREATED", 
      "ASSIGNING", 
      "ASSIGNED", 
      "ACCEPTED", 
      "PICKED_UP", 
      "IN_TRANSIT", 
      "DELIVERED", 
      "REJECTED",
      "CANCELLED", 
      "DELAYED",
      "RECOVERY_REQUIRED"
    ], 
    default: "CREATED",
    index: true 
  },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", default: null, index: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null, index: true },
  assignmentScore: { type: Number, default: null },
  scoreBreakdown: {
    distanceScore: Number,
    availabilityScore: Number,
    workloadScore: Number,
    deadlineScore: Number,
    distanceKm: Number
  },
  assignedAt: Date,
  acceptedAt: Date,
  rejectedAt: Date,
  rejectionReason: { type: String, default: "" },
  pickedUpAt: Date,
  deliveredAt: Date,
  cancelledAt: Date,
  delayedAt: Date,
  estimatedDurationMin: { type: Number, default: 45 },
  notes: { type: String, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  companyId: { type: String, default: "demo-company" }
}, { timestamps: true });

taskSchema.index({ companyId: 1, status: 1, createdAt: -1 });

export default mongoose.model("Task", taskSchema);
