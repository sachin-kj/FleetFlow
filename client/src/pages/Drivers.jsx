import { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Search,
  Star,
  Phone,
  Mail,
  Truck,
  CheckCircle2,
  Clock,
  Trash2,
  Edit,
  History,
  ShieldCheck,
  Award
} from "lucide-react";
import api from "../api";
import Badge from "../components/common/Badge";
import Modal from "../components/common/Modal";

export default function Drivers() {
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("ALL");

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Form states
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("Driver123!");
  const [phone, setPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");

  async function loadData() {
    try {
      const [drvRes, vehRes] = await Promise.all([
        api.get("/fleet/drivers"),
        api.get("/fleet/vehicles")
      ]);
      setDrivers(drvRes.data);
      setVehicles(vehRes.data);
    } catch (err) {
      console.error("Failed to load driver data:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filtered = drivers.filter((d) => {
    const q = search.toLowerCase();
    const qMatch =
      !search ||
      d.userId?.name?.toLowerCase().includes(q) ||
      d.userId?.email?.toLowerCase().includes(q) ||
      d.licenseNumber?.toLowerCase().includes(q) ||
      d.vehicleId?.registrationNumber?.toLowerCase().includes(q);
    const aMatch = availabilityFilter === "ALL" || d.availability === availabilityFilter;
    return qMatch && aMatch;
  });

  async function handleCreateDriver(e) {
    e.preventDefault();
    setActionLoading(true);
    try {
      await api.post("/fleet/drivers", {
        name,
        email,
        password,
        phone,
        licenseNumber
      });
      setCreateModalOpen(false);
      resetForm();
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create driver");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUpdateDriver(e) {
    e.preventDefault();
    if (!selectedDriver) return;
    setActionLoading(true);
    try {
      await api.put(`/fleet/drivers/${selectedDriver._id}`, {
        phone,
        licenseNumber,
        availability: selectedDriver.availability
      });
      setEditModalOpen(false);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to update driver");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleToggleAvailability(driver) {
    const nextStatus = driver.availability === "AVAILABLE" ? "OFFLINE" : "AVAILABLE";
    try {
      await api.put(`/fleet/drivers/${driver._id}`, { availability: nextStatus });
      await loadData();
    } catch (err) {
      alert("Failed to change availability status");
    }
  }

  async function handleDeleteDriver(driverId) {
    if (!confirm("Are you sure you want to delete this driver? This action cannot be undone.")) return;
    try {
      await api.delete(`/fleet/drivers/${driverId}`);
      await loadData();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to delete driver");
    }
  }

  function resetForm() {
    setName("");
    setEmail("");
    setPassword("Driver123!");
    setPhone("");
    setLicenseNumber("");
  }

  function openEdit(d) {
    setSelectedDriver(d);
    setPhone(d.phone || "");
    setLicenseNumber(d.licenseNumber || "");
    setEditModalOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">Driver Management</h1>
          <p className="text-xs text-slate-500 mt-1">
            Registered commercial operators, real-time availability, and service performance.
          </p>
        </div>

        <button
          onClick={() => {
            resetForm();
            setCreateModalOpen(true);
          }}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition self-start sm:self-auto"
        >
          <Plus size={15} /> Add Driver
        </button>
      </div>

      {/* Filter and Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex-1 min-w-[260px] relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search driver by name, email, or license..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
          />
        </div>

        <select
          value={availabilityFilter}
          onChange={(e) => setAvailabilityFilter(e.target.value)}
          className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
        >
          <option value="ALL">All Availabilities</option>
          <option value="AVAILABLE">Available</option>
          <option value="BUSY">Busy</option>
          <option value="OFFLINE">Offline</option>
          <option value="ON_BREAK">On Break</option>
        </select>
      </div>

      {/* Driver Cards Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filtered.map((d) => (
          <div
            key={d._id}
            className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-5 flex flex-col justify-between hover:border-slate-300 transition"
          >
            <div>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200/60 text-blue-700 font-bold flex items-center justify-center text-sm">
                    {d.userId?.name?.[0] || "D"}
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-sm text-slate-900 leading-tight">
                      {d.userId?.name}
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">{d.licenseNumber || "DL-Verified"}</p>
                  </div>
                </div>
                <Badge status={d.availability} size="xs" />
              </div>

              <div className="mt-4 space-y-1.5 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <Mail size={13} className="text-slate-400" />
                  <span className="truncate">{d.userId?.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone size={13} className="text-slate-400" />
                  <span>{d.phone || "+91 98450 12000"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Truck size={13} className="text-slate-400" />
                  <span className="font-medium">
                    {d.vehicleId ? (
                      `${d.vehicleId.registrationNumber} (${d.vehicleId.type})`
                    ) : (
                      <span className="text-slate-400 italic">No assigned vehicle</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-100 text-center text-xs">
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Deliveries</span>
                  <span className="font-bold text-slate-900 mt-0.5 block">{d.totalDeliveries || 0}</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">On-Time</span>
                  <span className="font-bold text-emerald-600 mt-0.5 block">{d.onTimeRate || 98.5}%</span>
                </div>
                <div className="bg-slate-50 p-2 rounded-xl">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Rating</span>
                  <span className="font-bold text-blue-600 mt-0.5 flex items-center justify-center gap-0.5">
                    <Star size={11} className="fill-current text-amber-400" /> {d.rating || 4.8}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <button
                onClick={() => handleToggleAvailability(d)}
                className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition ${
                  d.availability === "AVAILABLE"
                    ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                {d.availability === "AVAILABLE" ? "Go Offline" : "Set Available"}
              </button>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(d)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-50 transition"
                  title="Edit Driver"
                >
                  <Edit size={14} />
                </button>
                <button
                  onClick={() => handleDeleteDriver(d._id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                  title="Delete Driver"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Driver Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Register New Driver"
        subtitle="Add a licensed driver to the fleet roster"
      >
        <form onSubmit={handleCreateDriver} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sunil Kumar"
              className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="driver@fleetflow.demo"
                className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Initial Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98450 12345"
                className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Commercial License #
              </label>
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                placeholder="KA-09-2024-998822"
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
              Register Driver
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Driver Modal */}
      <Modal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title="Edit Driver Profile"
        subtitle={`Update details for ${selectedDriver?.userId?.name || "Driver"}`}
      >
        <form onSubmit={handleUpdateDriver} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              License Number
            </label>
            <input
              type="text"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
            />
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
