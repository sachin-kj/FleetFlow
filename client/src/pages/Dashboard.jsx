import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Truck,
  Users,
  Package,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
  ArrowUpRight,
  Plus,
  RefreshCw,
  Play,
  Square,
  Radio,
  Sparkles,
  TrendingUp,
  ChevronRight,
  ShieldAlert
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import api from "../api";
import { useSocket } from "../context/SocketContext";
import Badge from "../components/common/Badge";
import Modal from "../components/common/Modal";

export default function Dashboard() {
  const { locations, simulationStatus } = useSocket();
  const [overview, setOverview] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [breakdownResult, setBreakdownResult] = useState(null);

  async function loadData() {
    try {
      const [ovRes, tasksRes, vehRes] = await Promise.all([
        api.get("/fleet/overview"),
        api.get("/fleet/tasks?limit=10"),
        api.get("/fleet/vehicles")
      ]);
      setOverview(ovRes.data);
      setTasks(tasksRes.data);
      setVehicles(vehRes.data);
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  async function handleQuickCreateAndAssign() {
    setBusyAction(true);
    try {
      const demoTask = {
        title: `Express Restock #${Math.floor(1000 + Math.random() * 9000)}`,
        pickup: { label: "Mysuru Central Hub", coordinates: [76.6394, 12.2958], address: "Ring Road Hub 4" },
        destination: { label: "Vijayanagar Outlet", coordinates: [76.6170, 12.3280], address: "Vijayanagar 4th Stage" },
        cargoKg: 280,
        volumeM3: 1.5,
        requiredVehicleType: "CAR",
        priority: "HIGH",
        deadline: new Date(Date.now() + 3 * 3600000)
      };

      const { data: created } = await api.post("/fleet/tasks", demoTask);
      const { data: assigned } = await api.post(`/fleet/tasks/${created._id}/assign`);
      alert(`Task created & auto-assigned to Driver with matching score ${assigned.score}!`);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create and assign task");
    } finally {
      setBusyAction(false);
    }
  }

  async function triggerBreakdown() {
    if (!selectedVehicleId) return;
    setBusyAction(true);
    try {
      const { data } = await api.post(`/fleet/vehicles/${selectedVehicleId}/breakdown`, {
        type: "BREAKDOWN",
        severity: "HIGH",
        description: "Emergency engine overheat simulation triggered from dispatcher console"
      });
      setBreakdownResult(data);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Breakdown simulation failed");
    } finally {
      setBusyAction(false);
    }
  }

  const chartData = [
    { name: "Created", count: overview?.statusBreakdown?.CREATED || 0, color: "#94a3b8" },
    { name: "Assigned", count: overview?.statusBreakdown?.ASSIGNED || 0, color: "#38bdf8" },
    { name: "In Transit", count: (overview?.statusBreakdown?.IN_TRANSIT || 0) + (overview?.statusBreakdown?.PICKED_UP || 0), color: "#3b82f6" },
    { name: "Delivered", count: overview?.statusBreakdown?.DELIVERED || 0, color: "#10b981" },
    { name: "Recovery", count: overview?.statusBreakdown?.RECOVERY_REQUIRED || 0, color: "#f43f5e" }
  ];

  return (
    <div className="space-y-6">
      {/* Top Welcome & Actions Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 border border-blue-200/60 px-2.5 py-0.5 rounded-full">
              Operations Center
            </span>
            <span className="text-xs text-slate-400">Mysuru Commercial Hub</span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 mt-1">
            Dispatch Command Overview
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time fleet telemetry, active delivery pipelines, and intelligent resource allocation.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={loadData}
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition"
            title="Refresh statistics"
          >
            <RefreshCw size={16} />
          </button>

          <button
            onClick={() => {
              setBreakdownResult(null);
              setSelectedVehicleId(vehicles.find((v) => v.status === "BUSY")?._id || vehicles[0]?._id || "");
              setBreakdownModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-xs flex items-center gap-1.5 transition"
          >
            <AlertTriangle size={15} /> Simulate Breakdown
          </button>

          <button
            onClick={handleQuickCreateAndAssign}
            disabled={busyAction}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition disabled:opacity-60"
          >
            <Plus size={15} /> {busyAction ? "Dispatching..." : "Quick Dispatch"}
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Fleet Vehicles</span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Truck size={17} />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-display font-extrabold text-3xl text-slate-900">
              {overview?.vehicles ?? "—"}
            </div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <span className="font-semibold text-emerald-600">{overview?.vehiclesBusy || 0} busy</span> &bull; {overview?.fleetUtilizationPct || 0}% utilization
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Available Drivers</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Users size={17} />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-display font-extrabold text-3xl text-slate-900">
              {overview?.availableDrivers ?? "—"}
            </div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> Ready for immediate dispatch
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Active Deliveries</span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Package size={17} />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-display font-extrabold text-3xl text-slate-900">
              {overview?.activeTasks ?? "—"}
            </div>
            <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
              <span className="font-semibold text-blue-600">{overview?.completedTasks || 0}</span> delivered successfully
            </div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-xs font-bold uppercase tracking-wider">Open Incidents</span>
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertTriangle size={17} />
            </div>
          </div>
          <div className="mt-4">
            <div className="font-display font-extrabold text-3xl text-slate-900">
              {overview?.openIncidents ?? 0}
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {overview?.delayedTasks > 0 ? (
                <span className="text-rose-600 font-semibold">{overview.delayedTasks} task(s) past SLA</span>
              ) : (
                <span className="text-emerald-600 font-semibold">All deliveries on track</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Middle Grid: Mini Fleet Map & Task Pipeline Chart */}
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* Live Mini Map */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-base text-slate-900">
                  Live Transponder Map
                </h3>
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Radio size={12} className="animate-pulse" /> LIVE
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time vehicle coordinates & telemetry tracking
              </p>
            </div>
            <Link
              to="/map"
              className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              Full Screen Map <ArrowUpRight size={14} />
            </Link>
          </div>

          <div className="h-[340px] rounded-xl overflow-hidden border border-slate-100">
            <MapContainer
              center={[12.3120, 76.6450]}
              zoom={12}
              scrollWheelZoom={false}
              className="w-full h-full"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {locations.map((loc) => (
                <CircleMarker
                  key={loc.driverId}
                  center={[loc.latitude || loc.coordinates?.[1] || 12.3, loc.longitude || loc.coordinates?.[0] || 76.6]}
                  radius={7}
                  pathOptions={{
                    color: loc.availability === "BUSY" ? "#3b82f6" : "#10b981",
                    fillColor: loc.availability === "BUSY" ? "#2563eb" : "#059669",
                    fillOpacity: 0.9,
                    weight: 2
                  }}
                >
                  <Popup>
                    <div className="text-xs space-y-1">
                      <p className="font-bold text-slate-900">{loc.driverName || "Driver"}</p>
                      <p className="text-slate-500">{loc.vehicleNumber} &bull; {loc.speedKmh || 0} km/h</p>
                      <Badge status={loc.availability || "AVAILABLE"} size="xs" />
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>

        {/* Delivery Pipeline Chart */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900">
                  Delivery Pipeline Status
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Tasks currently moving through lifecycle</p>
              </div>
              <Link to="/tasks" className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                View All <ChevronRight size={14} />
              </Link>
            </div>

            <div className="h-[240px] w-full mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              <span className="text-slate-400 block font-medium">Auto-dispatch SLA</span>
              <span className="font-bold text-slate-900 mt-0.5 block text-sm">&lt; 3.2 seconds</span>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              <span className="text-slate-400 block font-medium">On-Time Completion</span>
              <span className="font-bold text-emerald-600 mt-0.5 block text-sm">98.4%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Grid: Recent Delivery Tasks & Live Activity Feed */}
      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* Recent Tasks Table */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900">Recent Deliveries</h3>
              <p className="text-xs text-slate-500 mt-0.5">Active operational assignments</p>
            </div>
            <Link to="/tasks" className="text-xs font-bold text-blue-600 hover:text-blue-700">
              Manage Tasks &rarr;
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/75 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
                <tr>
                  <th className="py-3 px-5">Task</th>
                  <th className="py-3 px-4">Route</th>
                  <th className="py-3 px-4">Cargo</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Driver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tasks.slice(0, 6).map((t) => (
                  <tr key={t._id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 px-5">
                      <div className="font-bold text-slate-900 truncate max-w-[180px]">{t.title}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{t.trackingNumber || t._id.slice(-6)}</div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      <div className="truncate max-w-[140px] font-medium">{t.pickup?.label}</div>
                      <div className="text-[10px] text-slate-400 truncate max-w-[140px]">
                        &rarr; {t.destination?.label}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-700">
                      {t.cargoKg} kg
                      <span className="block text-[10px] text-slate-400 font-normal">{t.requiredVehicleType}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge status={t.status} size="xs" />
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-700">
                      {t.driverId?.userId?.name || <span className="text-slate-400 italic">Unassigned</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Live Operational Events Feed */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900">Operational Activity</h3>
              <p className="text-xs text-slate-500 mt-0.5">Real-time audit log stream</p>
            </div>
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
          </div>

          <div className="space-y-3.5 flex-1 overflow-y-auto max-h-[340px] pr-1">
            {(overview?.recentEvents || []).map((ev) => (
              <div key={ev._id} className="flex items-start gap-3 text-xs border-b border-slate-50 pb-3 last:border-0">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                  <Activity size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 leading-tight">{ev.message}</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {new Date(ev.createdAt).toLocaleTimeString()} &bull; {ev.actorName || "System Auto-Dispatch"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Vehicle Breakdown Simulation Modal */}
      <Modal
        isOpen={breakdownModalOpen}
        onClose={() => setBreakdownModalOpen(false)}
        title="Simulate Vehicle Breakdown"
        subtitle="Test automatic reassignment and emergency cargo recovery workflows"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Reporting a breakdown immediately sets the vehicle to <strong className="text-rose-600">BREAKDOWN</strong>, 
            takes the driver <strong className="text-slate-700">OFFLINE</strong>, and triggers:
          </p>
          <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-5">
            <li><strong>Unpicked Tasks (ASSIGNED, ACCEPTED):</strong> Automatically re-assigned using the intelligent scoring algorithm to the highest-scoring replacement driver.</li>
            <li><strong>In-Transit Cargo (PICKED_UP, IN_TRANSIT):</strong> Marked <strong>RECOVERY_REQUIRED</strong> requiring a physical recovery unit.</li>
          </ul>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Select Fleet Vehicle
            </label>
            <select
              value={selectedVehicleId}
              onChange={(e) => setSelectedVehicleId(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              {vehicles.map((v) => (
                <option key={v._id} value={v._id}>
                  {v.registrationNumber} ({v.type} - {v.capacityKg} kg) &mdash; {v.status}
                </option>
              ))}
            </select>
          </div>

          {breakdownResult && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
              <p className="font-bold text-slate-900">Simulation Outcome:</p>
              <p className="text-slate-600">
                Incident Created: <strong>{breakdownResult.incident?._id}</strong>
              </p>
              <div className="space-y-1">
                {breakdownResult.results?.map((r, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-white border border-slate-100">
                    <span className="font-medium text-slate-800">{r.title || r.taskId}</span>
                    <Badge status={r.outcome} size="xs" />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setBreakdownModalOpen(false)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={triggerBreakdown}
              disabled={busyAction || !selectedVehicleId}
              className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-rose-600/20 disabled:opacity-50"
            >
              <AlertTriangle size={15} /> Confirm Breakdown
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
