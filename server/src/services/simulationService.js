import Driver from "../models/Driver.js";
import { saveDriverLocation } from "./locationService.js";

// Predefined realistic urban routes in Mysuru logistics corridor
const SIMULATED_ROUTES = [
  // Route 1: Mysuru Palace to Infosys Hebbal via Ring Road
  [
    [76.6552, 12.3051],
    [76.6501, 12.3120],
    [76.6420, 12.3210],
    [76.6345, 12.3350],
    [76.6210, 12.3500],
    [76.6120, 12.3620],
    [76.6025, 12.3710],
    [76.6150, 12.3600],
    [76.6300, 12.3400],
    [76.6450, 12.3200]
  ],
  // Route 2: Ring Road South to Vijayanagar
  [
    [76.6394, 12.2958],
    [76.6300, 12.3020],
    [76.6210, 12.3150],
    [76.6170, 12.3280],
    [76.6100, 12.3400],
    [76.6150, 12.3500],
    [76.6260, 12.3350],
    [76.6350, 12.3150]
  ],
  // Route 3: Nazarbad to Bannimantap Industrial Area
  [
    [76.6650, 12.3050],
    [76.6680, 12.3180],
    [76.6620, 12.3300],
    [76.6510, 12.3420],
    [76.6430, 12.3500],
    [76.6550, 12.3380],
    [76.6640, 12.3200]
  ],
  // Route 4: Kuvempunagar to Jayalakshmipuram
  [
    [76.6250, 12.2850],
    [76.6320, 12.2950],
    [76.6380, 12.3080],
    [76.6410, 12.3190],
    [76.6370, 12.3280],
    [76.6290, 12.3200],
    [76.6220, 12.3050]
  ]
];

function calculateHeading(p1, p2) {
  const dLon = ((p2[0] - p1[0]) * Math.PI) / 180;
  const lat1 = (p1[1] * Math.PI) / 180;
  const lat2 = (p2[1] * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  let brng = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((brng + 360) % 360);
}

class SimulationEngine {
  constructor() {
    this.timer = null;
    this.isRunning = false;
    this.intervalMs = 3000;
    this.speedMultiplier = 1;
    this.driverWaypoints = new Map(); // driverId -> { routeIndex, pointIndex, stepFraction }
  }

  async start(io, interval = 3000) {
    if (this.isRunning) return;
    this.intervalMs = interval;
    this.isRunning = true;
    console.log("GPS Simulation started.");

    // Initial setup for all drivers
    const drivers = await Driver.find({ availability: { $in: ["AVAILABLE", "BUSY"] } });
    drivers.forEach((driver, idx) => {
      if (!this.driverWaypoints.has(driver._id.toString())) {
        this.driverWaypoints.set(driver._id.toString(), {
          routeIndex: idx % SIMULATED_ROUTES.length,
          pointIndex: idx % 5,
          stepFraction: 0
        });
      }
    });

    this.timer = setInterval(async () => {
      try {
        await this.step(io);
      } catch (err) {
        console.error("Simulation step error:", err.message);
      }
    }, this.intervalMs);

    io?.to("dispatchers").emit("simulation:status", this.getStatus());
  }

  stop(io) {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log("GPS Simulation stopped.");
    io?.to("dispatchers").emit("simulation:status", this.getStatus());
  }

  setSpeed(multiplier, io) {
    this.speedMultiplier = Math.max(0.5, Math.min(5, multiplier));
    if (this.isRunning) {
      const interval = Math.round(3000 / this.speedMultiplier);
      this.stop();
      this.start(io, interval);
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      intervalMs: this.intervalMs,
      speedMultiplier: this.speedMultiplier,
      simulatedDriversCount: this.driverWaypoints.size
    };
  }

  async step(io) {
    const drivers = await Driver.find({ availability: { $in: ["AVAILABLE", "BUSY"] } })
      .populate("userId", "name")
      .populate("vehicleId");

    const updates = [];

    for (let i = 0; i < drivers.length; i++) {
      const driver = drivers[i];
      const driverIdStr = driver._id.toString();

      let state = this.driverWaypoints.get(driverIdStr);
      if (!state) {
        state = {
          routeIndex: i % SIMULATED_ROUTES.length,
          pointIndex: 0,
          stepFraction: 0
        };
        this.driverWaypoints.set(driverIdStr, state);
      }

      const route = SIMULATED_ROUTES[state.routeIndex];
      const p1 = route[state.pointIndex];
      const nextIndex = (state.pointIndex + 1) % route.length;
      const p2 = route[nextIndex];

      // Step fraction advance (interpolation between waypoints)
      state.stepFraction += 0.25 * this.speedMultiplier;
      if (state.stepFraction >= 1.0) {
        state.pointIndex = nextIndex;
        state.stepFraction = 0;
      }

      // Linear interpolation between p1 and p2
      const lng = p1[0] + (p2[0] - p1[0]) * state.stepFraction;
      const lat = p1[1] + (p2[1] - p1[1]) * state.stepFraction;

      const heading = calculateHeading(p1, p2);
      const speed = Math.round(35 + Math.random() * 18); // realistic urban delivery speed

      const updated = await saveDriverLocation(driver._id, lng, lat, {
        speedKmh: speed,
        headingDeg: heading,
        isSimulated: true
      });

      updates.push(updated);
    }

    if (io && updates.length > 0) {
      io.to("dispatchers").emit("fleet:locations:batch", updates);
      // Also emit individual change events
      updates.forEach(up => {
        io.to("dispatchers").emit("fleet:location:changed", up);
      });
    }
  }
}

export const simulationEngine = new SimulationEngine();
