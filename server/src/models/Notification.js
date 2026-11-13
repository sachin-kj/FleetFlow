import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { 
    type: String, 
    enum: ["ASSIGNMENT", "BREAKDOWN", "TASK_UPDATE", "SYSTEM_ALERT", "RECOVERY", "INFO"],
    default: "INFO" 
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
