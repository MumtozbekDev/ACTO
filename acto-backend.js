const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");

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

// JWT секрет (в продакшене должен быть в переменных окружения)
const JWT_SECRET = process.env.JWT_SECRET || "acto_secret_key_2024";

// Хранилище данных в памяти
const users = new Map();
const chats = new Map();
const messages = new Map();
const onlineUsers = new Set();
const userSockets = new Map(); // userId -> socketId

// Middleware для проверки JWT токена
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, message: "Токен не предоставлен" });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);

    const user = users.get(decoded.userId);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Пользователь не найден" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res
      .status(401)
      .json({ success: false, message: "Недействительный токен" });
  }
};

// Создание демо пользователей при запуске
const createDemoUsers = async () => {
  const demoUsers = [
    {
      id: "demo_alice",
      username: "alice",
      email: "alice@acto.uim",
      displayName: "Alice Johnson",
      avatar: "👩",
      status: "Привет! Я Alice 👋",
      bio: "Люблю программирование и дизайн",
      password: await bcrypt.hash("123456", 10),
      isOnline: false,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_bob",
      username: "bob",
      email: "bob@acto.uim",
      displayName: "Bob Smith",
      avatar: "👨",
      status: "Разработчик и геймер 🎮",
      bio: "Full-stack разработчик",
      password: await bcrypt.hash("123456", 10),
      isOnline: false,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
    {
      id: "demo_charlie",
      username: "charlie",
      email: "charlie@acto.uim",
      displayName: "Charlie Brown",
      avatar: "🧑",
      status: "Люблю музыку и искусство 🎨",
      bio: "Музыкант и художник",
      password: await bcrypt.hash("123456", 10),
      isOnline: false,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ];

  demoUsers.forEach((user) => {
    users.set(user.id, user);
  });

  console.log("✅ Demo users created");
};

// Базовые маршруты
app.get("/", (req, res) => {
  res.json({
    message: "ACTO uim Server is running! 💬",
    version: "2.0.0",
    users: users.size,
    chats: chats.size,
    onlineUsers: onlineUsers.size,
    endpoints: {
      auth: {
        login: "POST /auth/login",
        register: "POST /auth/register",
        profile: "GET /auth/profile",
        updateProfile: "PUT /auth/profile",
      },
      chats: {
        getChats: "GET /chats",
        createChat: "POST /chats",
        getMessages: "GET /messages/:chatId",
        sendMessage: "POST /messages/:chatId",
      },
      users: {
        search: "GET /users/search",
      },
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

// === МАРШРУТЫ АУТЕНТИФИКАЦИИ ===

// Регистрация
app.post("/auth/register", async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Заполните все обязательные поля",
      });
    }

    // Проверка на существование пользователя
    const existingUser = Array.from(users.values()).find(
      (u) =>
        u.username.toLowerCase() === username.toLowerCase() ||
        u.email.toLowerCase() === email.toLowerCase()
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Пользователь с таким именем или email уже существует",
      });
    }

    // Создание нового пользователя
    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: userId,
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      displayName: displayName || username,
      avatar: "",
      status: "",
      bio: "",
      password: hashedPassword,
      isOnline: false,
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    users.set(userId, newUser);

    // Создание JWT токена
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });

    // Возвращаем пользователя без пароля
    const { password: _, ...userWithoutPassword } = newUser;

    res.json({
      success: true,
      message: "Пользователь успешно зарегистрирован",
      token,
      user: userWithoutPassword,
    });

    console.log(
      `👤 New user registered: ${newUser.displayName} (@${newUser.username})`
    );
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// Вход
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Введите имя пользователя и пароль",
      });
    }

    // Поиск пользователя
    const user = Array.from(users.values()).find(
      (u) => u.username.toLowerCase() === username.toLowerCase()
    );

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Неверное имя пользователя или пароль",
      });
    }

    // Проверка пароля
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Неверное имя пользователя или пароль",
      });
    }

    // Обновление статуса пользователя
    user.isOnline = true;
    user.lastSeen = new Date().toISOString();

    // Создание JWT токена
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    // Возвращаем пользователя без пароля
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: "Успешный вход",
      token,
      user: userWithoutPassword,
    });

    console.log(`🔑 User logged in: ${user.displayName} (@${user.username})`);
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// Получение профиля
app.get("/auth/profile", authMiddleware, (req, res) => {
  const { password: _, ...userWithoutPassword } = req.user;
  res.json({
    success: true,
    user: userWithoutPassword,
  });
});

// Обновление профиля
app.put("/auth/profile", authMiddleware, (req, res) => {
  try {
    const { displayName, avatar, status, bio } = req.body;
    const user = req.user;

    // Обновляем данные пользователя
    if (displayName !== undefined) user.displayName = displayName;
    if (avatar !== undefined) user.avatar = avatar;
    if (status !== undefined) user.status = status;
    if (bio !== undefined) user.bio = bio;

    users.set(user.id, user);

    const { password: _, ...userWithoutPassword } = user;

    res.json({
      success: true,
      message: "Профиль обновлен",
      user: userWithoutPassword,
    });

    console.log(`📝 Profile updated: ${user.displayName} (@${user.username})`);
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// Выход
app.post("/auth/logout", authMiddleware, (req, res) => {
  const user = req.user;
  user.isOnline = false;
  user.lastSeen = new Date().toISOString();
  users.set(user.id, user);

  res.json({
    success: true,
    message: "Успешный выход",
  });

  console.log(`👋 User logged out: ${user.displayName} (@${user.username})`);
});

// === МАРШРУТЫ ЧАТОВ ===

// Получение списка чатов пользователя
app.get("/chats", authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;

    // Находим все чаты, где пользователь является участником
    const userChats = Array.from(chats.values())
      .filter((chat) => chat.participants.includes(userId))
      .map((chat) => {
        // Получаем последнее сообщение для каждого чата
        const chatMessages = messages.get(chat.id) || [];
        const lastMessage = chatMessages[chatMessages.length - 1] || null;

        // Для приватных чатов определяем собеседника
        if (chat.type === "private") {
          const otherUserId = chat.participants.find((p) => p !== userId);
          const otherUser = users.get(otherUserId);

          if (otherUser) {
            chat.name = otherUser.displayName;
            chat.avatar = otherUser.avatar;
            chat.isOnline = onlineUsers.has(otherUserId);
            chat.lastSeen = otherUser.lastSeen;
          }
        }

        return {
          ...chat,
          lastMessage,
          unreadCount: 0, // TODO: реализовать подсчет непрочитанных
        };
      })
      .sort((a, b) => {
        // Сортируем по времени последнего сообщения
        const aTime = a.lastMessage?.timestamp || a.createdAt;
        const bTime = b.lastMessage?.timestamp || b.createdAt;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

    res.json({
      success: true,
      chats: userChats,
    });
  } catch (error) {
    console.error("Get chats error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// Создание нового чата
app.post("/chats", authMiddleware, (req, res) => {
  try {
    const { type, username, name, description } = req.body;
    const userId = req.user.id;

    if (type === "private") {
      if (!username) {
        return res.status(400).json({
          success: false,
          message: "Укажите имя пользователя",
        });
      }

      // Находим пользователя по username
      const targetUser = Array.from(users.values()).find(
        (u) => u.username.toLowerCase() === username.toLowerCase()
      );

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: "Пользователь не найден",
        });
      }

      if (targetUser.id === userId) {
        return res.status(400).json({
          success: false,
          message: "Нельзя создать чат с самим собой",
        });
      }

      // Проверяем, не существует ли уже приватный чат между этими пользователями
      const existingChat = Array.from(chats.values()).find(
        (chat) =>
          chat.type === "private" &&
          chat.participants.includes(userId) &&
          chat.participants.includes(targetUser.id)
      );

      if (existingChat) {
        return res.json({
          success: true,
          chat: existingChat,
          message: "Чат уже существует",
        });
      }

      // Создаем новый приватный чат
      const chatId = uuidv4();
      const newChat = {
        id: chatId,
        type: "private",
        name: targetUser.displayName,
        avatar: targetUser.avatar,
        participants: [userId, targetUser.id],
        admins: [],
        owner: null,
        createdAt: new Date().toISOString(),
      };

      chats.set(chatId, newChat);
      messages.set(chatId, []);

      // Отправляем уведомление через Socket.IO
      io.emit("chat-created", newChat);

      res.json({
        success: true,
        chat: newChat,
        message: "Приватный чат создан",
      });

      console.log(
        `💬 Private chat created between ${req.user.username} and ${targetUser.username}`
      );
    } else if (type === "group") {
      if (!name) {
        return res.status(400).json({
          success: false,
          message: "Укажите название группы",
        });
      }

      const chatId = uuidv4();
      const newChat = {
        id: chatId,
        type: "group",
        name,
        description: description || "",
        avatar: "👥",
        participants: [userId],
        admins: [userId],
        owner: userId,
        createdAt: new Date().toISOString(),
      };

      chats.set(chatId, newChat);
      messages.set(chatId, []);

      // Системное сообщение о создании группы
      const systemMessage = {
        id: uuidv4(),
        chatId,
        senderId: "system",
        senderUsername: "system",
        senderDisplayName: "Система",
        content: `Группа "${name}" создана`,
        type: "system",
        timestamp: new Date().toISOString(),
      };

      messages.get(chatId).push(systemMessage);

      io.emit("chat-created", newChat);

      res.json({
        success: true,
        chat: newChat,
        message: "Группа создана",
      });

      console.log(`👥 Group created: ${name} by ${req.user.username}`);
    } else {
      return res.status(400).json({
        success: false,
        message: "Неподдерживаемый тип чата",
      });
    }
  } catch (error) {
    console.error("Create chat error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// Получение сообщений чата
app.get("/messages/:chatId", authMiddleware, (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.id;
    const page = Number.parseInt(req.query.page) || 1;
    const limit = Number.parseInt(req.query.limit) || 50;

    // Проверяем, что чат существует
    const chat = chats.get(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Чат не найден",
      });
    }

    // Проверяем, что пользователь является участником чата
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: "Нет доступа к этому чату",
      });
    }

    // Получаем сообщения с пагинацией
    const chatMessages = messages.get(chatId) || [];
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedMessages = chatMessages
      .slice(-endIndex, -startIndex || undefined)
      .reverse();

    res.json({
      success: true,
      messages: paginatedMessages.reverse(),
      pagination: {
        page,
        limit,
        total: chatMessages.length,
        hasMore: startIndex + limit < chatMessages.length,
      },
    });
  } catch (error) {
    console.error("Get messages error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// Отправка сообщ��ния
app.post("/messages/:chatId", authMiddleware, (req, res) => {
  try {
    const { chatId } = req.params;
    const { content, type = "text" } = req.body;
    const userId = req.user.id;

    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: "Сообщение не может быть пустым",
      });
    }

    // Проверяем, что чат существует
    const chat = chats.get(chatId);
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Чат не найден",
      });
    }

    // Проверяем, что пользователь является участником чата
    if (!chat.participants.includes(userId)) {
      return res.status(403).json({
        success: false,
        message: "Нет доступа к этому чату",
      });
    }

    // Создаем новое сообщение
    const messageId = uuidv4();
    const newMessage = {
      id: messageId,
      chatId,
      senderId: userId,
      senderUsername: req.user.username,
      senderDisplayName: req.user.displayName,
      content: content.trim(),
      type,
      timestamp: new Date().toISOString(),
      edited: false,
    };

    // Добавляем сообщение в хранилище
    if (!messages.has(chatId)) {
      messages.set(chatId, []);
    }
    messages.get(chatId).push(newMessage);

    // Отправляем сообщение через Socket.IO всем участникам чата
    chat.participants.forEach((participantId) => {
      const socketId = userSockets.get(participantId);
      if (socketId) {
        io.to(socketId).emit("new-message", newMessage);
      }
    });

    res.json({
      success: true,
      message: newMessage,
    });

    console.log(
      `💬 Message sent in ${chat.name}: ${
        req.user.username
      }: ${content.substring(0, 50)}...`
    );
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// === МАРШРУТЫ ПОЛЬЗОВАТЕЛЕЙ ===

// Поиск пользователей
app.get("/users/search", authMiddleware, (req, res) => {
  try {
    const { q: query } = req.query;
    const userId = req.user.id;

    if (!query || query.length < 2) {
      return res.json({
        success: true,
        users: [],
      });
    }

    const searchResults = Array.from(users.values())
      .filter(
        (user) =>
          user.id !== userId && // Исключаем текущего пользователя
          (user.username.toLowerCase().includes(query.toLowerCase()) ||
            user.displayName.toLowerCase().includes(query.toLowerCase()))
      )
      .slice(0, 10)
      .map((user) => ({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        status: user.status,
        isOnline: onlineUsers.has(user.id),
        lastSeen: user.lastSeen,
      }));

    res.json({
      success: true,
      users: searchResults,
    });
  } catch (error) {
    console.error("Search users error:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

// === SOCKET.IO ОБРАБОТЧИКИ ===

io.on("connection", (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Аутентификация через Socket.IO
  socket.on("authenticate", (data) => {
    try {
      const { token } = data;
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = users.get(decoded.userId);

      if (user) {
        socket.userId = user.id;
        userSockets.set(user.id, socket.id);
        onlineUsers.add(user.id);

        user.isOnline = true;
        user.lastSeen = new Date().toISOString();
        users.set(user.id, user);

        socket.emit("authenticated", { success: true });

        // Отправляем обновленный список онлайн пользователей
        io.emit("users-online", Array.from(onlineUsers));

        console.log(
          `✅ Socket authenticated: ${user.displayName} (@${user.username})`
        );
      } else {
        socket.emit("authenticated", {
          success: false,
          message: "Пользователь не найден",
        });
      }
    } catch (error) {
      socket.emit("authenticated", {
        success: false,
        message: "Недействительный токен",
      });
    }
  });

  // Присоединение к чату
  socket.on("join-chat", (data) => {
    const { chatId } = data;
    if (socket.userId) {
      const chat = chats.get(chatId);
      if (chat && chat.participants.includes(socket.userId)) {
        socket.join(chatId);
        console.log(`📥 User ${socket.userId} joined chat ${chatId}`);
      }
    }
  });

  // Покидание чата
  socket.on("leave-chat", (data) => {
    const { chatId } = data;
    if (socket.userId) {
      socket.leave(chatId);
      console.log(`📤 User ${socket.userId} left chat ${chatId}`);
    }
  });

  // Пользователь печатает
  socket.on("typing", (data) => {
    const { chatId, isTyping } = data;
    if (socket.userId) {
      const user = users.get(socket.userId);
      if (user) {
        socket.to(chatId).emit("user-typing", {
          userId: socket.userId,
          username: user.username,
          chatId,
          isTyping,
        });
      }
    }
  });

  // Отключение
  socket.on("disconnect", () => {
    if (socket.userId) {
      const user = users.get(socket.userId);
      if (user) {
        user.isOnline = false;
        user.lastSeen = new Date().toISOString();
        users.set(socket.userId, user);

        onlineUsers.delete(socket.userId);
        userSockets.delete(socket.userId);

        // Отправляем обновленный список онлайн пользователей
        io.emit("users-online", Array.from(onlineUsers));

        console.log(
          `❌ Socket disconnected: ${user.displayName} (@${user.username})`
        );
      }
    }
  });
});

// Инициализация демо данных
createDemoUsers().then(() => {
  // Запуск сервера
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`🚀 ACTO uim Server running on port ${PORT}`);
    console.log(`💬 Dashboard: http://localhost:${PORT}`);
    console.log(`🏥 Health check: http://localhost:${PORT}`);
    console.log(`📚 API Documentation: http://localhost:${PORT}`);
    console.log(`🔐 Demo users: alice, bob, charlie (password: 123456)`);
  });
});

// Обработка ошибок
process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught Exception:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});
