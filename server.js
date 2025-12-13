const fs = require("fs");
const path = require("path");

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const cors = require("cors");

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;
const RADIO_KEY = process.env.RADIO_KEY || "";

// --- LOAD SONG LIBRARY (SAFE) ---
let SONGS = {};
try {
  const songsPath = path.join(__dirname, "songs.json");
  SONGS = JSON.parse(fs.readFileSync(songsPath, "utf8"));
  console.log(`[LIB] songs.json loaded (${Object.keys(SONGS).length} songs)`);
} catch (e) {
  console.log(`[LIB] songs.json NOT loaded (continuing): ${e.message}`);
  SONGS = {};
}

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function resolveSong(query) {
  return SONGS[norm(query)] || null;
}

// --- SETUP SERVERS ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- MIDDLEWARE ---
app.use(cors());
app.use(bodyParser.json());

// --- STATE ---
let currentState = { action: "stop", url: null, text: null };
let nowPlaying = null; // { url, text }
let queue = [];        // array of { url, text }

// --- BROADCAST HELPERS ---
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function broadcastState() {
  broadcast(currentState);
  broadcast({
    action: "queue",
    nowPlaying,
    queue: queue.map(t => ({ text: t.text }))
  });
}

// --- AUTH ---
function isAuthorized(data) {
  if (!RADIO_KEY) return true; // if you forgot to set it, don't brick yourself
  return data && data.key && data.key === RADIO_KEY;
}

// --- RESOLVE INPUT -> TRACK ---
function buildTrack({ url, query, text }) {
  // Direct URL
  if (typeof url === "string" && url.startsWith("http")) {
    return {
      url,
      text: typeof text === "string" && text.trim() ? text : "Now playing"
    };
  }

  // Library key / query
  if (typeof query === "string" && query.trim()) {
    const found = resolveSong(query);
    if (!found) return null;

    return {
      url: found.url,
      text: found.title || (typeof text === "string" ? text : "Now playing")
    };
  }

  return null;
}

// --- QUEUE ENGINE ---
function startTrack(track) {
  nowPlaying = track;
  currentState = { action: "play", url: track.url, text: track.text };
  broadcastState();
  console.log(`[PLAY] ${track.text} (${track.url})`);
}

function nextTrack() {
  if (queue.length === 0) {
    nowPlaying = null;
    currentState = { action: "stop", url: null, text: null };
    broadcastState();
    console.log(`[QUEUE] empty -> stop`);
    return;
  }
  const track = queue.shift();
  startTrack(track);
}

function enqueueOrPlay(track) {
  if (!nowPlaying) {
    startTrack(track);
  } else {
    queue.push(track);
    broadcastState();
    console.log(`[QUEUE] + ${track.text}`);
  }
}

// --- REST API (OPTIONAL) ---
app.post("/play", (req, res) => {
  const { url, query, text, key } = req.body || {};
  if (!isAuthorized({ key })) return res.status(403).json({ error: "unauthorized" });

  const track = buildTrack({ url, query, text });
  if (!track) return res.status(400).json({ error: "invalid url/query" });

  enqueueOrPlay(track);
  res.json({ success: true });
});

app.post("/stop", (req, res) => {
  const { key } = req.body || {};
  if (!isAuthorized({ key })) return res.status(403).json({ error: "unauthorized" });

  nowPlaying = null;
  queue = [];
  currentState = { action: "stop", url: null, text: null };
  broadcastState();
  console.log(`[STOP] cleared`);
  res.json({ success: true });
});

app.post("/skip", (req, res) => {
  const { key } = req.body || {};
  if (!isAuthorized({ key })) return res.status(403).json({ error: "unauthorized" });

  console.log(`[SKIP]`);
  nextTrack();
  res.json({ success: true });
});

app.get("/", (req, res) => {
  res.send(`Sequence SMP Audio Server running. Clients: ${wss.clients.size}`);
});

// --- WEBSOCKET LOGIC (WEBSITE + PLUGIN) ---
wss.on("connection", (socket) => {
  // sync state to new clients
  try { socket.send(JSON.stringify(currentState)); } catch {}
  try {
    socket.send(JSON.stringify({
      action: "queue",
      nowPlaying,
      queue: queue.map(t => ({ text: t.text }))
    }));
  } catch {}

  socket.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    // website tells us a track ended (no auth needed)
    if (data.action === "ended") {
      if (nowPlaying) {
        console.log(`[ENDED] -> next`);
        nextTrack();
      }
      return;
    }

    // control actions require auth
    if (data.action === "play") {
      if (!isAuthorized(data)) return;

      const track = buildTrack({ url: data.url, query: data.query, text: data.text });
      if (!track) {
        broadcast({ action: "error", text: data.query ? `Song not found: ${data.query}` : "Invalid play payload" });
        return;
      }

      enqueueOrPlay(track);
      return;
    }

    if (data.action === "stop") {
      if (!isAuthorized(data)) return;

      nowPlaying = null;
      queue = [];
      currentState = { action: "stop", url: null, text: null };
      broadcastState();
      console.log(`[STOP] cleared`);
      return;
    }

    if (data.action === "skip") {
      if (!isAuthorized(data)) return;
      console.log(`[SKIP]`);
      nextTrack();
      return;
    }

    if (data.action === "queueList") {
  if (!isAuthorized(data)) return;

  const lines = [];

  if (nowPlaying) {
    lines.push(`Now: ${nowPlaying.text}`);
  } else {
    lines.push("Now: (nothing playing)");
  }

  if (queue.length === 0) {
    lines.push("Queue: (empty)");
  } else {
    lines.push("Queue:");
    queue.slice(0, 10).forEach((t, i) => {
      lines.push(`${i + 1}. ${t.text}`);
    });
    if (queue.length > 10) {
      lines.push(`+${queue.length - 10} more...`);
    }
  }

  try {
    socket.send(JSON.stringify({
      action: "queueList",
      lines
    }));
  } catch {}

  return;
}
  });
});

// --- START SERVER ---
server.listen(PORT, () => {
  console.log(`==========================================`);
  console.log(`🔊 AUDIO BACKEND RUNNING ON PORT ${PORT}`);
  console.log(`==========================================`);
});
