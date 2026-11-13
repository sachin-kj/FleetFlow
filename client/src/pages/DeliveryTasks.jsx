import { useState, useEffect } from "react";
import {
  Package,
  Plus,
  Search,
  Filter,
  Sparkles,
  ArrowRight,
  UserCheck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  RotateCcw,
  History,
  X,
  ExternalLink,
  ChevronDown
} from "lucide-react";
import api from "../api";
import Badge from "../components/common/Badge";
import Modal from "../components/common/Modal";

const HUBS = [
  { label: "Mysuru Central Hub", coordinates: [76.6394, 12.2958], address: "Ring Road Hub 4" },
  { label: "Hebbal Depot", coordinates: [76.6350, 12.3500], address: "Hebbal Electronic City" },
  { label: "Vijayanagar Logistics", coordinates: [76.6170, 12.3280], address: "Vijayanagar 4th Stage" },
  { label: "Nazarbad Regional Hub", coordinates: [76.6650, 12.3050], address: "Nazarbad Main Road" },
  { label: "KRS Road Warehouse", coordinates: [76.6210, 12.3500], address: "KRS Road Industrial Suburb" },
  { label: "Kuvempunagar Retail Hub", coordinates: [76.6250, 12.2850], address: "Kuvempunagar M-Block" }
];

const DESTINATIONS = [
  { label: "MedPlus Pharmacy Distribution", coordinates: [76.6450, 12.3120], address: "Sayyaji Rao Road" },
  { label: "Reliance Digital Superstore", coordinates: [76.6501, 12.3120], address: "D. Devaraj Urs Road" },
  { label: "Apollo Pharmacy Hub", coordinates: [76.6290, 12.3200], address: "Kalidasa Road, Jayalakshmipuram" },
  { label: "Croma Retail Center", coordinates: [76.6680, 12.3180], address: "Bangalore-Nilgiri Road" },
  { label: "Metro Cash & Carry", coordinates: [76.6025, 12.3710], address: "Hootagalli Industrial Suburb" },
  { label: "BM Hospital Medical Supplies", coordinates: [76.6220, 12.3050], address: "Saraswathipuram" }
];

export default function DeliveryTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState("ALL");

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [scoringModalOpen, setScoringModalOpen] = useState(false);
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [activeTask, setActiveTask] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [taskEvents, setTaskEvents] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  // New task form state
  const [title, setTitle] = useState("");
  const [cargoKg, setCargoKg] = useState(250);
  const [volumeM3, setVolumeM3] = useState(1.5);
  const [requiredVehicleType, setRequiredVehicleType] = useState("VAN");
  const [priority, setPriority] = useState("NORMAL");
  const [pickupIndex, setPickupIndex] = useState(0);
  const [destIndex, setDestIndex] = useState(0);
  const [notes, setNotes] = useState("");

  async function loadTasks() {
    try {
      const { data } = await api.get("/fleet/tasks");
      setTasks(data);
    } catch (err) {
      console.error("Failed to load tasks:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, []);

  const filteredTasks = tasks.filter((t) => {
    const sMatch = statusFilter === "ALL" || t.status === statusFilter;
    const pMatch = priorityFilter === "ALL" || t.priority === priorityFilter;
    const vMatch = vehicleTypeFilter === "ALL" || t.requiredVehicleType === vehicleTypeFilter;
    const query = search.toLowerCase();
    const qMatch =
      !search ||
      t.title?.toLowerCase().includes(query) ||
      t.trackingNumber?.toLowerCase().includes(query) ||
      t.pickup?.label?.toLowerCase().includes(query) ||
      t.destination?.label?.toLowerCase().includes(query);
    return sMatch && pMatch && vMatch && qMatch;
  });

  async function handleCreateTask(e) {
    e.preventDefault();
    setActionLoading(true);
    try {
      await api.post("/fleet/tasks", {
        title,
        cargoKg: Number(cargoKg),
        volumeM3: Number(volumeM3),
        requiredVehicleType,
        priority,
        pickup: HUBS[pickupIndex],
        destination: DESTINATIONS[destIndex],
        notes,
        deadline: new Date(Date.now() + 4 * 3600000)
      });
      setCreateModalOpen(false);
      resetForm();
      await loadTasks();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to create task");
    } finally {
      setActionLoading(false);
    }
  }

  function resetForm() {
    setTitle("");
    setCargoKg(250);
    setVolumeM3(1.5);
    setRequiredVehicleType("VAN");
    setPriority("NORMAL");
    setNotes("");
  }

  async function handleAutoAssign(taskId) {
    setActionLoading(true);
    try {
      const { data } = await api.post(`/fleet/tasks/${taskId}/assign`);
      alert(`Auto-assigned successfully! Driver matching score: ${data.score}`);
      await loadTasks();
    } catch (err) {
      alert(err.response?.data?.message || "Assignment failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePreviewScoring(task) {
    setActiveTask(task);
    setActionLoading(true);
    try {
      const { data } = await api.get(`/fleet/tasks/${task._id}/eligible-drivers`);
      setCandidates(data);
      setScoringModalOpen(true);
    } catch (err) {
      alert(err.response?.data?.message || "Failed to calculate candidate scores");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleManualAssign(taskId, driverId) {
    setActionLoading(true);
    try {
      await api.post(`/fleet/tasks/${taskId}/manual-assign`, { driverId });
      setScoringModalOpen(false);
      await loadTasks();
    } catch (err) {
      alert(err.response?.data?.message || "Manual assignment failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStatusTransition(taskId, newStatus) {
    setActionLoading(true);
    try {
      await api.patch(`/fleet/tasks/${taskId}/status`, { status: newStatus });
      await loadTasks();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to update status");
    } finally {
      setActionLoading(false);
    }
  }

  async function viewTimeline(task) {
    setActiveTask(task);
    try {
      const { data } = await api.get(`/fleet/tasks/${task._id}/events`);
      setTaskEvents(data);
      setTimelineModalOpen(true);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCancelTask(taskId) {
    if (!confirm("Are you sure you want to cancel this delivery task?")) return;
    try {
      await api.post(`/fleet/tasks/${taskId}/cancel`);
      await loadTasks();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to cancel task");
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">
            Delivery Tasks
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Dispatch queue, intelligent weighted allocation, and active shipment monitoring.
          </p>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition self-start sm:self-auto"
        >
          <Plus size={15} /> Create Delivery Task
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex-1 min-w-[260px] relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by title, tracking number, or location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="CREATED">Created</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="PICKED_UP">Picked Up</option>
            <option value="IN_TRANSIT">In Transit</option>
            <option value="DELIVERED">Delivered</option>
            <option value="RECOVERY_REQUIRED">Recovery Required</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Priorities</option>
            <option value="URGENT">Urgent</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low</option>
          </select>

          <select
            value={vehicleTypeFilter}
            onChange={(e) => setVehicleTypeFilter(e.target.value)}
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Vehicle Types</option>
            <option value="BIKE">Bike (&lt; 65kg)</option>
            <option value="CAR">Car (&lt; 450kg)</option>
            <option value="VAN">Van (&lt; 1200kg)</option>
            <option value="TRUCK">Truck (&gt; 1200kg)</option>
          </select>
        </div>
      </div>

      {/* Tasks Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Shipment / ID</th>
                <th className="py-3.5 px-4">Pickup &rarr; Dropoff</th>
                <th className="py-3.5 px-4">Cargo Spec</th>
                <th className="py-3.5 px-4">Priority</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4">Assigned Driver</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.map((t) => (
                <tr key={t._id} className="hover:bg-slate-50/60 transition">
                  <td className="py-4 px-5">
                    <div className="font-bold text-slate-900 text-sm">{t.title}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
                      <span>{t.trackingNumber || t._id}</span>
                      <button
                        onClick={() => viewTimeline(t)}
                        className="text-blue-600 hover:underline flex items-center gap-0.5"
                      >
                        <History size={11} /> audit
                      </button>
                    </div>
                  </td>

                  <td className="py-4 px-4 text-slate-600">
                    <div className="font-semibold text-slate-800">{t.pickup?.label}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      &rarr; {t.destination?.label}
                    </div>
                  </td>

                  <td className="py-4 px-4">
                    <span className="font-bold text-slate-900">{t.cargoKg} kg</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {t.requiredVehicleType} &bull; {t.volumeM3 || 1} m&sup3;
                    </span>
                  </td>

                  <td className="py-4 px-4">
                    <Badge status={t.priority} size="xs" />
                  </td>

                  <td className="py-4 px-4">
                    <Badge status={t.status} size="xs" />
                    {t.assignmentScore && (
                      <span className="text-[10px] text-blue-600 font-bold block mt-1">
                        Score: {t.assignmentScore}
                      </span>
                    )}
                  </td>

                  <td className="py-4 px-4">
                    {t.driverId?.userId?.name ? (
                      <div>
                        <span className="font-semibold text-slate-900">{t.driverId.userId.name}</span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {t.vehicleId?.registrationNumber || "Fleet Unit"}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Unassigned</span>
                    )}
                  </td>

                  <td className="py-4 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Auto Assign button for unassigned/rejected tasks */}
                      {["CREATED", "ASSIGNING", "REJECTED"].includes(t.status) && (
                        <>
                          <button
                            onClick={() => handlePreviewScoring(t)}
                            title="Preview algorithm driver scores"
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-blue-600 hover:bg-slate-50 transition"
                          >
                            <Sparkles size={14} />
                          </button>
                          <button
                            onClick={() => handleAutoAssign(t._id)}
                            disabled={actionLoading}
                            className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] shadow-sm transition"
                          >
                            Auto Assign
                          </button>
                        </>
                      )}

                      {/* Driver progression badges for dispatcher awareness */}
                      {t.status === "ASSIGNED" && (
                        <span className="text-[10px] text-slate-500 font-medium px-2 py-1 bg-slate-100 rounded-md">
                          Awaiting Driver
                        </span>
                      )}

                      {t.status === "ACCEPTED" && (
                        <span className="text-[10px] text-blue-700 font-medium px-2 py-1 bg-blue-50 rounded-md">
                          Accepted
                        </span>
                      )}

                      {t.status === "PICKED_UP" && (
                        <span className="text-[10px] text-amber-700 font-medium px-2 py-1 bg-amber-50 rounded-md">
                          Cargo Loaded
                        </span>
                      )}

                      {t.status === "IN_TRANSIT" && (
                        <span className="text-[10px] text-indigo-700 font-medium px-2 py-1 bg-indigo-50 rounded-md">
                          In Transit
                        </span>
                      )}

                      {t.status === "RECOVERY_REQUIRED" && (
                        <span className="text-[10px] text-rose-700 font-bold px-2 py-1 bg-rose-50 border border-rose-200 rounded-md">
                          Recovery Unit Needed
                        </span>
                      )}

                      {/* Cancel task */}
                      {!["DELIVERED", "CANCELLED"].includes(t.status) && (
                        <button
                          onClick={() => handleCancelTask(t._id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                          title="Cancel Task"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Delivery Task Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Delivery Task"
        subtitle="Add a shipment and queue it for intelligent auto-dispatch"
      >
        <form onSubmit={handleCreateTask} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Task Title / Description
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Urgent Vaccine Consignment"
              className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-900 bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Pickup Origin Hub
              </label>
              <select
                value={pickupIndex}
                onChange={(e) => setPickupIndex(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white"
              >
                {HUBS.map((h, i) => (
                  <option key={i} value={i}>{h.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Dropoff Destination
              </label>
              <select
                value={destIndex}
                onChange={(e) => setDestIndex(Number(e.target.value))}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white"
              >
                {DESTINATIONS.map((d, i) => (
                  <option key={i} value={i}>{d.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Cargo Weight (kg)
              </label>
              <input
                type="number"
                min="1"
                required
                value={cargoKg}
                onChange={(e) => setCargoKg(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Vehicle Required
              </label>
              <select
                value={requiredVehicleType}
                onChange={(e) => setRequiredVehicleType(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white"
              >
                <option value="BIKE">BIKE (&lt; 65kg)</option>
                <option value="CAR">CAR (&lt; 450kg)</option>
                <option value="VAN">VAN (&lt; 1200kg)</option>
                <option value="TRUCK">TRUCK (&gt; 1200kg)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white"
              >
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCreateModalOpen(false)}
              className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionLoading}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-md shadow-blue-600/20"
            >
              Create Task
            </button>
          </div>
        </form>
      </Modal>

      {/* Candidate Driver Algorithm Scoring Modal */}
      <Modal
        isOpen={scoringModalOpen}
        onClose={() => setScoringModalOpen(false)}
        title="Intelligent Assignment Breakdown"
        subtitle={`Algorithm evaluation for ${activeTask?.title || "Task"}`}
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4 text-xs">
          {/* Formula Card */}
          <div className="p-3.5 bg-blue-50/60 border border-blue-200/80 rounded-xl">
            <span className="font-bold text-blue-900 block mb-1">Scoring Formula</span>
            <code className="text-[11px] text-blue-800 font-mono block">
              Score = (0.40 &times; Distance) + (0.25 &times; Availability) + (0.20 &times; Workload) + (0.15 &times; Deadline)
            </code>
          </div>

          <div className="space-y-2 max-h-[350px] overflow-y-auto">
            {candidates.map((c, idx) => (
              <div
                key={c.driver._id}
                className="p-3 rounded-xl border border-slate-200 hover:border-blue-300 transition flex items-center justify-between bg-white"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">
                      #{idx + 1} {c.driver.userId?.name}
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                      {c.vehicle?.registrationNumber} ({c.vehicle?.type})
                    </span>
                    <span className="text-emerald-600 font-bold">{c.distanceKm} km away</span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-slate-500">
                    <span>Dist: <strong>{c.breakdown?.distanceScore}</strong></span>
                    <span>Avail: <strong>{c.breakdown?.availabilityScore}</strong></span>
                    <span>Workload: <strong>{c.breakdown?.workloadScore}</strong></span>
                    <span>Deadline: <strong>{c.breakdown?.deadlineScore}</strong></span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-lg font-display font-extrabold text-blue-600 block leading-tight">
                      {c.score}
                    </span>
                    <span className="text-[10px] text-slate-400">Total Score</span>
                  </div>

                  <button
                    onClick={() => handleManualAssign(activeTask._id, c.driver._id)}
                    disabled={actionLoading}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm"
                  >
                    Assign
                  </button>
                </div>
              </div>
            ))}

            {candidates.length === 0 && (
              <div className="p-8 text-center text-slate-400">
                No eligible available drivers matching vehicle capacity & type.
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Audit Timeline Modal */}
      <Modal
        isOpen={timelineModalOpen}
        onClose={() => setTimelineModalOpen(false)}
        title="Task Audit Timeline"
        subtitle={`Historical lifecycle events for ${activeTask?.title || "Task"}`}
      >
        <div className="space-y-3 max-h-[350px] overflow-y-auto text-xs">
          {taskEvents.map((ev, i) => (
            <div key={i} className="flex items-start gap-3 border-l-2 border-blue-500 pl-4 py-1">
              <div>
                <Badge status={ev.type} size="xs" />
                <p className="font-semibold text-slate-800 mt-1">{ev.message}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {new Date(ev.createdAt).toLocaleString()} &bull; {ev.actorName || "System Dispatch"}
                </p>
              </div>
            </div>
          ))}
          {taskEvents.length === 0 && (
            <p className="text-center text-slate-400 py-6">No audit records found.</p>
          )}
        </div>
      </Modal>
    </div>
  );
}
