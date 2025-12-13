# 🔊 Sequence SMP Audio Backend

This is the backend server for the **Sequence SMP Website**. It acts as a bridge between the Minecraft Server and the players' web browsers.

It uses **WebSockets** to broadcast audio commands in real-time to all connected users on the website.

## 🚀 Tech Stack
*   **Node.js**
*   **Express** (REST API)
*   **WS** (WebSocket Server)

---

## 📡 API Endpoints (How to Control Audio)

You (or a Minecraft plugin) can send HTTP POST requests to this server to control the music.

### 1. Play Audio
**Endpoint:** `POST /play`  
**Body (JSON):**
```json
{
  "url": "https://example.com/song.mp3",
  "text": "Song Name Displayed on Site"
}
