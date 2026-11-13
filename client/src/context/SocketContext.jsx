import { createContext, useContext, useEffect, useState } from "react";
import { getSocket } from "../socket";
import { useAuth } from "./AuthContext";

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
  const { user, token } = useAuth();
  const [connected, setConnected] = useState(false);
  const [locations, setLocations] = useState(new Map());
  const [simulationStatus, setSimulationStatus] = useState({ isRunning: false, speedMultiplier: 1 });
  const [lastNotification, setLastNotification] = useState(null);
  const [realtimeEvents, setRealtimeEvents] = useState([]);

  useEffect(() => {
    if (!token) return;

    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }

    function onConnect() {
      setConnected(true);
    }

    function onDisconnect() {
      setConnected(false);
    }

    function onLocationChanged(data) {
      setLocations((prev) => {
        const next = new Map(prev);
        next.set(data.driverId, data);
        return next;
      });
    }

    function onLocationsBatch(items) {
      setLocations((prev) => {
        const next = new Map(prev);
        items.forEach((item) => next.set(item.driverId, item));
        return next;
      });
    }

    function onTaskEvent(task) {
      setRealtimeEvents((prev) => [
        { id: Date.now(), title: "Task Updated", message: `${task.title} is now ${task.status}`, time: new Date() },
        ...prev.slice(0, 20)
      ]);
    }

    function onBreakdown(data) {
      setLastNotification({
        type: "CRITICAL",
        title: "Vehicle Breakdown Alert",
        message: `Vehicle ${data.registrationNumber} broke down. Reassigned tasks processed.`
      });
      setRealtimeEvents((prev) => [
        { id: Date.now(), title: "Vehicle Breakdown", message: `Breakdown reported for ${data.registrationNumber}`, time: new Date() },
        ...prev.slice(0, 20)
      ]);
    }

    function onSimStatus(status) {
      setSimulationStatus(status);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("fleet:location:changed", onLocationChanged);
    socket.on("fleet:locations:batch", onLocationsBatch);
    socket.on("task:assigned", onTaskEvent);
    socket.on("task:status:changed", onTaskEvent);
    socket.on("vehicle:breakdown", onBreakdown);
    socket.on("simulation:status", onSimStatus);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("fleet:location:changed", onLocationChanged);
      socket.off("fleet:locations:batch", onLocationsBatch);
      socket.off("task:assigned", onTaskEvent);
      socket.off("task:status:changed", onTaskEvent);
      socket.off("vehicle:breakdown", onBreakdown);
      socket.off("simulation:status", onSimStatus);
    };
  }, [token, user]);

  return (
    <SocketContext.Provider
      value={{
        connected,
        locations: Array.from(locations.values()),
        simulationStatus,
        lastNotification,
        realtimeEvents,
        clearNotification: () => setLastNotification(null)
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) throw new Error("useSocket must be used within SocketProvider");
  return context;
}
