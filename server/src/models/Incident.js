import mongoose from "mongoose";

const incidentSchema = new mongoose.Schema({
  vehicleId: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true, index: true },
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", index: true },
  type: { 
    type: String, 
    enum: ["BREAKDOWN", "ACCIDENT", "ENGINE_FAILURE", "FLAT_TIRE", "CARGO_DAMAGE"],
    default: "BREAKDOWN" 
  },
  severity: {
    type: String,
    enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    default: "HIGH"
  },
  description: { type: String, required: true },
  coordinates: { type: [Number], default: [76.6394, 12.2958] }, // [lng, lat]
  status: { 
    type: String, 
    enum: ["OPEN", "INVESTIGATING", "RESOLVED"], 
    default: "OPEN",
    index: true 
  },
  affectedTaskIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
  recoveryActions: [{
    action: { type: String, required: true },
    notes: { type: String, default: "" },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedByName: { type: String, default: "Dispatcher" },
    performedAt: { type: Date, default: Date.now },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    recoveryDriverId: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" }
  }],
  resolutionNotes: { type: String, default: "" },
  resolvedAt: Date,
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
}, { timestamps: true });

export default mongoose.model("Incident", incidentSchema);
