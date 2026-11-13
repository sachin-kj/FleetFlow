import mongoose from "mongoose";

const locationHistorySchema = new mongoose.Schema({
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", required: true, index: true },
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
  location: {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  speedKmh: { type: Number, default: 0 },
  headingDeg: { type: Number, default: 0 },
  isSimulated: { type: Boolean, default: false, index: true },
  recordedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

locationHistorySchema.index({ driverId: 1, recordedAt: -1 });
locationHistorySchema.index({ location: "2dsphere" });

export default mongoose.model("LocationHistory", locationHistorySchema);
