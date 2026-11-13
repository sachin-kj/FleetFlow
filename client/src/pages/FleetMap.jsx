import { useState, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Truck,
  Navigation,
  Play,
  Square,
  Search,
  Filter,
  Radio,
  Gauge,
  Compass,
  CheckCircle2,
  AlertTriangle,
  RotateCcw
} from "lucide-react";
import api from "../api";
import { useSocket } from "../context/SocketContext";
import Badge from "../components/common/Badge";

// Fix standard Leaflet default icon issues in bundlers
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png"
});

function createDriverIcon(status, heading = 0, isSimulated = false) {
  const color = status === "AVAILABLE" ? "#10b981" : status === "BUSY" ? "#2563eb" : "#94a3b8";
  return L.divIcon({
    className: "custom-driver-marker",
    html: `
      <div style="transform: rotate(${heading}deg); transition: transform 0.4s ease;" class="relative flex items-center justify-center">
        <div style="background-color: ${color};" class="w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-lg border-2 border-white">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
          </svg>
        </div>
        ${isSimulated ? `<span class="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-purple-500 border border-white"></span>` : ""}
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -18]
  });
}

function MapRecenter({ coords }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length === 2) {
      map.flyTo([coords[1], coords[0]], 14, { duration: 1.2 });
    }
  }, [coords, map]);
  return null;
}

export default function FleetMap() {
  const { locations, simulationStatus } = useSocket();
  const [drivers, setDrivers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [selectedRoute, setSelectedRoute] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [availabilityFilter, setAvailabilityFilter] = useState("ALL");
  const [targetCoords, setTargetCoords] = useState([76.6450, 12.3120]);

  async function loadData() {
    try {
      const [drvRes, tasksRes] = await Promise.all([
        api.get("/fleet/drivers"),
        api.get("/fleet/tasks?status=IN_TRANSIT,PICKED_UP,ASSIGNED")
      ]);
      setDrivers(drvRes.data);
      setTasks(tasksRes.data);
    } catch (err) {
      console.error("Failed to load map data:", err);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  // Merge static driver data with live socket telemetry
  const mergedDrivers = drivers.map((d) => {
    const live = locations.find((l) => l.driverId === d._id.toString());
    const coords = live
      ? [live.longitude, live.latitude]
      : d.currentLocation?.coordinates || [76.6394, 12.2958];
    const speed = live?.speedKmh ?? d.speedKmh ?? 0;
    const heading = live?.headingDeg ?? d.headingDeg ?? 0;
    const isSimulated = live?.isSimulated ?? d.isSimulated ?? false;

    // Check if this driver has an active task
    const activeTask = tasks.find((t) => t.driverId?._id === d._id || t.driverId === d._id);

    return {
      ...d,
      coords,
      speed,
      heading,
      isSimulated,
      activeTask
    };
  });

  const filteredDrivers = mergedDrivers.filter((d) => {
    const nameMatch =
      d.userId?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.vehicleId?.registrationNumber?.toLowerCase().includes(searchTerm.toLowerCase());
    const typeMatch = typeFilter === "ALL" || d.vehicleId?.type === typeFilter;
    const availMatch = availabilityFilter === "ALL" || d.availability === availabilityFilter;
    return nameMatch && typeMatch && availMatch;
  });

  async function toggleSimulation() {
    try {
      if (simulationStatus.isRunning) {
        await api.post("/fleet/simulation/stop");
      } else {
        await api.post("/fleet/simulation/start");
      }
    } catch (err) {
      alert("Failed to change simulation status");
    }
  }

  async function changeSpeed(multiplier) {
    try {
      await api.post("/fleet/simulation/speed", { multiplier });
    } catch (err) {
      console.error(err);
    }
  }

  function handleSelectDriver(d) {
    setSelectedDriver(d);
    setTargetCoords(d.coords);

    if (d.activeTask && d.activeTask.pickup?.coordinates && d.activeTask.destination?.coordinates) {
      setSelectedRoute([
        [d.activeTask.pickup.coordinates[1], d.activeTask.pickup.coordinates[0]],
        [d.coords[1], d.coords[0]],
        [d.activeTask.destination.coordinates[1], d.activeTask.destination.coordinates[0]]
      ]);
    } else {
      setSelectedRoute(null);
    }
  }

  return (
    <div className="h-[calc(100vh-8.5rem)] flex flex-col rounded-2xl overflow-hidden border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] bg-white relative">
      {/* Map Control Overlay Header */}
      <div className="p-4 border-b border-slate-200/80 bg-white/95 backdrop-blur-sm z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-extrabold text-lg text-slate-900">Live Fleet Map</h2>
            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
              <Radio size={12} className="animate-pulse" /> Live Telemetry
            </span>
          </div>

          <span className="text-slate-300 hidden sm:inline">|</span>

          {/* Telemetry Distinction Badge */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1 rounded-xl">
            <span className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="font-semibold">Purple dot</span> = Simulated GPS
            <span className="w-2 h-2 rounded-full bg-emerald-500 ml-2" />
            <span className="font-semibold">Green dot</span> = Live Available
          </div>
        </div>

        {/* GPS Simulation Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleSimulation}
            className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-sm transition ${
              simulationStatus.isRunning
                ? "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20"
                : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20"
            }`}
          >
            {simulationStatus.isRunning ? (
              <>
                <Square size={13} className="fill-current" /> Pause Movement
              </>
            ) : (
              <>
                <Play size={13} className="fill-current" /> Run GPS Simulation
              </>
            )}
          </button>

          <div className="flex items-center bg-slate-100 rounded-xl p-0.5 border border-slate-200 text-xs font-bold">
            {[1, 2, 3, 5].map((multiplier) => (
              <button
                key={multiplier}
                onClick={() => changeSpeed(multiplier)}
                className={`px-2 py-1 rounded-lg transition ${
                  simulationStatus.speedMultiplier === multiplier
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {multiplier}x
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Floating Left Driver Drawer / Search Panel */}
        <div className="w-80 border-r border-slate-200/80 bg-white flex flex-col z-10 shrink-0">
          <div className="p-3 border-b border-slate-100 space-y-2.5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search driver or plate..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-700 bg-white"
              >
                <option value="ALL">All Types</option>
                <option value="BIKE">Bikes</option>
                <option value="CAR">Cars</option>
                <option value="VAN">Vans</option>
                <option value="TRUCK">Trucks</option>
              </select>

              <select
                value={availabilityFilter}
                onChange={(e) => setAvailabilityFilter(e.target.value)}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-700 bg-white"
              >
                <option value="ALL">All Status</option>
                <option value="AVAILABLE">Available</option>
                <option value="BUSY">Busy</option>
                <option value="OFFLINE">Offline</option>
              </select>
            </div>
          </div>

          {/* Drivers List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredDrivers.map((d) => (
              <div
                key={d._id}
                onClick={() => handleSelectDriver(d)}
                className={`p-3 cursor-pointer transition text-xs ${
                  selectedDriver?._id === d._id ? "bg-blue-50/70 border-l-4 border-blue-600" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{d.userId?.name || "Driver"}</span>
                  <Badge status={d.availability} size="xs" />
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                  <span>{d.vehicleId?.registrationNumber || "Unassigned"} ({d.vehicleId?.type || "CAR"})</span>
                  <span className="font-semibold text-slate-700">{d.speed} km/h</span>
                </div>
                {d.activeTask && (
                  <div className="mt-1.5 p-1.5 rounded bg-blue-100/50 text-[10px] text-blue-900 font-medium truncate">
                    &bull; {d.activeTask.title}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Map Container */}
        <div className="flex-1 h-full w-full relative z-0">
          <MapContainer
            center={[12.3120, 76.6450]}
            zoom={13}
            scrollWheelZoom={true}
            className="w-full h-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <MapRecenter coords={targetCoords} />

            {/* Drivers on map */}
            {filteredDrivers.map((d) => (
              <Marker
                key={d._id}
                position={[d.coords[1], d.coords[0]]}
                icon={createDriverIcon(d.availability, d.heading, d.isSimulated)}
                eventHandlers={{
                  click: () => handleSelectDriver(d)
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1.5 p-1 min-w-[190px]">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-slate-900">{d.userId?.name}</span>
                      <Badge status={d.availability} size="xs" />
                    </div>
                    <p className="text-slate-600">
                      Vehicle: <strong>{d.vehicleId?.registrationNumber}</strong> ({d.vehicleId?.type})
                    </p>
                    <div className="flex items-center justify-between text-slate-500 pt-1 border-t border-slate-100">
                      <span>Speed: {d.speed} km/h</span>
                      <span>Heading: {d.heading}&deg;</span>
                    </div>
                    {d.isSimulated && (
                      <span className="inline-block text-[10px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded">
                        Simulated Route
                      </span>
                    )}
                    {d.activeTask && (
                      <div className="mt-2 p-2 bg-blue-50 rounded-lg text-blue-900">
                        <p className="font-bold text-[11px]">{d.activeTask.title}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">Cargo: {d.activeTask.cargoKg} kg</p>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}

            {/* Active Task Route Polyline */}
            {selectedRoute && (
              <Polyline
                positions={selectedRoute}
                color="#2563eb"
                weight={4}
                opacity={0.8}
                dashArray="6, 8"
              />
            )}
          </MapContainer>

          {/* Selected Driver Floating Card */}
          {selectedDriver && (
            <div className="absolute bottom-5 right-5 z-[400] w-80 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-display font-bold text-sm text-slate-900">
                    {selectedDriver.userId?.name}
                  </h4>
                  <p className="text-xs text-slate-500">{selectedDriver.vehicleId?.registrationNumber}</p>
                </div>
                <Badge status={selectedDriver.availability} size="xs" />
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 text-xs bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block font-medium">Speed</span>
                  <span className="font-bold text-slate-800">{selectedDriver.speed} km/h</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Telemetry</span>
                  <span className="font-bold text-slate-800">
                    {selectedDriver.isSimulated ? "Simulated" : "Actual GPS"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Capacity</span>
                  <span className="font-bold text-slate-800">{selectedDriver.vehicleId?.capacityKg || 0} kg</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Phone</span>
                  <span className="font-bold text-slate-800">{selectedDriver.phone || "+91 98450 00000"}</span>
                </div>
              </div>

              {selectedDriver.activeTask && (
                <div className="mt-3 p-2.5 bg-blue-50/70 border border-blue-200/60 rounded-xl text-xs">
                  <span className="text-[10px] uppercase font-bold text-blue-600 block">Active Task</span>
                  <span className="font-bold text-slate-900 block truncate">{selectedDriver.activeTask.title}</span>
                  <span className="text-slate-500 text-[11px] block mt-0.5">
                    {selectedDriver.activeTask.pickup?.label} &rarr; {selectedDriver.activeTask.destination?.label}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
