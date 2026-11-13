import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Shell from "./components/layout/Shell";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import FleetMap from "./pages/FleetMap";
import DeliveryTasks from "./pages/DeliveryTasks";
import Drivers from "./pages/Drivers";
import Vehicles from "./pages/Vehicles";
import Incidents from "./pages/Incidents";
import Analytics from "./pages/Analytics";
import Notifications from "./pages/Notifications";
import Settings from "./pages/Settings";
import DriverPortal from "./pages/DriverPortal";

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b132b] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b132b] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Shell>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/map" element={<FleetMap />} />
                <Route path="/tasks" element={<DeliveryTasks />} />
                <Route path="/drivers" element={<Drivers />} />
                <Route path="/vehicles" element={<Vehicles />} />
                <Route path="/incidents" element={<Incidents />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/driver-portal" element={<DriverPortal />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Shell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
