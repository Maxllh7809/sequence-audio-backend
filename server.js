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

// [CRITICAL FIX] Allow server to host MP3 files located in this folder
app.use(express.static(__dirname));

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
  if (!RADIO_KEY) return true; // If no key set in env, allow all
  return data && data.key === RADIO_KEY;
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

// --- REST API ---
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

// --- WEBSOCKET LOGIC ---
wss.on("connection", (socket) => {
  // Sync state to new clients immediately
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

    // --- WEBSITE SIGNALS SONG ENDED ---
    if (data.action === "ended") {
      // [CRITICAL FIX] Verify the song that ended is the one actually playing
      if (nowPlaying && data.url === nowPlaying.url) {
        console.log(`[ENDED] Track finished: ${nowPlaying.text} -> playing next`);
        nextTrack();
      } else {
        // Ignored: This happens if multiple users send "ended" at the same time
      }
      return;
    }

    // --- CONTROL ACTIONS (Auth Required) ---
    if (data.action === "play") {
      if (!isAuthorized(data)) return;
      const track = buildTrack({ url: data.url, query: data.query, text: data.text });
      if (!track) {
        broadcast({ action: "error", text: "Song not found / Invalid Payload" });
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
      return;
    }

    if (data.action === "skip") {
      if (!isAuthorized(data)) return;
      nextTrack();
      return;
    }

    if (data.action === "queueList") {
      if (!isAuthorized(data)) return;
      // Logic for retrieving queue list (same as before)
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
