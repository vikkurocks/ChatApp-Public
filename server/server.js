require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be set and be at least 32 characters.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}
if (!CLIENT_ORIGIN) {
  throw new Error("CLIENT_ORIGIN is required.");
}

const app = express();
const server = http.createServer(app);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10
});

app.set("trust proxy", 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors({
  origin: CLIENT_ORIGIN,
  methods: ["GET", "POST"],
  credentials: false
}));
app.use(express.json({ limit: "1mb" }));

const joinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
});

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1024 * 1024
});

function cleanName(v) {
  return String(v || "").trim().replace(/\s+/g, " ").slice(0, 24);
}
function cleanRoom(v) {
  return String(v || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}
function cleanMessage(v) {
  return String(v || "").trim().slice(0, 2000);
}
function cleanImageData(v) {
  const value = String(v || "");
  if (value.length > 700000) return "";
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) return "";
  return value;
}
function tokenFor(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}
function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}
function publicUser(row) {
  return { id: row.id, name: row.name };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name VARCHAR(24) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(room_id, name)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(24) NOT NULL,
      text TEXT NOT NULL,
      message_type VARCHAR(16) NOT NULL DEFAULT 'text',
      reply_to_id UUID NULL,
      reply_to_name VARCHAR(24) NULL,
      reply_to_text TEXT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(16) NOT NULL DEFAULT 'text';
    ALTER TABLE messages ALTER COLUMN text TYPE TEXT;
    ALTER TABLE messages ALTER COLUMN reply_to_text TYPE TEXT;

    CREATE INDEX IF NOT EXISTS idx_messages_room_created
      ON messages(room_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_users_room
      ON users(room_id);
  `);
}

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "chatapp-server" });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.get("/config", (_req, res) => {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_PASSWORD) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD
    });
  }
  res.json({ iceServers });
});

app.post("/api/join", joinLimiter, async (req, res) => {
  try {
    const name = cleanName(req.body?.name);
    const room = cleanRoom(req.body?.room);
    const password = String(req.body?.password || "");

    if (name.length < 2) return res.status(400).json({ error: "Username must be 2-24 characters." });
    if (room.length < 2) return res.status(400).json({ error: "Room name must be 2-40 characters." });
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Room password must be 8-128 characters." });
    }

    const existing = await pool.query("SELECT id, password_hash FROM rooms WHERE id=$1", [room]);
    let userId;

    if (existing.rowCount === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query(
        "INSERT INTO rooms(id,password_hash) VALUES($1,$2)",
        [room, passwordHash]
      );
    } else {
      const ok = await bcrypt.compare(password, existing.rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: "Wrong room password." });
    }

    const sameName = await pool.query(
      "SELECT id FROM users WHERE room_id=$1 AND LOWER(name)=LOWER($2)",
      [room, name]
    );
    if (sameName.rowCount > 0) {
      return res.status(409).json({ error: "That username is already in this room." });
    }

    userId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,room_id,name) VALUES($1,$2,$3)",
      [userId, room, name]
    );

    const messages = await pool.query(`
      SELECT id, name, text, message_type, reply_to_id, reply_to_name, reply_to_text, deleted, created_at
      FROM messages
      WHERE room_id=$1
      ORDER BY created_at DESC
      LIMIT 100
    `, [room]);

    await pool.query("UPDATE rooms SET last_active_at=NOW() WHERE id=$1", [room]);

    const token = tokenFor({ sub: userId, room, name });

    res.json({
      ok: true,
      token,
      room,
      user: { id: userId, name },
      messages: messages.rows.reverse().map(row => ({
        id: row.id,
        name: row.name,
        text: row.deleted ? "This message was deleted" : row.text,
        type: row.deleted ? "text" : (row.message_type || "text"),
        time: row.created_at,
        deleted: row.deleted,
        replyTo: row.reply_to_id ? {
          id: row.reply_to_id,
          name: row.reply_to_name,
          text: row.reply_to_text
        } : null
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
});

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required."));
    socket.user = verifyToken(token);
    next();
  } catch {
    next(new Error("Invalid or expired session."));
  }
});

io.on("connection", async socket => {
  const { sub: userId, room, name } = socket.user;
  socket.join(room);
  socket.data.room = room;
  socket.data.userId = userId;
  socket.data.name = name;

  const activeUsers = new Map();

  for (const [, s] of io.sockets.sockets) {
    if (s.data?.room === room && s.data?.userId) {
      activeUsers.set(s.data.userId, { id: s.data.userId, name: s.data.name });
    }
  }

  io.to(room).emit("users:update", [...activeUsers.values()]);
  socket.to(room).emit("system:message", `${name} joined the room`);

  socket.on("message:send", async (payload, callback) => {
    const done = typeof callback === "function" ? callback : () => {};
    try {
      const type = payload?.type === "image" ? "image" : "text";
      const content = type === "image" ? cleanImageData(payload?.text) : cleanMessage(payload?.text);
      if (!content) return done({ ok: false, error: type === "image" ? "Image is invalid or too large." : "Message is empty." });

      const reply = payload?.replyTo;
      const id = crypto.randomUUID();

      await pool.query(`
        INSERT INTO messages(
          id,room_id,user_id,name,text,message_type,reply_to_id,reply_to_name,reply_to_text
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `, [
        id, room, userId, name, content, type,
        reply?.id || null,
        cleanName(reply?.name),
        cleanMessage(reply?.text)
      ]);

      await pool.query("UPDATE rooms SET last_active_at=NOW() WHERE id=$1", [room]);

      const item = {
        id, name, text: content, type, time: new Date().toISOString(),
        replyTo: reply?.id ? {
          id: String(reply.id),
          name: cleanName(reply.name),
          text: cleanMessage(reply.text),
          type: reply?.type === "image" ? "image" : "text"
        } : null
      };

      io.to(room).emit("message:new", item);
      done({ ok: true });
    } catch (err) {
      console.error(err);
      done({ ok: false, error: "Could not send message." });
    }
  });

  socket.on("message:delete", async ({ id } = {}, callback) => {
    const done = typeof callback === "function" ? callback : () => {};
    try {
      const result = await pool.query(`
        UPDATE messages
        SET deleted=true, text='This message was deleted'
        WHERE id=$1 AND room_id=$2 AND user_id=$3 AND deleted=false
        RETURNING id
      `, [id, room, userId]);

      if (!result.rowCount) return done({ ok: false, error: "Message not found or not yours." });

      io.to(room).emit("message:deleted", { id });
      done({ ok: true });
    } catch {
      done({ ok: false, error: "Could not delete message." });
    }
  });

  socket.on("typing", ({ isTyping } = {}) => {
    socket.to(room).emit("typing", { name, isTyping: !!isTyping });
  });

  // WebRTC signalling. Media does not pass through this server.
  socket.on("call:offer", ({ to, offer } = {}) => {
    if (to && offer) io.to(String(to)).emit("call:offer", { from: socket.id, name, offer });
  });
  socket.on("call:answer", ({ to, answer } = {}) => {
    if (to && answer) io.to(String(to)).emit("call:answer", { from: socket.id, answer });
  });
  socket.on("call:ice", ({ to, candidate } = {}) => {
    if (to && candidate) io.to(String(to)).emit("call:ice", { from: socket.id, candidate });
  });
  socket.on("call:reject", ({ to } = {}) => {
    if (to) io.to(String(to)).emit("call:reject", { from: socket.id });
  });
  socket.on("call:end", ({ to } = {}) => {
    if (to) io.to(String(to)).emit("call:end", { from: socket.id });
  });

  socket.on("disconnect", async () => {
    try {
      await pool.query("DELETE FROM users WHERE id=$1", [userId]);

      const users = await pool.query(
        "SELECT id,name FROM users WHERE room_id=$1 ORDER BY name",
        [room]
      );
      io.to(room).emit("users:update", users.rows.map(publicUser));
      socket.to(room).emit("system:message", `${name} left the room`);
      await pool.query("UPDATE rooms SET last_active_at=NOW() WHERE id=$1", [room]);
    } catch (err) {
      console.error("disconnect cleanup:", err.message);
    }
  });
});

initDb()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`ChatApp backend listening on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
