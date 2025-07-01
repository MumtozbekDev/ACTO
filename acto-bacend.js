const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

// Настройка CORS для Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.use(cors());
app.use(express.json());

// Хранилище данных
const users = new Map();
const chats = new Map();
const messages = new Map();
const onlineUsers = new Set();

// Базовые маршруты
app.get("/", (req, res) => {
  res.json({
    message: "ACTO uim Server is running! 💬",
    version: "1.0.0",
    users: users.size,
    chats: chats.size,
    onlineUsers: onlineUsers.size,
    endpoints: {
      health: "/health",
      stats: "/stats",
      users: "/users",
      chats: "/chats",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    connections: onlineUsers.size,
  });
});

app.get("/stats", (req, res) => {
  res.json({
    totalUsers: users.size,
    onlineUsers: onlineUsers.size,
    totalChats: chats.size,
    totalMessages: Array.from(messages.values()).reduce(
      (sum, chatMessages) => sum + chatMessages.length,
      0
    ),
  });
});

app.get("/users", (req, res) => {
  const usersList = Array.from(users.values()).map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isOnline: onlineUsers.has(user.id),
    lastSeen: user.lastSeen,
  }));
  res.json(usersList);
});

app.get("/chats", (req, res) => {
  const chatsList = Array.from(chats.values()).map((chat) => ({
    id: chat.id,
    type: chat.type,
    name: chat.name,
    participantCount: chat.participants.length,
    messageCount: messages.get(chat.id)?.length || 0,
  }));
  res.json(chatsList);
});

// Socket.IO обработчики
io.on("connection", (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  // Пользователь онлайн
  socket.on("user-online", (userData) => {
    const user = {
      id: userData.userId,
      socketId: socket.id,
      username: userData.username,
      displayName: userData.displayName,
      isOnline: true,
      lastSeen: new Date().toISOString(),
    };

    users.set(userData.userId, user);
    onlineUsers.add(userData.userId);

    console.log(
      `👤 User online: ${userData.displayName} (@${userData.username})`
    );

    // Отправить список онлайн пользователей всем
    io.emit("users-online", Array.from(onlineUsers));

    // Присоединить к персональной комнате
    socket.join(`user_${userData.userId}`);
  });

  // Отправка сообщения
  socket.on("send-message", (messageData) => {
    console.log(
      `💬 Message from ${messageData.senderUsername}: ${messageData.content}`
    );

    // Сохранить сообщение
    if (!messages.has(messageData.chatId)) {
      messages.set(messageData.chatId, []);
    }
    messages.get(messageData.chatId).push(messageData);

    // Отправить сообщение участникам чата
    const chat = chats.get(messageData.chatId);
    if (chat) {
      chat.participants.forEach((participantId) => {
        io.to(`user_${participantId}`).emit("new-message", messageData);
      });
    }
  });

  // Создание чата
  socket.on("create-chat", (chatData) => {
    const newChat = {
      id: chatData.id,
      type: chatData.type,
      name: chatData.name,
      description: chatData.description,
      participants: chatData.participants,
      admins: chatData.admins || [chatData.creatorId],
      owner: chatData.creatorId,
      createdAt: new Date().toISOString(),
    };

    chats.set(chatData.id, newChat);
    messages.set(chatData.id, []);

    console.log(`🆕 Chat created: ${chatData.name} (${chatData.type})`);

    // Уведомить участников о создании чата
    newChat.participants.forEach((participantId) => {
      io.to(`user_${participantId}`).emit("chat-created", newChat);
    });
  });

  // Присоединение к чату
  socket.on("join-chat", (data) => {
    const { chatId, userId } = data;
    const chat = chats.get(chatId);

    if (chat && !chat.participants.includes(userId)) {
      chat.participants.push(userId);

      // Уведомить участников
      chat.participants.forEach((participantId) => {
        io.to(`user_${participantId}`).emit("user-joined-chat", {
          chatId,
          userId,
          username: users.get(userId)?.username,
        });
      });

      console.log(`➕ User ${userId} joined chat ${chatId}`);
    }
  });

  // Покидание чата
  socket.on("leave-chat", (data) => {
    const { chatId, userId } = data;
    const chat = chats.get(chatId);

    if (chat) {
      chat.participants = chat.participants.filter((p) => p !== userId);

      // Уведомить участников
      chat.participants.forEach((participantId) => {
        io.to(`user_${participantId}`).emit("user-left-chat", {
          chatId,
          userId,
          username: users.get(userId)?.username,
        });
      });

      console.log(`➖ User ${userId} left chat ${chatId}`);
    }
  });

  // Поиск пользователей
  socket.on("search-users", (query, callback) => {
    const results = Array.from(users.values())
      .filter(
        (user) =>
          user.username.toLowerCase().includes(query.toLowerCase()) ||
          user.displayName.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 10)
      .map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        isOnline: onlineUsers.has(user.id),
      }));

    callback(results);
  });

  // Получение истории сообщений
  socket.on("get-messages", (chatId, callback) => {
    const chatMessages = messages.get(chatId) || [];
    callback(chatMessages);
  });

  // Пометка сообщений как прочитанных
  socket.on("mark-as-read", (data) => {
    const { chatId, userId, messageId } = data;

    // Уведомить отправителя о прочтении
    const chat = chats.get(chatId);
    if (chat) {
      chat.participants.forEach((participantId) => {
        if (participantId !== userId) {
          io.to(`user_${participantId}`).emit("message-read", {
            chatId,
            messageId,
            readBy: userId,
          });
        }
      });
    }
  });

  // Пользователь печатает
  socket.on("typing", (data) => {
    const { chatId, userId, isTyping } = data;
    const chat = chats.get(chatId);

    if (chat) {
      chat.participants.forEach((participantId) => {
        if (participantId !== userId) {
          io.to(`user_${participantId}`).emit("user-typing", {
            chatId,
            userId,
            username: users.get(userId)?.username,
            isTyping,
          });
        }
      });
    }
  });

  // Отключение пользователя
  socket.on("disconnect", () => {
    // Найти пользователя по socket ID
    let disconnectedUser = null;
    for (const [userId, user] of users.entries()) {
      if (user.socketId === socket.id) {
        disconnectedUser = user;
        user.isOnline = false;
        user.lastSeen = new Date().toISOString();
        onlineUsers.delete(userId);
        break;
      }
    }

    if (disconnectedUser) {
      console.log(
        `❌ User disconnected: ${disconnectedUser.displayName} (@${disconnectedUser.username})`
      );

      // Обновить список онлайн пользователей
      io.emit("users-online", Array.from(onlineUsers));

      // Уведомить о статусе оффлайн
      io.emit("user-offline", {
        userId: disconnectedUser.id,
        lastSeen: disconnectedUser.lastSeen,
      });
    }
  });
});

// Очистка неактивных данных каждые 10 минут
setInterval(() => {
  const now = Date.now();
  const timeout = 10 * 60 * 1000; // 10 минут

  // Очистка неактивных пользователей
  for (const [userId, user] of users.entries()) {
    if (!user.isOnline && now - new Date(user.lastSeen).getTime() > timeout) {
      users.delete(userId);
      console.log(`🧹 Cleaned up inactive user: ${user.username}`);
    }
  }

  // Очистка пустых чатов
  for (const [chatId, chat] of chats.entries()) {
    if (chat.participants.length === 0) {
      chats.delete(chatId);
      messages.delete(chatId);
      console.log(`🧹 Cleaned up empty chat: ${chat.name}`);
    }
  }
}, 10 * 60 * 1000);

// Запуск сервера
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 ACTO uim Server running on port ${PORT}`);
  console.log(`💬 Dashboard: http://localhost:${PORT}`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`📊 Stats: http://localhost:${PORT}/stats`);
  console.log(`👥 Users: http://localhost:${PORT}/users`);
  console.log(`💭 Chats: http://localhost:${PORT}/chats`);
});

// Обработка ошибок
process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});
