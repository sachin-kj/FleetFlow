import mongoose from "mongoose";

const driverSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  phone: { type: String, default: "" },
  licenseNumber: { type: String, default: "" },
  availability: { 
    type: String, 
    enum: ["AVAILABLE", "BUSY", "OFFLINE", "ON_BREAK"], 
    default: "AVAILABLE",
    index: true 
  },
  shiftStatus: {
    type: String,
    enum: ["ACTIVE", "INACTIVE", "ON_BREAK"],
    default: "ACTIVE"
  },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", default: null },
  currentLocation: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], default: [76.6394, 12.2958] } // [lng, lat]
  },
  speedKmh: { type: Number, default: 0 },
  headingDeg: { type: Number, default: 0 },
  isSimulated: { type: Boolean, default: false },
  lastSeenAt: { type: Date, default: Date.now },
  activeTaskCount: { type: Number, default: 0, min: 0 },
  totalDeliveries: { type: Number, default: 0 },
  onTimeRate: { type: Number, default: 98.5 }, // percentage
  rating: { type: Number, default: 4.8 }
}, { timestamps: true });

driverSchema.index({ currentLocation: "2dsphere" });
driverSchema.index({ availability: 1, activeTaskCount: 1 });

export default mongoose.model("Driver", driverSchema);
