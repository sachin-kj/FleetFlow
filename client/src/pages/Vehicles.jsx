import { useState, useEffect } from "react";
import {
  Truck,
  Plus,
  Search,
  AlertTriangle,
  Wrench,
  Fuel,
  Gauge,
  UserCheck,
  CheckCircle2,
  Trash2,
  Edit,
  RotateCcw
} from "lucide-react";
import api from "../api";
import Badge from "../components/common/Badge";
import Modal from "../components/common/Modal";

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [breakdownResult, setBreakdownResult] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form states
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [modelName, setModelName] = useState("");
  const [type, setType] = useState("VAN");
  const [capacityKg, setCapacityKg] = useState(850);
  const [volumeM3, setVolumeM3] = useState(4.5);

  async function loadData() {
    try {
      const [vehRes, drvRes] = await Promise.all([
        api.get("/fleet/vehicles"),
        api.get("/fleet/drivers")
      ]);
      setVehicles(vehRes.data);
      setDrivers(drvRes.data);
    } catch (err) {
      console.error("Failed to load vehicles:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filtered = vehicles.filter((v) => {
    const q = search.toLowerCase();
    const qMatch =
      !search ||
      v.registrationNumber?.toLowerCase().includes(q) ||
      v.modelName?.toLowerCase().includes(q) ||
      v.driverId?.userId?.name?.toLowerCase().includes(q);
    const tMatch = typeFilter === "ALL" || v.type === typeFilter;
    const sMatch = statusFilter === "ALL" || v.status === statusFilter;
    return qMatch && tMatch && sMatch;
  });

  async function handleCreateVehicle(e) {
    e.preventDefault();
    setActionLoading(true);
    try {
      await api.post("/fleet/vehicles", {
        registrationNumber,
        modelName,
        type,
        capacityKg: Number(capacityKg),
        volumeM3: Number(volumeM3)
      });
      setCreateModalOpen(false);
      resetForm();
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create vehicle");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAssignDriver(e) {
    e.preventDefault();
    if (!selectedVehicle) return;
    setActionLoading(true);
    try {
      await api.post(`/fleet/vehicles/${selectedVehicle._id}/assign-driver`, {
        driverId: selectedDriverId || null
      });
      setAssignModalOpen(false);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to assign driver");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleTriggerBreakdown(vehicle) {
    setSelectedVehicle(vehicle);
    setActionLoading(true);
    try {
      const { data } = await api.post(`/fleet/vehicles/${vehicle._id}/breakdown`, {
        type: "BREAKDOWN",
        severity: "HIGH",
        description: `Breakdown reported for ${vehicle.registrationNumber} (${vehicle.modelName})`
      });
      setBreakdownResult(data);
      setBreakdownModalOpen(true);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Breakdown simulation failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleStatus(vehicle, newStatus) {
    try {
      await api.put(`/fleet/vehicles/${vehicle._id}`, { status: newStatus });
      await loadData();
    } catch (err) {
      alert("Failed to update status");
    }
  }

  async function handleDeleteVehicle(vehicleId) {
    if (!confirm("Are you sure you want to delete this vehicle?")) return;
    try {
      await api.delete(`/fleet/vehicles/${vehicleId}`);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to delete vehicle");
    }
  }

  function resetForm() {
    setRegistrationNumber("");
    setModelName("");
    setType("VAN");
    setCapacityKg(850);
    setVolumeM3(4.5);
  }

  function openAssign(vehicle) {
    setSelectedVehicle(vehicle);
    setSelectedDriverId(vehicle.driverId?._id || "");
    setAssignModalOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">Vehicle Fleet</h1>
          <p className="text-xs text-slate-500 mt-1">
            Track commercial vehicle capacity, maintenance cycles, and breakdown recovery.
          </p>
        </div>

        <button
          onClick={() => {
            resetForm();
            setCreateModalOpen(true);
          }}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition self-start sm:self-auto"
        >
          <Plus size={15} /> Add Vehicle
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex-1 min-w-[260px] relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search vehicle plate, model, or driver..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Vehicle Types</option>
            <option value="BIKE">Bikes (&lt; 65kg)</option>
            <option value="CAR">Cars (&lt; 450kg)</option>
            <option value="VAN">Vans (&lt; 1200kg)</option>
            <option value="TRUCK">Trucks (&gt; 1200kg)</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="AVAILABLE">Available</option>
            <option value="BUSY">Busy</option>
            <option value="MAINTENANCE">Maintenance</option>
            <option value="BREAKDOWN">Breakdown</option>
          </select>
        </div>
      </div>

      {/* Vehicle Cards Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((v) => (
          <div
            key={v._id}
            className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-5 flex flex-col justify-between hover:border-slate-300 transition"
          >
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-display font-extrabold text-base text-slate-900 block tracking-tight">
                    {v.registrationNumber}
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">{v.modelName || "Standard Unit"}</p>
                </div>
                <Badge status={v.status} size="xs" />
              </div>

              <div className="grid grid-cols-2 gap-2 mt-4 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-400 block font-medium">Type</span>
                  <span className="font-bold text-slate-800">{v.type}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Capacity</span>
                  <span className="font-bold text-slate-800">{v.capacityKg} kg</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Volume</span>
                  <span className="font-bold text-slate-800">{v.volumeM3 || 5} m&sup3;</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-medium">Fuel Level</span>
                  <span className="font-bold text-emerald-600">{v.fuelLevelPct || 85}%</span>
                </div>
              </div>

              <div className="mt-3.5 flex items-center justify-between text-xs text-slate-600 px-1">
                <span>Assigned Operator:</span>
                <span className="font-bold text-slate-900">
                  {v.driverId?.userId?.name || <span className="text-slate-400 font-normal italic">Unassigned</span>}
                </span>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <button
                onClick={() => openAssign(v)}
                className="text-xs font-bold text-blue-600 hover:text-blue-700"
              >
                {v.driverId ? "Reassign Driver" : "Assign Driver"}
              </button>

              <div className="flex items-center gap-1.5">
                {/* Breakdown Simulator Button */}
                {v.status !== "BREAKDOWN" && (
                  <button
                    onClick={() => handleTriggerBreakdown(v)}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-bold text-[11px] flex items-center gap-1 transition"
                    title="Simulate Vehicle Breakdown"
                  >
                    <AlertTriangle size={12} /> Breakdown
                  </button>
                )}

                {v.status === "BREAKDOWN" && (
                  <button
                    onClick={() => handleToggleStatus(v, "AVAILABLE")}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold text-[11px] flex items-center gap-1 transition"
                  >
                    <CheckCircle2 size={12} /> Clear Breakdown
                  </button>
                )}

                <button
                  onClick={() => handleDeleteVehicle(v._id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                  title="Delete Vehicle"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Vehicle Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Add Fleet Vehicle"
        subtitle="Register a commercial transport unit into FleetFlow"
      >
        <form onSubmit={handleCreateVehicle} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Registration Number (Plate)
            </label>
            <input
              type="text"
              required
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value.toUpperCase())}
              placeholder="e.g. KA09FF1020"
              className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Vehicle Model & Make
            </label>
            <input
              type="text"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="e.g. Tata Ace EV Super"
              className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Vehicle Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-800 bg-white"
              >
                <option value="BIKE">BIKE (&lt; 65kg)</option>
                <option value="CAR">CAR (&lt; 450kg)</option>
                <option value="VAN">VAN (&lt; 1200kg)</option>
                <option value="TRUCK">TRUCK (&gt; 1200kg)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Payload Capacity (kg)
              </label>
              <input
                type="number"
                min="1"
                required
                value={capacityKg}
                onChange={(e) => setCapacityKg(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Volume (m&sup3;)
              </label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={volumeM3}
                onChange={(e) => setVolumeM3(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
              />
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCreateModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md shadow-blue-600/20"
            >
              Add Vehicle
            </button>
          </div>
        </form>
      </Modal>

      {/* Assign Driver Modal */}
      <Modal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Assign Driver to Vehicle"
        subtitle={`Vehicle ${selectedVehicle?.registrationNumber}`}
      >
        <form onSubmit={handleAssignDriver} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              Select Operator
            </label>
            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
              className="w-full p-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-800 bg-white"
            >
              <option value="">&mdash; Unassign Operator &mdash;</option>
              {drivers.map((d) => (
                <option key={d._id} value={d._id}>
                  {d.userId?.name} ({d.availability}) &mdash; {d.licenseNumber}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setAssignModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-md shadow-blue-600/20"
            >
              Save Assignment
            </button>
          </div>
        </form>
      </Modal>

      {/* Breakdown Outcome Modal */}
      <Modal
        isOpen={breakdownModalOpen}
        onClose={() => setBreakdownModalOpen(false)}
        title="Emergency Breakdown Processed"
        subtitle="Automatic reassignment engine results"
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 font-medium">
            Vehicle <strong>{selectedVehicle?.registrationNumber}</strong> marked <strong>BREAKDOWN</strong>. 
            Associated operator set to <strong>OFFLINE</strong>.
          </div>

          <div className="space-y-2">
            <span className="font-bold text-slate-900 block">Affected Task Actions:</span>
            {breakdownResult?.results?.map((res, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl border border-slate-200 flex items-center justify-between bg-white"
              >
                <div>
                  <span className="font-bold text-slate-900">{res.title || res.taskId}</span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">{res.message}</span>
                </div>
                <Badge status={res.outcome} size="xs" />
              </div>
            ))}

            {(!breakdownResult?.results || breakdownResult.results.length === 0) && (
              <p className="text-slate-500 italic p-3 bg-slate-50 rounded-xl">
                No active tasks were currently assigned to this vehicle.
              </p>
            )}
          </div>

          <div className="pt-4 flex justify-end border-t border-slate-100">
            <button
              onClick={() => setBreakdownModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
