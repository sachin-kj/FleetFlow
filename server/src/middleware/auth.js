import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import Driver from "../models/Driver.js";

/**
 * Validates whether a given string is a valid MongoDB ObjectId
 */
export function isValidObjectId(id) {
  return Boolean(id && mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id));
}

/**
 * Reads JWT_SECRET exclusively from process.env.JWT_SECRET.
 * Fails safely with a clear configuration error if JWT_SECRET is missing or empty.
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== "string" || !secret.trim()) {
    throw new Error("Configuration error: JWT_SECRET environment variable is missing or empty. Authentication cannot function without a valid JWT_SECRET.");
  }
  return secret.trim();
}

/**
 * Protect middleware:
 * 1. Extracts and verifies Bearer JWT token
 * 2. Fetches user record (excluding passwordHash)
 * 3. If user is a DRIVER, attaches their Driver profile to req.driver
 * 4. Rejects invalid, expired, or non-existent user tokens
 */
export async function protect(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Authentication token is missing or malformed"
      });
    }

    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: "Bearer token cannot be empty"
      });
    }

    const jwtSecret = getJwtSecret();
    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch (jwtErr) {
      if (jwtErr.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          code: "TOKEN_EXPIRED",
          message: "Session expired. Please log in again."
        });
      }
      return res.status(401).json({
        success: false,
        code: "TOKEN_INVALID",
        message: "Invalid authentication credentials"
      });
    }

    const user = await User.findById(payload.id).select("-passwordHash");
    if (!user) {
      return res.status(401).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "The user account associated with this session no longer exists"
      });
    }

    req.user = user;

    // If user is a DRIVER, attach driver profile to request for zero-trust driver ID validation
    if (user.role === "DRIVER") {
      const driver = await Driver.findOne({ userId: user._id }).populate("vehicleId");
      req.driver = driver || null;
    } else {
      req.driver = null;
    }

    next();
  } catch (err) {
    console.error("Auth middleware error:", err.message || err);
    return res.status(500).json({
      success: false,
      code: "SERVER_AUTH_ERROR",
      message: err.message || "Internal authentication error"
    });
  }
}

/**
 * Role-Based Access Control (RBAC) middleware:
 * Ensures the authenticated user possesses at least one of the specified roles.
 */
export const allow = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      code: "AUTH_REQUIRED",
      message: "Authentication required"
    });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      code: "FORBIDDEN",
      message: `Access denied. Role '${req.user.role}' is not authorized for this action.`
    });
  }

  next();
};

/**
 * Dedicated middleware: Requires verified DRIVER role and active driver profile
 */
export function requireDriver(req, res, next) {
  if (!req.user || req.user.role !== "DRIVER") {
    return res.status(403).json({
      success: false,
      code: "DRIVER_ROLE_REQUIRED",
      message: "This resource is reserved exclusively for Driver accounts."
    });
  }

  if (!req.driver) {
    return res.status(404).json({
      success: false,
      code: "DRIVER_PROFILE_NOT_FOUND",
      message: "Driver profile could not be found for this account."
    });
  }

  next();
}

/**
 * Middleware to validate URL route ID parameters as valid Mongo ObjectIds
 */
export function validateObjectIdParam(paramName = "id") {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_IDENTIFIER",
        message: `Resource identifier '${id}' is invalid.`
      });
    }
    next();
  };
}
