import axios from "axios";
import Cookies from "js-cookie";

const API_BASE_URL = "https://acto-0gf5.onrender.com";

// Создаем экземпляр axios с базовой конфигурацией
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Интерцептор для добавления JWT токена к каждому запросу
api.interceptors.request.use(
  (config) => {
    const token = Cookies.get("acto_token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Интерцептор для обработки ответов и ошибок
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Токен истек или недействителен
      Cookies.remove("acto_token");
      window.location.href = "/auth";
    }
    return Promise.reject(error);
  }
);

// API методы для аутентификации
export const authAPI = {
  login: async (credentials: { username: string; password: string }) => {
    const response = await api.post("/auth/login", credentials);
    return response.data;
  },

  register: async (userData: {
    username: string;
    email: string;
    password: string;
    displayName?: string;
  }) => {
    const response = await api.post("/auth/register", userData);
    return response.data;
  },

  logout: async () => {
    const response = await api.post("/auth/logout");
    Cookies.remove("acto_token");
    return response.data;
  },

  getProfile: async () => {
    const response = await api.get("/auth/profile");
    return response.data;
  },

  updateProfile: async (profileData: {
    displayName?: string;
    avatar?: string;
    status?: string;
    bio?: string;
  }) => {
    const response = await api.put("/auth/profile", profileData);
    return response.data;
  },
};

// API методы для чатов
export const chatAPI = {
  getChats: async () => {
    const response = await api.get("/chats");
    return response.data;
  },

  getMessages: async (chatId: string, page = 1, limit = 50) => {
    const response = await api.get(`/chats/${chatId}/messages`, {
      params: { page, limit },
    });
    return response.data;
  },

  sendMessage: async (chatId: string, content: string, type = "text") => {
    const response = await api.post(`/chats/${chatId}/messages`, {
      content,
      type,
    });
    return response.data;
  },

  createChat: async (type: "private" | "group" | "channel", data: any) => {
    const response = await api.post("/chats", { type, ...data });
    return response.data;
  },

  searchUsers: async (query: string) => {
    const response = await api.get("/users/search", {
      params: { q: query },
    });
    return response.data;
  },

  markAsRead: async (chatId: string) => {
    const response = await api.post(`/chats/${chatId}/read`);
    return response.data;
  },
};

export default api;
