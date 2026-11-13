import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  MapPin,
  Package,
  Users,
  Truck,
  AlertOctagon,
  BarChart3,
  Bell,
  Settings,
  Navigation,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Radio,
  Menu,
  X,
  Play,
  Square,
  ShieldCheck,
  Zap
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";
import api from "../../api";

export default function Shell({ children }) {
  const { user, logout } = useAuth();
  const { connected, simulationStatus } = useSocket();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [togglingSim, setTogglingSim] = useState(false);
  const navigate = useNavigate();

  const navItems = [
    { to: "/", label: "Dashboard", icon: LayoutDashboard },
    { to: "/map", label: "Live Fleet Map", icon: MapPin },
    { to: "/tasks", label: "Delivery Tasks", icon: Package },
    { to: "/drivers", label: "Drivers", icon: Users },
    { to: "/vehicles", label: "Vehicles", icon: Truck },
    { to: "/incidents", label: "Incidents", icon: AlertOctagon },
    { to: "/analytics", label: "Analytics", icon: BarChart3 },
    { to: "/notifications", label: "Notifications", icon: Bell },
    { to: "/settings", label: "Settings", icon: Settings }
  ];

  // If driver or testing driver portal
  if (user?.role === "DRIVER" || ["ADMIN", "DISPATCHER"].includes(user?.role)) {
    navItems.push({ to: "/driver-portal", label: "Driver Portal", icon: Navigation, badge: "Portal" });
  }

  async function toggleSimulation() {
    setTogglingSim(true);
    try {
      if (simulationStatus.isRunning) {
        await api.post("/fleet/simulation/stop");
      } else {
        await api.post("/fleet/simulation/start");
      }
    } catch (err) {
      console.error("Failed to toggle simulation:", err);
    } finally {
      setTogglingSim(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex">
      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static top-0 bottom-0 left-0 z-50 flex flex-col bg-[#0b132b] text-slate-300 border-r border-slate-800/60 transition-all duration-300 ${
          collapsed ? "w-20" : "w-64"
        } ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Brand Header */}
        <div className="h-16 px-5 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Truck size={19} className="stroke-[2.2]" />
            </div>
            {!collapsed && (
              <div>
                <span className="font-display font-extrabold text-base tracking-tight text-white block leading-none">
                  FleetFlow
                </span>
                <span className="text-[10px] uppercase font-bold tracking-widest text-blue-400 block mt-1">
                  Dispatch Pro
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Real-time Telemetry Status Bar */}
        {!collapsed && (
          <div className="px-5 py-3 mx-3 my-2 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                }`}
              />
              <span className="text-xs font-semibold text-slate-300">
                {connected ? "Telemetry Live" : "Reconnecting"}
              </span>
            </div>
            <button
              onClick={toggleSimulation}
              disabled={togglingSim}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-md transition flex items-center gap-1 ${
                simulationStatus.isRunning
                  ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                  : "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
              }`}
            >
              {simulationStatus.isRunning ? (
                <>
                  <Square size={10} className="fill-current" /> Pause GPS
                </>
              ) : (
                <>
                  <Play size={10} className="fill-current" /> Sim GPS
                </>
              )}
            </button>
          </div>
        )}

        {/* Nav Links */}
        <div className="px-3 py-2 flex-1 overflow-y-auto space-y-1">
          {!collapsed && (
            <p className="px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              Platform Menu
            </p>
          )}
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setMobileMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all group ${
                  isActive
                    ? "bg-blue-600 text-white shadow-md shadow-blue-600/25"
                    : "text-slate-400 hover:text-white hover:bg-white/[0.04]"
                } ${collapsed ? "justify-center" : ""}`
              }
              title={collapsed ? item.label : undefined}
            >
              <item.icon size={18} className="shrink-0 stroke-[2]" />
              {!collapsed && (
                <span className="flex-1 truncate tracking-tight">{item.label}</span>
              )}
              {!collapsed && item.badge && (
                <span className="text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        {/* User Card & Logout */}
        <div className="p-3 border-t border-white/5 bg-[#080e21]">
          <div
            className={`flex items-center gap-3 p-2 rounded-xl bg-white/[0.02] border border-white/5 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <div className="w-8 h-8 rounded-lg bg-blue-600/30 border border-blue-500/40 text-blue-300 font-bold flex items-center justify-center text-xs shrink-0">
              {user?.name?.[0] || "U"}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white truncate">{user?.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">
                    {user?.role}
                  </span>
                </div>
              </div>
            )}
            <button
              onClick={logout}
              title="Sign out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition shrink-0"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
            >
              <Menu size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-display font-bold text-sm text-slate-900">
                  FleetFlow Platform
                </span>
                <span className="text-slate-300">/</span>
                <span className="text-xs font-semibold text-slate-500">
                  {user?.role === "DRIVER" ? "Driver App" : "Operations Hub"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Simulation pill indicator */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                simulationStatus.isRunning
                  ? "bg-purple-50 text-purple-700 border-purple-200"
                  : "bg-slate-50 text-slate-600 border-slate-200"
              }`}
            >
              <Radio size={13} className={simulationStatus.isRunning ? "animate-pulse" : ""} />
              {simulationStatus.isRunning ? "Simulated GPS Active" : "GPS Telemetry Idle"}
            </div>

            <NavLink
              to="/notifications"
              className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition relative"
              title="Notifications"
            >
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600" />
            </NavLink>

            <NavLink
              to="/driver-portal"
              className="hidden md:flex items-center gap-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 px-3 py-1.5 rounded-xl transition"
            >
              <Navigation size={14} /> Driver View
            </NavLink>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
