import { useState, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Wrench,
  Search,
  Filter,
  FileText,
  RotateCcw,
  ShieldAlert,
  ArrowRight
} from "lucide-react";
import api from "../api";
import Badge from "../components/common/Badge";
import Modal from "../components/common/Modal";

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [returnToService, setReturnToService] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  async function loadIncidents() {
    try {
      const { data } = await api.get("/fleet/incidents");
      setIncidents(data);
    } catch (err) {
      console.error("Failed to load incidents:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIncidents();
  }, []);

  const filtered = incidents.filter((inc) => {
    const q = search.toLowerCase();
    const qMatch =
      !search ||
      inc.description?.toLowerCase().includes(q) ||
      inc.vehicleId?.registrationNumber?.toLowerCase().includes(q) ||
      inc.type?.toLowerCase().includes(q);
    const sMatch = statusFilter === "ALL" || inc.status === statusFilter;
    return qMatch && sMatch;
  });

  async function handleResolve(e) {
    e.preventDefault();
    if (!selectedIncident) return;
    setActionLoading(true);
    try {
      await api.post(`/fleet/incidents/${selectedIncident._id}/resolve`, {
        resolutionNotes,
        returnVehicleToService: returnToService
      });
      setResolveModalOpen(false);
      setResolutionNotes("");
      await loadIncidents();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to resolve incident");
    } finally {
      setActionLoading(false);
    }
  }

  function openResolve(inc) {
    setSelectedIncident(inc);
    setResolutionNotes("Vehicle inspected and repaired at service depot. Passed safety inspection.");
    setReturnToService(true);
    setResolveModalOpen(true);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">
            Incident Management & Cargo Recovery
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Emergency breakdown logging, automatic reassignment auditing, and manual cargo recovery dispatch.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 flex items-center gap-1.5">
            <ShieldAlert size={14} /> {incidents.filter((i) => i.status === "OPEN").length} Active Cases
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex-1 min-w-[260px] relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search incident by description, vehicle plate..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
        >
          <option value="ALL">All Incident Statuses</option>
          <option value="OPEN">Open</option>
          <option value="INVESTIGATING">Investigating</option>
          <option value="RESOLVED">Resolved</option>
        </select>
      </div>

      {/* Incidents List */}
      <div className="space-y-4">
        {filtered.map((inc) => (
          <div
            key={inc._id}
            className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-6 hover:border-slate-300 transition"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-display font-extrabold text-base text-slate-900">
                    {inc.type.replace("_", " ")} &bull; {inc.vehicleId?.registrationNumber || "Fleet Unit"}
                  </span>
                  <Badge status={inc.status} size="xs" />
                  <Badge status={inc.severity} size="xs" />
                </div>
                <p className="text-xs text-slate-600 mt-2 max-w-2xl leading-relaxed">
                  {inc.description}
                </p>
                <div className="text-[11px] text-slate-400 mt-2 flex items-center gap-2">
                  <span>Logged {new Date(inc.createdAt).toLocaleString()}</span>
                  <span>&bull;</span>
                  <span>GPS: [{inc.coordinates?.join(", ")}]</span>
                </div>
              </div>

              {inc.status !== "RESOLVED" && (
                <button
                  onClick={() => openResolve(inc)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition self-start"
                >
                  <CheckCircle2 size={14} /> Resolve Incident
                </button>
              )}
            </div>

            {/* Affected Tasks Section */}
            {inc.affectedTaskIds && inc.affectedTaskIds.length > 0 && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Affected Shipments ({inc.affectedTaskIds.length})
                </span>
                <div className="grid sm:grid-cols-2 gap-2">
                  {inc.affectedTaskIds.map((t) => (
                    <div
                      key={t._id}
                      className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs flex items-center justify-between"
                    >
                      <span className="font-semibold text-slate-800 truncate mr-2">
                        {t.title || t.trackingNumber || t._id}
                      </span>
                      <Badge status={t.status || "RECOVERY_REQUIRED"} size="xs" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resolution notes if resolved */}
            {inc.status === "RESOLVED" && inc.resolutionNotes && (
              <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-600 flex items-start gap-2">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-800">Resolution:</strong> {inc.resolutionNotes}
                  <span className="text-slate-400 block text-[10px] mt-0.5">
                    Resolved at {new Date(inc.resolvedAt).toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-200/80 text-slate-400 text-xs">
            No incidents found matching current filters.
          </div>
        )}
      </div>

      {/* Resolve Incident Modal */}
      <Modal
        isOpen={resolveModalOpen}
        onClose={() => setResolveModalOpen(false)}
        title="Resolve Incident Case"
        subtitle={`Vehicle ${selectedIncident?.vehicleId?.registrationNumber}`}
      >
        <form onSubmit={handleResolve} className="space-y-4 text-xs">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Maintenance / Resolution Notes
            </label>
            <textarea
              required
              rows={3}
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="Detail mechanical inspection, parts replaced, or driver replacement..."
              className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={returnToService}
              onChange={(e) => setReturnToService(e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
            />
            <span className="font-semibold text-slate-800">
              Return vehicle to active fleet service as AVAILABLE
            </span>
          </label>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setResolveModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-md shadow-emerald-600/20"
            >
              Confirm Resolution
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
