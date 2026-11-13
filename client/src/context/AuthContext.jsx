import { createContext, useContext, useState, useEffect } from "react";
import api from "../api";
import { reconnectSocket, disconnectSocket } from "../socket";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem("fleetflow_user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [token, setToken] = useState(() => localStorage.getItem("fleetflow_token") || null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function verifySession() {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await api.get("/auth/me");
        setUser(data.user);
        localStorage.setItem("fleetflow_user", JSON.stringify(data.user));
        reconnectSocket();
      } catch (err) {
        console.warn("Session expired or invalid, logging out:", err.message);
        logout();
      } finally {
        setLoading(false);
      }
    }
    verifySession();
  }, [token]);

  function login(authData) {
    localStorage.setItem("fleetflow_token", authData.token);
    localStorage.setItem("fleetflow_user", JSON.stringify(authData.user));
    setToken(authData.token);
    setUser(authData.user);
    reconnectSocket();
  }

  function logout() {
    localStorage.removeItem("fleetflow_token");
    localStorage.removeItem("fleetflow_user");
    setToken(null);
    setUser(null);
    disconnectSocket();
  }

  return (
    <AuthContext.Provider value={{ user, token, login, logout, loading, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
