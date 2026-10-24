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
  // Allow mobile networks a little room before treating a client as gone.
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1024 * 1024
});

// Keep a short reconnect grace period so brief mobile-network drops do not
// immediately remove a user from the room or delete their DB row.
const disconnectTimers = new Map();
// Brief reservation prevents simultaneous join requests from claiming one name.
const joinReservations = new Map();
const JOIN_RESERVATION_MS = 20000;
const RECONNECT_GRACE_MS = 30000;

function onlineUsersForRoom(room) {
  const online = new Map();
  for (const s of io.sockets.sockets.values()) {
    if (s.data?.room === room && s.data?.userId) {
      online.set(s.data.userId, { id: s.data.userId, name: s.data.name });
    }
  }
  return [...online.values()];
}

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

    CREATE TABLE IF NOT EXISTS shared_videos (
      id UUID PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type VARCHAR(80) NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS watch_states (
      room_id TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
      video_type VARCHAR(16) NOT NULL,
      youtube_id VARCHAR(32),
      video_id UUID,
      title TEXT NOT NULL DEFAULT '',
      playback_time DOUBLE PRECISION NOT NULL DEFAULT 0,
      is_playing BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
  let reservationKey = null;
  let reservation = null;
  try {
    let name = cleanName(req.body?.name);
    const room = cleanRoom(req.body?.room);
    const password = String(req.body?.password || "");

    if (name.length < 2) return res.status(400).json({ error: "Username must be 2-24 characters." });
    if (room.length < 2) return res.status(400).json({ error: "Room name must be 2-40 characters." });
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "Room password must be 8-128 characters." });
    }

    const existing = await pool.query("SELECT id, password_hash FROM rooms WHERE id=$1", [room]);
    if (existing.rowCount === 0) {
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.query("INSERT INTO rooms(id,password_hash) VALUES($1,$2)", [room, passwordHash]);
    } else {
      const ok = await bcrypt.compare(password, existing.rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: "Wrong room password." });
    }

    reservationKey = `${room.toLowerCase()}\\u0000${name.toLowerCase()}`;
    const currentReservation = joinReservations.get(reservationKey);
    if (currentReservation && currentReservation.expiresAt > Date.now()) {
      return res.status(409).json({ error: "This username is just joining the room. Please wait a moment and try again." });
    }
    reservation = { expiresAt: Date.now() + JOIN_RESERVATION_MS, userId: null };
    joinReservations.set(reservationKey, reservation);

    const sameName = await pool.query(
      "SELECT id, name FROM users WHERE room_id=$1 AND LOWER(name)=LOWER($2) ORDER BY created_at ASC",
      [room, name]
    );

    let userId;
    if (sameName.rowCount > 0) {
      // Rows may outlive a browser tab that closed before Socket.IO connected.
      // Reject only if that identity has a live socket; otherwise reuse its ID
      // so historical messages and foreign-key references remain intact.
      const connectedIds = new Set(
        [...io.sockets.sockets.values()]
          .filter(s => s.data?.room === room && s.data?.userId)
          .map(s => s.data.userId)
      );
      const activeMatch = sameName.rows.find(row => connectedIds.has(row.id));
      if (activeMatch) {
        if (joinReservations.get(reservationKey) === reservation) joinReservations.delete(reservationKey);
        reservation = null;
        return res.status(409).json({ error: "That username is already in this room." });
      }

      const staleUser = sameName.rows[0];
      userId = staleUser.id;
      name = staleUser.name;
      const reconnectTimer = disconnectTimers.get(userId);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        disconnectTimers.delete(userId);
      }
      await pool.query("UPDATE users SET name=$2 WHERE id=$1", [userId, name]);
    } else {
      userId = crypto.randomUUID();
      await pool.query("INSERT INTO users(id,room_id,name) VALUES($1,$2,$3)", [userId, room, name]);
    }
    reservation.userId = userId;

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
    if (reservationKey && reservation && joinReservations.get(reservationKey) === reservation) {
      joinReservations.delete(reservationKey);
    }
    console.error(err);
    res.status(500).json({ error: "Server error." });
  }
});

function requestClaims(req, res, next) {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Authentication required." });
    req.claims = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired. Rejoin the room." });
  }
}

// MP4 uploads are deliberately capped: this stores one shared video per room in PostgreSQL.
app.post("/api/watch/upload", requestClaims, express.raw({ type: ["video/mp4", "application/octet-stream"], limit: "25mb" }), async (req, res) => {
  try {
    const room = req.claims.room;
    const rawName = String(req.headers["x-video-name"] || "Shared%20video.mp4");
    let name = rawName; try { name = decodeURIComponent(rawName); } catch {}
    name = name.replace(/[\/\r\n]/g, "_").slice(0, 180);
    const mime = String(req.headers["content-type"] || "video/mp4").toLowerCase();
    if (!/^video\/(mp4|quicktime)$/.test(mime)) return res.status(415).json({ error: "Please upload an MP4 video." });
    if (!Buffer.isBuffer(req.body) || req.body.length < 1) return res.status(400).json({ error: "Video file is empty." });
    if (req.body.length > 20 * 1024 * 1024) return res.status(413).json({ error: "MP4 must be 20 MB or smaller." });
    const id = crypto.randomUUID();
    await pool.query("DELETE FROM shared_videos WHERE room_id=$1", [room]);
    await pool.query("INSERT INTO shared_videos(id,room_id,name,mime_type,data) VALUES($1,$2,$3,$4,$5)", [id, room, name, mime, req.body]);
    res.json({ ok: true, videoId: id, title: name });
  } catch (err) {
    console.error("watch upload failed:", err.message);
    res.status(500).json({ error: "Could not store video. Check database space and try a smaller MP4." });
  }
});

app.get("/api/watch/video/:id", requestClaims, async (req, res) => {
  try {
    const result = await pool.query("SELECT name,mime_type,data FROM shared_videos WHERE id=$1 AND room_id=$2", [req.params.id, req.claims.room]);
    if (!result.rowCount) return res.status(404).json({ error: "Video not found in this room." });
    const video = result.rows[0];
    res.setHeader("Content-Type", video.mime_type);
    res.setHeader("Content-Length", video.data.length);
    res.setHeader("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(video.name));
    res.setHeader("Cache-Control", "private, no-store");
    res.send(video.data);
  } catch (err) {
    console.error("watch video read failed:", err.message);
    res.status(500).json({ error: "Could not load video." });
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
  const reservationKey = `${room.toLowerCase()}\\u0000${name.toLowerCase()}`;
  const pendingReservation = joinReservations.get(reservationKey);
  if (pendingReservation && pendingReservation.userId === userId) {
    joinReservations.delete(reservationKey);
  }
  const reconnectTimer = disconnectTimers.get(userId);
  const isReconnecting = Boolean(reconnectTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  disconnectTimers.delete(userId);

  // Restore the online-user row if a prior disconnect cleanup already removed it.
  try {
    await pool.query(
      "INSERT INTO users(id,room_id,name) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING",
      [userId, room, name]
    );
  } catch (err) {
    console.error("socket user restore failed:", err.message);
    socket.disconnect(true);
    return;
  }

  socket.join(room);
  // Every active socket for this authenticated user joins a private user room.
  // Online-user IDs exposed to the client are database user IDs, not Socket.IO IDs.
  socket.join(`user:${userId}`);
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
  if (!isReconnecting) socket.to(room).emit("system:message", `${name} joined the room`);

  try {
    const savedWatch = await pool.query("SELECT video_type,youtube_id,video_id,title,playback_time,is_playing FROM watch_states WHERE room_id=$1", [room]);
    if (savedWatch.rowCount) {
      const r = savedWatch.rows[0];
      socket.emit("watch:state", { type: r.video_type, youtubeId: r.youtube_id, videoId: r.video_id, title: r.title, currentTime: Number(r.playback_time || 0), isPlaying: Boolean(r.is_playing) });
    }
  } catch (err) { console.error("watch state load failed:", err.message); }

  socket.on("watch:set", async (payload = {}, callback) => {
    const done = typeof callback === "function" ? callback : () => {};
    try {
      const type = payload.type === "mp4" ? "mp4" : payload.type === "youtube" ? "youtube" : "";
      const youtubeId = String(payload.youtubeId || "").trim();
      const videoId = type === "mp4" ? String(payload.videoId || "") : null;
      const title = String(payload.title || (type === "youtube" ? "YouTube video" : "Shared MP4")).slice(0, 180);
      if (!type) return done({ ok: false, error: "Unsupported video type." });
      if (type === "youtube" && !/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) return done({ ok: false, error: "Invalid YouTube video ID." });
      if (type === "mp4") {
        const exists = await pool.query("SELECT id FROM shared_videos WHERE id=$1 AND room_id=$2", [videoId, room]);
        if (!exists.rowCount) return done({ ok: false, error: "Upload the MP4 again; it was not found." });
      }
      const state = { type, youtubeId: type === "youtube" ? youtubeId : null, videoId, title, currentTime: 0, isPlaying: false };
      await pool.query(`INSERT INTO watch_states(room_id,video_type,youtube_id,video_id,title,playback_time,is_playing,updated_at)
        VALUES($1,$2,$3,$4,$5,0,false,NOW()) ON CONFLICT(room_id) DO UPDATE SET video_type=EXCLUDED.video_type,youtube_id=EXCLUDED.youtube_id,video_id=EXCLUDED.video_id,title=EXCLUDED.title,playback_time=0,is_playing=false,updated_at=NOW()`,
        [room, state.type, state.youtubeId, state.videoId, state.title]);
      io.to(room).emit("watch:state", state);
      done({ ok: true });
    } catch (err) { console.error("watch set failed:", err.message); done({ ok: false, error: "Could not set shared video." }); }
  });

  socket.on("watch:sync", async (payload = {}) => {
    try {
      const currentTime = Math.max(0, Math.min(Number(payload.currentTime) || 0, 24 * 60 * 60));
      const isPlaying = Boolean(payload.isPlaying);
      const saved = await pool.query("UPDATE watch_states SET playback_time=$2,is_playing=$3,updated_at=NOW() WHERE room_id=$1 RETURNING video_type,youtube_id,video_id,title", [room, currentTime, isPlaying]);
      if (!saved.rowCount) return;
      const r = saved.rows[0];
      socket.to(room).emit("watch:sync", { type: r.video_type, youtubeId: r.youtube_id, videoId: r.video_id, title: r.title, currentTime, isPlaying, by: socket.id });
    } catch (err) { console.error("watch sync failed:", err.message); }
  });

  socket.on("watch:stop", async () => {
    try {
      await pool.query("DELETE FROM watch_states WHERE room_id=$1", [room]);
      await pool.query("DELETE FROM shared_videos WHERE room_id=$1", [room]);
      io.to(room).emit("watch:cleared");
    } catch (err) { console.error("watch clear failed:", err.message); }
  });

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

  // WebRTC signalling. The client addresses users by DB user ID, while Socket.IO
  // normally addresses individual sockets. Relay only to an active user in this
  // same room, using the private per-user Socket.IO room created above.
  function relayCall(event, to, payload) {
    const targetUserId = String(to || "");
    if (!targetUserId || targetUserId === String(userId)) return;
    const targetIsOnline = [...io.sockets.sockets.values()].some(
      s => s.data?.userId === targetUserId && s.data?.room === room
    );
    if (!targetIsOnline) {
      socket.emit("call:unavailable", { to: targetUserId, message: "This user is no longer connected." });
      return;
    }
    io.to(`user:${targetUserId}`).emit(event, { from: String(userId), name, ...payload });
  }

  socket.on("call:offer", ({ to, offer } = {}) => {
    if (offer?.type === "offer" && offer?.sdp) relayCall("call:offer", to, { offer });
  });
  socket.on("call:answer", ({ to, answer } = {}) => {
    if (answer?.type === "answer" && answer?.sdp) relayCall("call:answer", to, { answer });
  });
  socket.on("call:ice", ({ to, candidate } = {}) => {
    if (candidate) relayCall("call:ice", to, { candidate });
  });
  socket.on("call:reject", ({ to } = {}) => relayCall("call:reject", to, {}));
  socket.on("call:end", ({ to } = {}) => relayCall("call:end", to, {}));

  socket.on("disconnect", reason => {
    console.log(`Socket disconnected: ${name} (${reason}); reconnect grace started.`);
    const oldTimer = disconnectTimers.get(userId);
    if (oldTimer) clearTimeout(oldTimer);

    const timer = setTimeout(async () => {
      disconnectTimers.delete(userId);
      // A reconnect may have happened while this timer was waiting.
      const stillConnected = [...io.sockets.sockets.values()].some(
        s => s.data?.userId === userId && s.data?.room === room
      );
      if (stillConnected) return;

      try {
        await pool.query("DELETE FROM users WHERE id=$1", [userId]);
        io.to(room).emit("users:update", onlineUsersForRoom(room));
        io.to(room).emit("system:message", `${name} left the room`);
        await pool.query("UPDATE rooms SET last_active_at=NOW() WHERE id=$1", [room]);
      } catch (err) {
        console.error("disconnect cleanup:", err.message);
      }
    }, RECONNECT_GRACE_MS);

    disconnectTimers.set(userId, timer);
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
