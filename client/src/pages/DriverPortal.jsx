import { useState, useEffect } from "react";
import {
  Navigation,
  Package,
  Truck,
  MapPin,
  CheckCircle2,
  Clock,
  Radio,
  Send,
  AlertCircle,
  RotateCw,
  Award,
  ChevronRight,
  ShieldCheck,
  X
} from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { getSocket } from "../socket";
import Badge from "../components/common/Badge";

export default function DriverPortal() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [gpsPingSent, setGpsPingSent] = useState(false);

  async function loadDriverPortal() {
    try {
      const { data: res } = await api.get("/fleet/driver-portal/current-task");
      setData(res);
    } catch (err) {
      console.error("Failed to load driver portal:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDriverPortal();
    const interval = setInterval(loadDriverPortal, 8000);
    return () => clearInterval(interval);
  }, []);

  async function handleStatusChange(nextStatus) {
    if (!data?.activeTask) return;
    setUpdating(true);
    try {
      await api.patch(`/fleet/tasks/${data.activeTask._id}/status`, { status: nextStatus });
      await loadDriverPortal();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to update delivery status");
    } finally {
      setUpdating(false);
    }
  }

  async function handleReject() {
    if (!data?.activeTask) return;
    const reason = window.prompt("Reason for rejecting assignment:") || "Driver unable to fulfill";
    setUpdating(true);
    try {
      await api.patch(`/fleet/tasks/${data.activeTask._id}/status`, { status: "REJECTED", reason });
      await loadDriverPortal();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to reject assignment");
    } finally {
      setUpdating(false);
    }
  }

  async function toggleAvailability(avail) {
    try {
      await api.put(`/fleet/drivers/${data.driver._id}`, { availability: avail });
      const socket = getSocket();
      socket.emit("driver:availability:update", { availability: avail });
      await loadDriverPortal();
    } catch (err) {
      console.error(err);
    }
  }

  async function sendSimulatedGpsPing() {
    if (!data?.driver) return;
    setUpdating(true);
    try {
      // Offset coordinates slightly to simulate motion
      const current = data.driver.currentLocation?.coordinates || [76.6394, 12.2958];
      const nextLng = Number((current[0] + (Math.random() - 0.48) * 0.005).toFixed(6));
      const nextLat = Number((current[1] + (Math.random() - 0.48) * 0.005).toFixed(6));

      await api.post("/fleet/driver-portal/update-location", {
        longitude: nextLng,
        latitude: nextLat,
        speedKmh: Math.floor(35 + Math.random() * 20),
        headingDeg: Math.floor(Math.random() * 360)
      });

      const socket = getSocket();
      socket.emit("driver:location:update", {
        longitude: nextLng,
        latitude: nextLat,
        speedKmh: 42,
        isSimulated: true
      });

      setGpsPingSent(true);
      setTimeout(() => setGpsPingSent(false), 2500);
      await loadDriverPortal();
    } catch (err) {
      alert("Failed to send GPS ping");
    } finally {
      setUpdating(false);
    }
  }

  const activeTask = data?.activeTask;
  const driver = data?.driver;

  return (
    <div className="max-w-xl mx-auto space-y-5 pb-12">
      {/* Driver Header Card */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold flex items-center justify-center text-lg shadow-md shadow-blue-500/20">
              {user?.name?.[0] || "D"}
            </div>
            <div>
              <h2 className="font-display font-extrabold text-lg text-slate-900 leading-tight">
                {user?.name || "Driver Operator"}
              </h2>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                <Truck size={13} className="text-blue-600" />
                <span className="font-semibold text-slate-700">
                  {driver?.vehicleId?.registrationNumber || "Unit KA09FF1004"}
                </span>
                <span>&bull;</span>
                <span>{driver?.vehicleId?.type || "VAN"}</span>
              </div>
            </div>
          </div>

          <Badge status={driver?.availability || "AVAILABLE"} size="sm" />
        </div>

        {/* Shift Availability Pill Buttons */}
        <div className="grid grid-cols-3 gap-2 mt-5 pt-4 border-t border-slate-100 text-xs font-bold">
          <button
            onClick={() => toggleAvailability("AVAILABLE")}
            className={`py-2 rounded-xl transition ${
              driver?.availability === "AVAILABLE"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            Available
          </button>
          <button
            onClick={() => toggleAvailability("ON_BREAK")}
            className={`py-2 rounded-xl transition ${
              driver?.availability === "ON_BREAK"
                ? "bg-amber-500 text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            On Break
          </button>
          <button
            onClick={() => toggleAvailability("OFFLINE")}
            className={`py-2 rounded-xl transition ${
              driver?.availability === "OFFLINE"
                ? "bg-slate-700 text-white shadow-sm"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            Offline
          </button>
        </div>
      </div>

      {/* Active Delivery Order Card */}
      {activeTask ? (
        <div className="bg-white p-6 rounded-3xl border border-blue-200/80 shadow-[0_4px_16px_rgba(37,99,235,0.06)] relative overflow-hidden">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-200/60 px-2.5 py-0.5 rounded-full">
                Active Assignment
              </span>
              <h3 className="font-display font-extrabold text-xl text-slate-900 mt-2">
                {activeTask.title}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {activeTask.trackingNumber} &bull; {activeTask.cargoKg} kg payload
              </p>
            </div>
            <Badge status={activeTask.status} size="sm" />
          </div>

          {/* Route Progression Points */}
          <div className="mt-6 space-y-4 relative">
            <div className="absolute left-3 top-3 bottom-3 w-0.5 bg-blue-100 z-0" />

            <div className="relative z-10 flex items-start gap-3.5">
              <div className="w-6 h-6 rounded-full bg-blue-50 border-2 border-blue-600 text-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
              </div>
              <div className="text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Pickup Point
                </span>
                <span className="font-bold text-slate-900 text-sm block">
                  {activeTask.pickup?.label}
                </span>
                <span className="text-slate-500 mt-0.5 block">
                  {activeTask.pickup?.address || "Warehouse Bay 3"}
                </span>
              </div>
            </div>

            <div className="relative z-10 flex items-start gap-3.5">
              <div className="w-6 h-6 rounded-full bg-emerald-50 border-2 border-emerald-600 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 size={12} className="stroke-[3]" />
              </div>
              <div className="text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Dropoff Destination
                </span>
                <span className="font-bold text-slate-900 text-sm block">
                  {activeTask.destination?.label}
                </span>
                <span className="text-slate-500 mt-0.5 block">
                  {activeTask.destination?.address || "Receiving Dock"}
                </span>
              </div>
            </div>
          </div>

          {/* Action Step Transitions */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            {activeTask.status === "ASSIGNED" && (
              <div className="flex gap-2">
                <button
                  onClick={() => handleStatusChange("ACCEPTED")}
                  disabled={updating}
                  className="flex-1 py-3.5 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md shadow-blue-600/20 transition flex items-center justify-center gap-2"
                >
                  Accept Delivery <ChevronRight size={17} />
                </button>
                <button
                  onClick={handleReject}
                  disabled={updating}
                  className="py-3.5 px-4 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-sm border border-rose-200 transition flex items-center justify-center gap-1.5"
                >
                  <X size={16} /> Reject
                </button>
              </div>
            )}

            {activeTask.status === "ACCEPTED" && (
              <button
                onClick={() => handleStatusChange("PICKED_UP")}
                disabled={updating}
                className="w-full py-3.5 px-4 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-sm shadow-md shadow-amber-600/20 transition flex items-center justify-center gap-2"
              >
                Confirm Cargo Picked Up <Package size={17} />
              </button>
            )}

            {activeTask.status === "PICKED_UP" && (
              <button
                onClick={() => handleStatusChange("IN_TRANSIT")}
                disabled={updating}
                className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-sm shadow-md shadow-indigo-600/20 transition flex items-center justify-center gap-2"
              >
                Start Journey &bull; In Transit <Navigation size={17} />
              </button>
            )}

            {activeTask.status === "IN_TRANSIT" && (
              <button
                onClick={() => handleStatusChange("DELIVERED")}
                disabled={updating}
                className="w-full py-3.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm shadow-md shadow-emerald-600/20 transition flex items-center justify-center gap-2"
              >
                Complete Delivery <CheckCircle2 size={17} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white p-8 text-center rounded-3xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center mb-3">
            <CheckCircle2 size={24} />
          </div>
          <h3 className="font-display font-bold text-base text-slate-900">
            No Active Deliveries
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
            You are ready in the dispatch pool. When the matching algorithm assigns a shipment, it will appear here instantly.
          </p>
        </div>
      )}

      {/* GPS Telemetry Transmitter Simulation */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-center justify-between">
        <div>
          <span className="font-bold text-xs text-slate-900 block flex items-center gap-1.5">
            <Radio size={14} className="text-blue-600 animate-pulse" /> Live Telemetry Transponder
          </span>
          <span className="text-[11px] text-slate-400 block mt-0.5">
            {gpsPingSent ? (
              <span className="text-emerald-600 font-bold">GPS ping acknowledged!</span>
            ) : (
              `Last sent: ${new Date(driver?.lastSeenAt || Date.now()).toLocaleTimeString()}`
            )}
          </span>
        </div>

        <button
          onClick={sendSimulatedGpsPing}
          disabled={updating}
          className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition"
        >
          <Send size={13} /> Send GPS Ping
        </button>
      </div>

      {/* Recent Delivery History */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)]">
        <h4 className="font-display font-bold text-sm text-slate-900 mb-3">
          Completed Today
        </h4>
        <div className="space-y-2.5 text-xs">
          {(data?.history || []).map((h) => (
            <div
              key={h._id}
              className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between"
            >
              <div>
                <span className="font-semibold text-slate-800 block">{h.title}</span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  Delivered at {new Date(h.deliveredAt || h.updatedAt).toLocaleTimeString()}
                </span>
              </div>
              <Badge status="DELIVERED" size="xs" />
            </div>
          ))}

          {(!data?.history || data.history.length === 0) && (
            <p className="text-center text-slate-400 py-3 text-xs">
              No deliveries logged for today yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
