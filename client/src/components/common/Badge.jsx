export default function Badge({ status, size = "sm" }) {
  if (!status) return null;
  const s = String(status).toUpperCase();

  const styles = {
    // Availability & vehicle status
    AVAILABLE: "bg-emerald-50 text-emerald-700 border-emerald-200/80 dot-emerald-500",
    BUSY: "bg-blue-50 text-blue-700 border-blue-200/80 dot-blue-500",
    OFFLINE: "bg-slate-100 text-slate-600 border-slate-200 dot-slate-400",
    ON_BREAK: "bg-amber-50 text-amber-700 border-amber-200/80 dot-amber-500",
    BREAKDOWN: "bg-rose-50 text-rose-700 border-rose-200/80 dot-rose-500 animate-pulse",
    MAINTENANCE: "bg-orange-50 text-orange-700 border-orange-200/80 dot-orange-500",

    // Delivery Task Statuses
    CREATED: "bg-slate-100 text-slate-700 border-slate-200 dot-slate-400",
    ASSIGNING: "bg-indigo-50 text-indigo-700 border-indigo-200 dot-indigo-500 animate-pulse",
    ASSIGNED: "bg-sky-50 text-sky-700 border-sky-200 dot-sky-500",
    ACCEPTED: "bg-blue-50 text-blue-700 border-blue-200 dot-blue-500",
    PICKED_UP: "bg-amber-50 text-amber-700 border-amber-200 dot-amber-500",
    IN_TRANSIT: "bg-indigo-50 text-indigo-700 border-indigo-200 dot-indigo-500",
    DELIVERED: "bg-emerald-50 text-emerald-700 border-emerald-200 dot-emerald-500",
    REJECTED: "bg-rose-50 text-rose-700 border-rose-200 dot-rose-500",
    CANCELLED: "bg-slate-100 text-slate-500 border-slate-200 dot-slate-400",
    DELAYED: "bg-amber-50 text-amber-800 border-amber-300 dot-amber-600 font-semibold",
    RECOVERY_REQUIRED: "bg-rose-50 text-rose-700 border-rose-200 dot-rose-500 font-bold",

    // Incidents
    OPEN: "bg-rose-50 text-rose-700 border-rose-200 dot-rose-500",
    INVESTIGATING: "bg-amber-50 text-amber-700 border-amber-200 dot-amber-500",
    RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200 dot-emerald-500",

    // Priorities
    URGENT: "bg-rose-50 text-rose-700 border-rose-200 dot-rose-500",
    HIGH: "bg-orange-50 text-orange-700 border-orange-200 dot-orange-500",
    NORMAL: "bg-slate-50 text-slate-600 border-slate-200 dot-slate-400",
    LOW: "bg-slate-50 text-slate-500 border-slate-200 dot-slate-400",

    // Telemetry
    SIMULATED: "bg-purple-50 text-purple-700 border-purple-200 dot-purple-500",
    ACTUAL: "bg-emerald-50 text-emerald-700 border-emerald-200 dot-emerald-500"
  };

  const current = styles[s] || "bg-slate-50 text-slate-600 border-slate-200 dot-slate-400";
  const dotColor = current.split(" ").find(c => c.startsWith("dot-"))?.replace("dot-", "bg-") || "bg-slate-400";
  const sizeClasses = size === "xs" ? "text-[10px] px-2 py-0.5 gap-1" : "text-xs px-2.5 py-1 gap-1.5";

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border tracking-wide whitespace-nowrap shadow-[0_1px_2px_rgba(0,0,0,0.03)] ${sizeClasses} ${current}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {s.replaceAll("_", " ")}
    </span>
  );
}
