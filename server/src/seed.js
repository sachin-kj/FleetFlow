import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "./config/db.js";
import User from "./models/User.js";
import Driver from "./models/Driver.js";
import Vehicle from "./models/Vehicle.js";
import Task from "./models/Task.js";
import TaskEvent from "./models/TaskEvent.js";
import Incident from "./models/Incident.js";
import Notification from "./models/Notification.js";
import LocationHistory from "./models/LocationHistory.js";

await connectDB();

console.log("Purging old demo data...");
await Promise.all([
  User.deleteMany({}),
  Driver.deleteMany({}),
  Vehicle.deleteMany({}),
  Task.deleteMany({}),
  TaskEvent.deleteMany({}),
  Incident.deleteMany({}),
  Notification.deleteMany({}),
  LocationHistory.deleteMany({})
]);

const passwordHash = await bcrypt.hash("FleetFlow123!", 10);

console.log("Seeding users...");
// 1. Users: 1 Admin, 2 Dispatchers, 1 Manager, 12 Drivers
const adminUser = await User.create({
  name: "Marcus Vance",
  email: "admin@fleetflow.demo",
  passwordHash,
  role: "ADMIN",
  phone: "+91 98450 11001"
});

const dispatchers = await User.insertMany([
  {
    name: "Elena Rostova",
    email: "dispatch@fleetflow.demo",
    passwordHash,
    role: "DISPATCHER",
    phone: "+91 98450 22001"
  },
  {
    name: "Devon Chen",
    email: "dispatch2@fleetflow.demo",
    passwordHash,
    role: "DISPATCHER",
    phone: "+91 98450 22002"
  }
]);

const managerUser = await User.create({
  name: "Sophia Sterling",
  email: "manager@fleetflow.demo",
  passwordHash,
  role: "MANAGER",
  phone: "+91 98450 33001"
});

const driverNames = [
  "Aarav Sharma", "Priya Nair", "Vikram Rathore", "Kavita Rao",
  "Rohan Kulkarni", "Deepak Verma", "Ananya Deshmukh", "Rajesh Patel",
  "Farhan Akhtar", "Sunil Gowda", "Meera Hegde", "Arjun Prasad"
];

const driverUsers = await User.insertMany(
  driverNames.map((name, i) => ({
    name,
    email: `driver${i + 1}@fleetflow.demo`,
    passwordHash,
    role: "DRIVER",
    phone: `+91 98450 4400${i < 9 ? "0" + (i + 1) : i + 1}`
  }))
);

console.log("Seeding 12 vehicles (CAR, VAN, TRUCK, BIKE)...");
// 12 Vehicles
const vehicleConfigs = [
  // 2 Bikes
  { reg: "KA09FF1001", type: "BIKE", cap: 45, vol: 0.3, model: "Hero Electric Nyx", status: "AVAILABLE" },
  { reg: "KA09FF1002", type: "BIKE", cap: 55, vol: 0.4, model: "TVS iQube Courier", status: "AVAILABLE" },
  // 4 Cars
  { reg: "KA09FF1003", type: "CAR", cap: 350, vol: 1.5, model: "Maruti Suzuki Dzire Tour", status: "AVAILABLE" },
  { reg: "KA09FF1004", type: "CAR", cap: 400, vol: 1.8, model: "Tata Tigor EV Express", status: "AVAILABLE" },
  { reg: "KA09FF1005", type: "CAR", cap: 380, vol: 1.6, model: "Hyundai Aura Cargo", status: "BUSY" },
  { reg: "KA09FF1006", type: "CAR", cap: 420, vol: 2.0, model: "Mahindra eVerito Delivery", status: "AVAILABLE" },
  // 4 Vans
  { reg: "KA09FF1007", type: "VAN", cap: 850, vol: 4.5, model: "Tata Ace EV Super", status: "AVAILABLE" },
  { reg: "KA09FF1008", type: "VAN", cap: 1000, vol: 5.2, model: "Mahindra Bolero Maxi", status: "BUSY" },
  { reg: "KA09FF1009", type: "VAN", cap: 1100, vol: 6.0, model: "Ashok Leyland BADA DOST", status: "AVAILABLE" },
  { reg: "KA09FF1010", type: "VAN", cap: 950, vol: 4.8, model: "Force Urbania Courier", status: "BREAKDOWN" },
  // 2 Trucks
  { reg: "KA09FF1011", type: "TRUCK", cap: 3200, vol: 14.0, model: "Eicher Pro 2049 Light", status: "AVAILABLE" },
  { reg: "KA09FF1012", type: "TRUCK", cap: 5000, vol: 22.0, model: "BharatBenz 1015R Express", status: "AVAILABLE" }
];

const vehicles = await Vehicle.insertMany(
  vehicleConfigs.map(c => ({
    registrationNumber: c.reg,
    type: c.type,
    capacityKg: c.cap,
    volumeM3: c.vol,
    modelName: c.model,
    status: c.status,
    fuelLevelPct: Math.floor(65 + Math.random() * 30),
    mileageKm: Math.floor(8000 + Math.random() * 25000)
  }))
);

console.log("Seeding 12 drivers linked to vehicles...");
// Predefined Mysuru coordinates around main delivery hubs
const initialCoords = [
  [76.6394, 12.2958], [76.6170, 12.3280], [76.6350, 12.3500], [76.6650, 12.3050],
  [76.6450, 12.3120], [76.6550, 12.3380], [76.6210, 12.3150], [76.6290, 12.3200],
  [76.6680, 12.3180], [76.6300, 12.3020], [76.6120, 12.3620], [76.6501, 12.3120]
];

const drivers = await Driver.insertMany(
  driverUsers.map((u, i) => ({
    userId: u._id,
    vehicleId: vehicles[i]._id,
    licenseNumber: `KA-09-${2020 + (i % 4)}-${100234 + i}`,
    availability: vehicles[i].status === "BREAKDOWN" ? "OFFLINE" : vehicles[i].status === "BUSY" ? "BUSY" : "AVAILABLE",
    currentLocation: {
      type: "Point",
      coordinates: initialCoords[i]
    },
    speedKmh: vehicles[i].status === "BUSY" ? 42 : 0,
    headingDeg: 90 * (i % 4),
    isSimulated: true,
    lastSeenAt: new Date(),
    activeTaskCount: vehicles[i].status === "BUSY" ? 1 : 0,
    totalDeliveries: 45 + i * 8,
    onTimeRate: Number((95 + Math.random() * 4.8).toFixed(1)),
    rating: Number((4.6 + Math.random() * 0.4).toFixed(1))
  }))
);

// Link vehicle.driverId
await Promise.all(
  vehicles.map((v, i) => Vehicle.updateOne({ _id: v._id }, { $set: { driverId: drivers[i]._id } }))
);

console.log("Seeding 30 delivery tasks...");
const hubs = [
  { label: "Mysuru Central Distribution Hub", coordinates: [76.6394, 12.2958], address: "Ring Road Hub 4, Industrial Area" },
  { label: "Hebbal Industrial Depot", coordinates: [76.6350, 12.3500], address: "Hebbal Electronic City Phase 1" },
  { label: "Vijayanagar Logistics Park", coordinates: [76.6170, 12.3280], address: "Vijayanagar 4th Stage Complex" },
  { label: "Nazarbad Regional Hub", coordinates: [76.6650, 12.3050], address: "Nazarbad Main Road Terminal" },
  { label: "KRS Road Warehouse", coordinates: [76.6210, 12.3500], address: "KRS Road Logistics Depot" },
  { label: "Kuvempunagar Retail Depot", coordinates: [76.6250, 12.2850], address: "Kuvempunagar M-Block" }
];

const destinations = [
  { label: "MedPlus Pharmacy Distribution", coordinates: [76.6450, 12.3120], address: "Sayyaji Rao Road" },
  { label: "Reliance Digital Superstore", coordinates: [76.6501, 12.3120], address: "D. Devaraj Urs Road" },
  { label: "Apollo Pharmacy Hub", coordinates: [76.6290, 12.3200], address: "Kalidasa Road, Jayalakshmipuram" },
  { label: "Croma Retail Center", coordinates: [76.6680, 12.3180], address: "Bangalore-Nilgiri Road" },
  { label: "Metro Cash & Carry", coordinates: [76.6025, 12.3710], address: "Hootagalli Industrial Suburb" },
  { label: "BM Hospital Medical Supplies", coordinates: [76.6220, 12.3050], address: "Saraswathipuram" },
  { label: "FreshWorld Organic Market", coordinates: [76.6150, 12.3500], address: "Gokulam 3rd Stage" }
];

const sampleTaskTitles = [
  "Urgent Medical Oxygen & PPE Delivery",
  "E-Commerce Batch Delivery: Electronics",
  "Fresh Produce Distribution",
  "Automotive Spare Parts Shipment",
  "Industrial Lubricants & Fluids",
  "Retail Store Restock: Dairy & Chilled",
  "High-Value Consumer Tech Restock",
  "Textile & Apparel Consignment",
  "Laboratory Diagnostic Kits",
  "Cold Chain Vaccine Batch",
  "Office IT Equipment Relocation",
  "Construction Hardware Shipment",
  "Hospital Linen & Uniforms",
  "Bakery Raw Materials Batch",
  "Server Rack Components",
  "Solar Inverters & Batteries",
  "Supermarket Dry Goods Restock",
  "Beverage Pallets Distribution",
  "Urgent Document & Contract Couriers",
  "Heavy Machinery Spare Motors",
  "Express Retail Return Packages",
  "School Textbooks & Stationary",
  "Pharmaceutical Packaging Boxes",
  "Commercial Coffee Machines",
  "Gym Equipment Delivery",
  "Electric Vehicle Charger Units",
  "Chemical Reagents Safe Transit",
  "Restaurant Bulk Provisions",
  "Telecom Optical Fiber Spools",
  "Emergency Generator Parts"
];

const tasksToInsert = [];
for (let i = 0; i < 30; i++) {
  const pickup = hubs[i % hubs.length];
  const dest = destinations[i % destinations.length];
  const title = sampleTaskTitles[i];
  const cargoWeights = [35, 60, 180, 320, 550, 780, 1400, 2600];
  const cargoKg = cargoWeights[i % cargoWeights.length];

  let requiredVehicleType = "VAN";
  if (cargoKg <= 50) requiredVehicleType = "BIKE";
  else if (cargoKg <= 400) requiredVehicleType = "CAR";
  else if (cargoKg <= 1200) requiredVehicleType = "VAN";
  else requiredVehicleType = "TRUCK";

  const priorities = ["NORMAL", "HIGH", "LOW", "URGENT"];
  const priority = priorities[i % priorities.length];

  // Distribution of statuses:
  // 0-9: CREATED (10 tasks available for auto-assignment testing)
  // 10-13: ASSIGNED (4 tasks)
  // 14-16: ACCEPTED (3 tasks)
  // 17-19: PICKED_UP (3 tasks)
  // 20-22: IN_TRANSIT (3 tasks)
  // 23-27: DELIVERED (5 tasks)
  // 28-29: RECOVERY_REQUIRED (2 tasks demonstrating post-breakdown recovery)
  let status = "CREATED";
  let assignedDriver = null;
  let assignedVehicle = null;

  if (i >= 10 && i <= 13) {
    status = "ASSIGNED";
    assignedDriver = drivers[i % 8];
    assignedVehicle = vehicles[i % 8];
  } else if (i >= 14 && i <= 16) {
    status = "ACCEPTED";
    assignedDriver = drivers[(i + 1) % 8];
    assignedVehicle = vehicles[(i + 1) % 8];
  } else if (i >= 17 && i <= 19) {
    status = "PICKED_UP";
    assignedDriver = drivers[4]; // BUSY driver
    assignedVehicle = vehicles[4];
  } else if (i >= 20 && i <= 22) {
    status = "IN_TRANSIT";
    assignedDriver = drivers[7]; // BUSY driver
    assignedVehicle = vehicles[7];
  } else if (i >= 23 && i <= 27) {
    status = "DELIVERED";
    assignedDriver = drivers[i % 10];
    assignedVehicle = vehicles[i % 10];
  } else if (i >= 28) {
    status = "RECOVERY_REQUIRED";
    assignedDriver = drivers[9]; // Broken down driver
    assignedVehicle = vehicles[9]; // KA09FF1010
  }

  tasksToInsert.push({
    title,
    trackingNumber: `FF-${100020 + i}`,
    pickup,
    destination: dest,
    cargoKg,
    volumeM3: Number((cargoKg / 150).toFixed(1)),
    requiredVehicleType,
    priority,
    deadline: new Date(Date.now() + (i % 2 === 0 ? 3 : 7) * 3600000),
    status,
    driverId: assignedDriver?._id || null,
    vehicleId: assignedVehicle?._id || null,
    assignmentScore: assignedDriver ? 88.5 : null,
    scoreBreakdown: assignedDriver ? {
      distanceScore: 84.0,
      availabilityScore: 100.0,
      workloadScore: 80.0,
      deadlineScore: 90.0,
      distanceKm: 4.5
    } : null,
    assignedAt: assignedDriver ? new Date(Date.now() - 3600000) : null,
    pickedUpAt: ["PICKED_UP", "IN_TRANSIT", "DELIVERED", "RECOVERY_REQUIRED"].includes(status) ? new Date(Date.now() - 1800000) : null,
    deliveredAt: status === "DELIVERED" ? new Date(Date.now() - 300000) : null,
    createdBy: dispatchers[0]._id,
    notes: status === "RECOVERY_REQUIRED" ? "Cargo stuck in broken down vehicle KA09FF1010. Dispatch recovery van." : ""
  });
}

const tasks = await Task.insertMany(tasksToInsert);

console.log("Seeding task audit events...");
const events = tasks.map(t => ({
  taskId: t._id,
  type: t.status === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : t.status === "CREATED" ? "CREATED" : "ASSIGNED",
  message: `Task ${t.trackingNumber} status set to ${t.status}`,
  actorName: "System Seed"
}));
await TaskEvent.insertMany(events);

console.log("Seeding 3 incidents...");
// 3 Incidents
const incidents = await Incident.insertMany([
  {
    vehicleId: vehicles[9]._id, // KA09FF1010
    driverId: drivers[9]._id,
    type: "BREAKDOWN",
    severity: "HIGH",
    description: "Engine overheating on Ring Road South near Hub 4. Vehicle stalled completely.",
    coordinates: [76.6300, 12.3020],
    status: "OPEN",
    affectedTaskIds: [tasks[28]._id, tasks[29]._id]
  },
  {
    vehicleId: vehicles[2]._id, // KA09FF1003
    driverId: drivers[2]._id,
    type: "FLAT_TIRE",
    severity: "MEDIUM",
    description: "Rear tire puncture on Kalidasa Road. Replacement wheel installed from depot.",
    coordinates: [76.6380, 12.3080],
    status: "RESOLVED",
    resolutionNotes: "Spare tire fitted. Vehicle tested and returned to service.",
    resolvedAt: new Date(Date.now() - 7200000),
    resolvedBy: dispatchers[0]._id
  },
  {
    vehicleId: vehicles[6]._id, // KA09FF1007
    driverId: drivers[6]._id,
    type: "CARGO_DAMAGE",
    severity: "LOW",
    description: "Outer box dented during heavy monsoon downpour. Contents intact.",
    coordinates: [76.6550, 12.3380],
    status: "RESOLVED",
    resolutionNotes: "Cargo repackaged and verified by client representative.",
    resolvedAt: new Date(Date.now() - 18000000),
    resolvedBy: managerUser._id
  }
]);

console.log("Seeding initial notifications...");
await Notification.insertMany([
  {
    userId: dispatchers[0]._id,
    type: "BREAKDOWN",
    title: "ALERT: Vehicle KA09FF1010 Breakdown",
    message: "Engine breakdown on Ring Road South. 2 tasks require recovery coordination.",
    read: false
  },
  {
    userId: dispatchers[0]._id,
    type: "ASSIGNMENT",
    title: "Batch Dispatch Complete",
    message: "Intelligent auto-assignment successfully allocated 12 tasks to eligible drivers.",
    read: true
  },
  {
    userId: adminUser._id,
    type: "SYSTEM_ALERT",
    title: "Fleet System Online",
    message: "12 GPS transponders connected. Live telemetry simulation active.",
    read: false
  }
]);

console.log("=========================================");
console.log("   FLEETFLOW DEMO SEED DATA COMPLETE    ");
console.log("=========================================");
console.log("Demo Accounts (Password: FleetFlow123!):");
console.log("- Admin:      admin@fleetflow.demo");
console.log("- Dispatcher: dispatch@fleetflow.demo");
console.log("- Dispatcher: dispatch2@fleetflow.demo");
console.log("- Manager:    manager@fleetflow.demo");
console.log("- Drivers:    driver1@fleetflow.demo ... driver12@fleetflow.demo");
console.log("=========================================");

await mongoose.disconnect();
