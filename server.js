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
// Now includes 'requester' to track who asked for the song
let currentState = { action: "stop", url: null, text: null, requester: null };
let nowPlaying = null; // { url, text, requester }
let queue = [];        // array of { url, text, requester }

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
    queue: queue.map(t => ({ text: t.text, requester: t.requester }))
  });
}

// --- AUTH ---
function isAuthorized(data) {
  if (!RADIO_KEY) return true; // If no key set in env, allow all
  return data && data.key === RADIO_KEY;
}

// --- RESOLVE INPUT -> TRACK ---
function buildTrack({ url, query, text, requester }) {
  // Default to "Server" if no name provided
  const reqBy = requester || "Server";

  // 1. Direct Link (starts with http)
  if (typeof url === "string" && url.startsWith("http")) {
    return {
      url,
      text: typeof text === "string" && text.trim() ? text : "Now playing",
      requester: reqBy
    };
  }

  // 2. SMART CHECK: If 'url' is just a name (like "cradles"), treat it as a query
  let search = query;
  if (!search && typeof url === "string" && url.trim()) {
     search = url;
  }

  // 3. Library Lookup (songs.json)
  if (typeof search === "string" && search.trim()) {
    const found = resolveSong(search);
    if (found) {
       return {
         url: found.url,
         text: found.title || (typeof text === "string" ? text : "Now playing"),
         requester: reqBy
       };
    }
  }

  return null;
}

// --- QUEUE ENGINE ---
function startTrack(track) {
  nowPlaying = track;
  currentState = { 
    action: "play", 
    url: track.url, 
    text: track.text,
    requester: track.requester 
  };
  broadcastState();
  console.log(`[PLAY] ${track.text} (Req: ${track.requester})`);
}

function nextTrack() {
  if (queue.length === 0) {
    nowPlaying = null;
    currentState = { action: "stop", url: null, text: null, requester: null };
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
  // Extract requester from the incoming JSON
  const { url, query, text, key, requester } = req.body || {};
  
  if (!isAuthorized({ key })) return res.status(403).json({ error: "unauthorized" });

  const track = buildTrack({ url, query, text, requester });
  if (!track) return res.status(400).json({ error: "invalid url/query" });

  enqueueOrPlay(track);
  res.json({ success: true });
});

app.post("/stop", (req, res) => {
  const { key } = req.body || {};
  if (!isAuthorized({ key })) return res.status(403).json({ error: "unauthorized" });

  nowPlaying = null;
  queue = [];
  currentState = { action: "stop", url: null, text: null, requester: null };
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
        // Ignored to prevent double-skips
      }
      return;
    }

    // --- CONTROL ACTIONS (Auth Required) ---
    if (data.action === "play") {
      if (!isAuthorized(data)) return;
      const track = buildTrack({ 
          url: data.url, 
          query: data.query, 
          text: data.text, 
          requester: data.requester // Support requester via WS too
      });
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
      currentState = { action: "stop", url: null, text: null, requester: null };
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
      // Logic for retrieving queue list could go here
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
