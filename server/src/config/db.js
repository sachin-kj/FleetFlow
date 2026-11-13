import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/fleetflow";
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB at", uri);
  } catch (err) {
    console.error("MongoDB connection failed:", err.message);
    throw err;
  }
}
