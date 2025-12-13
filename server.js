const fs = require("fs");
const path = require("path");

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const bodyParser = require("body-parser");
const cors = require("cors");

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;

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
let currentState = {
  action: "stop",
  url: null,
  text: null
};

// --- BROADCAST HELPER ---
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// --- CORE: BUILD PLAY STATE FROM (url/query/text) ---
function buildPlayState({ url, query, text }) {
  // Direct URL
  if (typeof url === "string" && url.startsWith("http")) {
    return {
      action: "play",
      url,
      text: typeof text === "string" && text.trim() ? text : "Now playing"
    };
  }

  // Song key / query
  if (typeof query === "string" && query.trim()) {
    const found = resolveSong(query);
    if (!found) return null;

    return {
      action: "play",
      url: found.url,
      text: found.title || (typeof text === "string" ? text : "Now playing")
    };
  }

  return null;
}

// --- REST API (OPTIONAL) ---
app.post("/play", (req, res) => {
  const { url, query, text } = req.body || {};
  const next = buildPlayState({ url, query, text });

  if (!next) {
    return res.status(400).json({ error: "Missing/invalid 'url' or unknown 'query'." });
  }

  currentState = next;
  broadcast(currentState);

  console.log(`[REST] play -> ${currentState.text} (${currentState.url})`);
  res.json({ success: true, state: currentState });
});

app.post("/stop", (req, res) => {
  currentState = { action: "stop", url: null, text: null };
  broadcast(currentState);

  console.log(`[REST] stop`);
  res.json({ success: true });
});

app.get("/", (req, res) => {
  res.send(`Sequence SMP Audio Server running. Clients: ${wss.clients.size}`);
});

// --- WEBSOCKET LOGIC (WEBSITE + PLUGIN) ---
wss.on("connection", (socket) => {
  // Send current state immediately so new listeners sync
  try {
    socket.send(JSON.stringify(currentState));
  } catch {}

  socket.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Play (url or query)
    if (data.action === "play") {
      const next = buildPlayState({
        url: data.url,
        query: data.query,
        text: data.text
      });

      if (!next) {
        // optional error broadcast
        const msg = JSON.stringify({
          action: "error",
          text: data.query ? `Song not found: ${data.query}` : "Invalid play payload"
        });
        for (const client of wss.clients) {
          if (client.readyState === WebSocket.OPEN) client.send(msg);
        }
        return;
      }

      currentState = next;
      broadcast(currentState);
      console.log(`[WS] play -> ${currentState.text} (${currentState.url})`);
      return;
    }

    // Stop
    if (data.action === "stop") {
      currentState = { action: "stop", url: null, text: null };
      broadcast(currentState);
      console.log(`[WS] stop`);
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
