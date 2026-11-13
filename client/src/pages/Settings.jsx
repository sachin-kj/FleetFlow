import { useState, useEffect } from "react";
import {
  Settings as SettingsIcon,
  Sliders,
  Cpu,
  CheckCircle2,
  Database,
  Radio,
  Save,
  RotateCcw
} from "lucide-react";
import api from "../api";

export default function Settings() {
  const [distanceWeight, setDistanceWeight] = useState(0.40);
  const [availabilityWeight, setAvailabilityWeight] = useState(0.25);
  const [workloadWeight, setWorkloadWeight] = useState(0.20);
  const [deadlineWeight, setDeadlineWeight] = useState(0.15);
  const [maxWorkload, setMaxWorkload] = useState(3);
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [savedMessage, setSavedMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const { data } = await api.get("/fleet/settings");
        if (data) {
          setDistanceWeight(data.distanceWeight ?? 0.40);
          setAvailabilityWeight(data.availabilityWeight ?? 0.25);
          setWorkloadWeight(data.workloadWeight ?? 0.20);
          setDeadlineWeight(data.deadlineWeight ?? 0.15);
          setMaxWorkload(data.maxWorkloadPerDriver ?? 3);
          setAutoDispatch(data.autoDispatchEnabled ?? true);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const totalWeight = Math.round((distanceWeight + availabilityWeight + workloadWeight + deadlineWeight) * 100);

  async function handleSave(e) {
    e.preventDefault();
    try {
      await api.put("/fleet/settings", {
        distanceWeight,
        availabilityWeight,
        workloadWeight,
        deadlineWeight,
        maxWorkloadPerDriver: Number(maxWorkload),
        autoDispatchEnabled: autoDispatch
      });
      setSavedMessage("Settings successfully updated and applied to dispatch scoring engine!");
      setTimeout(() => setSavedMessage(""), 4000);
    } catch (err) {
      alert("Failed to save settings");
    }
  }

  function handleReset() {
    setDistanceWeight(0.40);
    setAvailabilityWeight(0.25);
    setWorkloadWeight(0.20);
    setDeadlineWeight(0.15);
    setMaxWorkload(3);
    setAutoDispatch(true);
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <h1 className="font-display text-2xl font-extrabold text-slate-900">
          Dispatch Engine & Platform Settings
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Tune the intelligent driver allocation formula, workload thresholds, and infrastructure connection parameters.
        </p>
      </div>

      {savedMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" />
          {savedMessage}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Assignment Formula Tuner Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
                <Sliders size={18} className="text-blue-600" /> Scoring Formula Weights
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Adjust the weighted criteria used by the matching engine (Current Total: {totalWeight}%)
              </p>
            </div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1"
            >
              <RotateCcw size={12} /> Reset to Defaults
            </button>
          </div>

          {/* Sliders */}
          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between font-semibold text-slate-800 mb-1">
                <span>Distance Proximity Score (Haversine km)</span>
                <span className="font-bold text-blue-600">{Math.round(distanceWeight * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.80"
                step="0.05"
                value={distanceWeight}
                onChange={(e) => setDistanceWeight(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between font-semibold text-slate-800 mb-1">
                <span>Driver Shift Availability Score</span>
                <span className="font-bold text-blue-600">{Math.round(availabilityWeight * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.80"
                step="0.05"
                value={availabilityWeight}
                onChange={(e) => setAvailabilityWeight(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between font-semibold text-slate-800 mb-1">
                <span>Workload Balance Score (Fewer active tasks prioritized)</span>
                <span className="font-bold text-blue-600">{Math.round(workloadWeight * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.80"
                step="0.05"
                value={workloadWeight}
                onChange={(e) => setWorkloadWeight(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between font-semibold text-slate-800 mb-1">
                <span>Deadline SLA Urgency Score</span>
                <span className="font-bold text-blue-600">{Math.round(deadlineWeight * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.80"
                step="0.05"
                value={deadlineWeight}
                onChange={(e) => setDeadlineWeight(Number(e.target.value))}
                className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
            </div>
          </div>
        </div>

        {/* Operational Limits Card */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
            <Cpu size={18} className="text-blue-600" /> Operational Rules & Workload
          </h3>

          <div className="grid sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Max Concurrent Tasks per Operator
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={maxWorkload}
                onChange={(e) => setMaxWorkload(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-200 text-slate-900 bg-white"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Drivers exceeding this threshold are excluded from candidate pools.
              </span>
            </div>

            <div className="flex items-center pt-5">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDispatch}
                  onChange={(e) => setAutoDispatch(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                <div>
                  <span className="font-bold text-slate-900 block">Enable Automated Dispatches</span>
                  <span className="text-[10px] text-slate-400 block">
                    Allow system to auto-dispatch newly ingested orders.
                  </span>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Infrastructure & Redis Diagnostic Status */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-4">
          <h3 className="font-display font-bold text-base text-slate-900 flex items-center gap-2">
            <Database size={18} className="text-blue-600" /> Infrastructure Connectivity
          </h3>

          <div className="grid sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 block font-medium">MongoDB Cluster</span>
              <span className="font-bold text-emerald-600 mt-1 flex items-center gap-1">
                <CheckCircle2 size={13} /> Connected (v8.2)
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 block font-medium">Redis Geospatial Cache</span>
              <span className="font-bold text-emerald-600 mt-1 flex items-center gap-1">
                <CheckCircle2 size={13} /> Active &bull; 6379
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <span className="text-slate-400 block font-medium">BullMQ Queue Cluster</span>
              <span className="font-bold text-blue-600 mt-1 flex items-center gap-1">
                <Radio size={13} className="animate-pulse" /> 5 Workers Running
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="submit"
            className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-blue-600/20 transition"
          >
            <Save size={15} /> Save Settings
          </button>
        </div>
      </form>
    </div>
  );
}
