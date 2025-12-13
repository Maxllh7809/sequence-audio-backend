const fs = require("fs");

const path = require("path");

const SONGS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "songs.json"), "utf8")
);

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function resolveSong(query) {
  return SONGS[norm(query)] || null;
}

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors');

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;

// --- SETUP SERVERS ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- MIDDLEWARE ---
app.use(cors()); // Allows your GitHub Pages site to talk to this backend
app.use(bodyParser.json());

// --- STATE ---
// We keep track of what's playing so new users hear it immediately upon joining
let currentState = {
    action: 'stop',
    url: null,
    text: null
};

// --- REST API (For Minecraft Plugin to call) ---

// 1. Play Audio
app.post('/play', (req, res) => {
    const { url, text } = req.body;

    if (!url) {
        return res.status(400).json({ error: "Missing 'url' field" });
    }

    // Update State
    currentState = {
        action: 'play',
        url: url,
        text: text || "Unknown Track"
    };

    // Broadcast to all connected websites
    broadcast(currentState);

    console.log(`[CMD] Playing: ${text} (${url})`);
    res.json({ success: true, message: "Broadcast sent" });
});

// 2. Stop Audio
app.post('/stop', (req, res) => {
    // Update State
    currentState = {
        action: 'stop',
        url: null,
        text: null
    };

    // Broadcast
    broadcast(currentState);

    console.log(`[CMD] Audio Stopped`);
    res.json({ success: true, message: "Stop command sent" });
});

// 3. Status Check
app.get('/', (req, res) => {
    res.send(`Sequence SMP Audio Server is running. Connected clients: ${wss.clients.size}`);
});

// --- WEBSOCKET LOGIC (For Website Clients) ---

wss.on("connection", (socket) => {
  socket.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // allow plugin-triggered playback
    if (data.action === "play") {
  let track = null;

  // Case 1: plugin sent a direct URL
  if (typeof data.url === "string" && data.url.startsWith("http")) {
    track = {
      url: data.url,
      text: data.text || "Now playing"
    };
  }

  // Case 2: plugin sent a song name
  else if (typeof data.query === "string") {
    const found = resolveSong(data.query);
    if (!found) {
      // optional: tell listeners song not found
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(JSON.stringify({
            action: "error",
            text: `Song not found: ${data.query}`
          }));
        }
      }
      return;
    }

    track = {
      url: found.url,
      text: found.title
    };
  }

  if (!track) return;

  const msg = JSON.stringify({
    action: "play",
    url: track.url,
    text: track.text
  });

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}
  });
});

// Helper function to send data to ALL connected clients
function broadcast(data) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// --- START SERVER ---
server.listen(PORT, () => {
    console.log(`==========================================`);
    console.log(`🔊 AUDIO BACKEND RUNNING ON PORT ${PORT}`);
    console.log(`🌐 WebSocket Endpoint: ws://localhost:${PORT}`);
    console.log(`==========================================`);
});
