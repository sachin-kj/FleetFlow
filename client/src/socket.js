import { io } from "socket.io-client";

let socket = null;

export function getSocket() {
  if (!socket) {
    const token = localStorage.getItem("fleetflow_token");
    socket = io(import.meta.env.VITE_SOCKET_URL || "http://localhost:5050", {
      autoConnect: false,
      transports: ["websocket", "polling"],
      auth: { token }
    });
  }
  return socket;
}

export function reconnectSocket() {
  if (socket) {
    const token = localStorage.getItem("fleetflow_token");
    socket.auth = { token };
    if (!socket.connected) {
      socket.connect();
    }
  } else {
    getSocket().connect();
  }
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
