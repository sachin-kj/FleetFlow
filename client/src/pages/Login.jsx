import { useState } from "react";
import { Truck, ShieldCheck, Zap, ArrowRight, CheckCircle2, Lock, Mail } from "lucide-react";
import api from "../api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("dispatch@fleetflow.demo");
  const [password, setPassword] = useState("FleetFlow123!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const demoAccounts = [
    { label: "Dispatcher", email: "dispatch@fleetflow.demo", role: "DISPATCHER", badge: "Primary" },
    { label: "Admin", email: "admin@fleetflow.demo", role: "ADMIN", badge: "Full Access" },
    { label: "Manager", email: "manager@fleetflow.demo", role: "MANAGER", badge: "Analytics" },
    { label: "Driver", email: "driver1@fleetflow.demo", role: "DRIVER", badge: "Driver App" }
  ];

  async function handleLogin(e, customEmail = null) {
    if (e) e.preventDefault();
    const loginEmail = customEmail || email;
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/login", {
        email: loginEmail,
        password: password
      });
      login(data);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to sign in. Ensure backend is running.");
    } finally {
      setLoading(false);
    }
  }

  function quickSelect(account) {
    setEmail(account.email);
    setPassword("FleetFlow123!");
    handleLogin(null, account.email);
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Left Showcase Banner */}
      <div className="hidden lg:flex bg-[#0b132b] text-white p-16 flex-col justify-between relative overflow-hidden border-r border-slate-800">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-96 h-96 rounded-full bg-blue-600/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-96 h-96 rounded-full bg-indigo-600/10 blur-3xl pointer-events-none" />

        <div className="flex items-center gap-3 relative z-10">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25">
            <Truck size={22} className="stroke-[2.2]" />
          </div>
          <div>
            <span className="font-display font-extrabold text-xl tracking-tight block">FleetFlow</span>
            <span className="text-[10px] uppercase font-bold tracking-widest text-blue-400 block">Intelligent Fleet Logistics</span>
          </div>
        </div>

        <div className="relative z-10 max-w-lg my-auto py-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-semibold mb-6">
            <Zap size={13} className="text-blue-400" /> Real-time Autonomous Coordination
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold leading-[1.15] text-white tracking-tight">
            High-precision dispatching for modern commercial fleets.
          </h1>
          <p className="text-slate-300 text-base mt-6 leading-relaxed font-normal">
            Eliminate manual bottlenecks with weighted scoring dispatch, live GPS transponder telemetry, and automated vehicle breakdown recovery.
          </p>

          <div className="mt-10 space-y-3.5">
            {[
              "Real-time weighted driver assignment algorithm",
              "Sub-second Redis GPS indexing & simulated routes",
              "Automated vehicle breakdown re-allocation & cargo recovery",
              "Dedicated mobile Driver Portal with turn-by-turn workflow"
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3 text-sm text-slate-200">
                <CheckCircle2 size={17} className="text-emerald-400 shrink-0" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-500 flex justify-between items-center relative z-10 border-t border-white/5 pt-6">
          <span>FleetFlow Platform v2.4 Enterprise</span>
          <span>OpenStreetMap &bull; Leaflet &bull; Redis GEO</span>
        </div>
      </div>

      {/* Right Login Form */}
      <div className="flex items-center justify-center p-6 sm:p-12 lg:p-16 bg-[#fcfdfd]">
        <div className="w-full max-w-md">
          {/* Mobile Brand */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white">
              <Truck size={20} />
            </div>
            <span className="font-display font-extrabold text-xl text-slate-900">FleetFlow</span>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Sign in to operations
            </h2>
            <p className="text-sm text-slate-500 mt-2">
              Select a demo role below for instant access, or log in with credentials.
            </p>
          </div>

          {/* Quick Demo Role Switcher */}
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2.5">
              1-Click Demo Logins
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => quickSelect(acc)}
                  className={`p-3 rounded-xl border text-left transition flex flex-col justify-between ${
                    email === acc.email
                      ? "border-blue-500 bg-blue-50/50 text-blue-900 shadow-sm"
                      : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50/80 text-slate-700"
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="font-bold text-xs">{acc.label}</span>
                    <span className="text-[9px] uppercase font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                      {acc.badge}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 truncate mt-1">{acc.email}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#fcfdfd] px-3 text-slate-400 font-semibold">Or enter manually</span>
            </div>
          </div>

          {error && (
            <div className="mb-5 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-900 bg-white"
                  placeholder="name@fleetflow.demo"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm text-slate-900 bg-white"
                  placeholder="••••••••••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md shadow-blue-600/20 transition flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                "Authenticating..."
              ) : (
                <>
                  Sign in to Operations <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <p className="text-center text-xs text-slate-400 mt-6">
            Default Demo Password: <span className="font-semibold text-slate-600">FleetFlow123!</span>
          </p>
        </div>
      </div>
    </div>
  );
}
