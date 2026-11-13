import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema({
  registrationNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
  modelName: { type: String, default: "Standard Fleet" },
  type: { 
    type: String, 
    enum: ["BIKE", "CAR", "VAN", "TRUCK"], 
    required: true, 
    default: "VAN",
    index: true 
  },
  capacityKg: { type: Number, required: true, min: 1 },
  volumeM3: { type: Number, default: 5 },
  status: { 
    type: String, 
    enum: ["AVAILABLE", "BUSY", "MAINTENANCE", "BREAKDOWN"], 
    default: "AVAILABLE",
    index: true 
  },
  fuelLevelPct: { type: Number, default: 90, min: 0, max: 100 },
  mileageKm: { type: Number, default: 12500 },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", default: null },
  lastMaintenanceDate: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model("Vehicle", vehicleSchema);
