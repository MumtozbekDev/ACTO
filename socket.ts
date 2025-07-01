import { io, type Socket } from "socket.io-client";
import Cookies from "js-cookie";

class SocketManager {
  private socket: Socket | null = null;
  private listeners: Map<string, Function[]> = new Map();

  connect() {
    if (this.socket?.connected) return this.socket;

    const token = Cookies.get("acto_token");

    this.socket = io("https://acto-0gf5.onrender.com", {
      transports: ["websocket", "polling"],
      timeout: 20000,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    this.socket.on("connect", () => {
      console.log("✅ Connected to ACTO server");

      // Аутентификация после подключения
      if (token) {
        this.socket?.emit("authenticate", { token });
      }
    });

    this.socket.on("authenticated", (data) => {
      if (data.success) {
        console.log("🔐 Socket authenticated successfully");
      } else {
        console.error("🚨 Socket authentication failed:", data.message);
      }
    });

    this.socket.on("disconnect", (reason) => {
      console.log("❌ Disconnected from server:", reason);
    });

    this.socket.on("connect_error", (error) => {
      console.error("🚨 Connection error:", error);
    });

    // Обработка основных событий
    this.socket.on("new-message", (data) => {
      this.emit("new-message", data);
    });

    this.socket.on("chat-created", (data) => {
      this.emit("chat-created", data);
    });

    this.socket.on("users-online", (data) => {
      this.emit("users-online", data);
    });

    this.socket.on("user-typing", (data) => {
      this.emit("user-typing", data);
    });

    this.socket.on("user-joined-chat", (data) => {
      this.emit("user-joined-chat", data);
    });

    this.socket.on("user-left-chat", (data) => {
      this.emit("user-left-chat", data);
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.listeners.clear();
  }

  // Подписка на события
  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  // Отписка от событий
  off(event: string, callback?: Function) {
    if (!callback) {
      this.listeners.delete(event);
      return;
    }

    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  // Эмиссия событий для внутреннего использования
  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => callback(data));
    }
  }

  // Отправка событий на сервер
  send(event: string, data?: any) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    }
  }

  // Присоединение к чату
  joinChat(chatId: string) {
    this.send("join-chat", { chatId });
  }

  // Покидание чата
  leaveChat(chatId: string) {
    this.send("leave-chat", { chatId });
  }

  // Отправка сообщения о печатании
  startTyping(chatId: string) {
    this.send("typing", { chatId, isTyping: true });
  }

  stopTyping(chatId: string) {
    this.send("typing", { chatId, isTyping: false });
  }

  // Получение статуса подключения
  get isConnected() {
    return this.socket?.connected || false;
  }
}

export const socketManager = new SocketManager();
export default socketManager;
