import mongoose from "mongoose";

const taskEventSchema = new mongoose.Schema({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
  type: { 
    type: String, 
    enum: [
      "CREATED", 
      "ASSIGNING", 
      "ASSIGNED", 
      "REASSIGNED",
      "ACCEPTED", 
      "REJECTED",
      "PICKED_UP", 
      "IN_TRANSIT", 
      "DELIVERED", 
      "CANCELLED", 
      "DELAYED",
      "RECOVERY_REQUIRED",
      "BREAKDOWN_ALERT"
    ],
    required: true,
    index: true 
  },
  message: { type: String, required: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  actorName: { type: String, default: "System" }
}, { timestamps: true });

taskEventSchema.index({ taskId: 1, createdAt: 1 });

export default mongoose.model("TaskEvent", taskEventSchema);
