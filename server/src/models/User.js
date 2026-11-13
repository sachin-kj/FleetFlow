import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true },
  role: { 
    type: String, 
    enum: ["ADMIN", "DISPATCHER", "DRIVER", "MANAGER"], 
    required: true,
    index: true 
  },
  phone: { type: String, default: "" },
  avatarUrl: { type: String, default: "" },
  companyId: { type: String, default: "demo-company" }
}, { timestamps: true });

export default mongoose.model("User", userSchema);
