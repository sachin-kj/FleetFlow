import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Driver from "../models/Driver.js";
import { protect, getJwtSecret } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

router.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ message: "Invalid email or password" });
  }

  const jwtSecret = getJwtSecret();
  const token = jwt.sign(
    { id: user._id, role: user.role, email: user.email }, 
    jwtSecret, 
    { expiresIn: "7d" }
  );

  let driverProfile = null;
  if (user.role === "DRIVER") {
    driverProfile = await Driver.findOne({ userId: user._id }).populate("vehicleId");
  }

  res.json({
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      driverId: driverProfile?._id || null,
      vehicle: driverProfile?.vehicleId || null
    }
  });
}));

router.get("/me", protect, asyncHandler(async (req, res) => {
  let driverProfile = null;
  if (req.user.role === "DRIVER") {
    driverProfile = await Driver.findOne({ userId: req.user._id }).populate("vehicleId");
  }
  res.json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      phone: req.user.phone,
      driverId: driverProfile?._id || null,
      vehicle: driverProfile?.vehicleId || null
    }
  });
}));

router.post("/logout", protect, asyncHandler(async (_req, res) => {
  res.json({ message: "Logged out successfully" });
}));

export default router;
