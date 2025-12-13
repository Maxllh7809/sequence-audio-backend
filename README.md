# 🔊 Sequence SMP Audio Backend

This is the backend Node.js server for the **Sequence SMP Website**. It acts as a real-time bridge between the Minecraft Server (or console) and the players' web browsers.

[![Frontend](https://img.shields.io/badge/GitHub-Frontend_Website_Repo-blue?style=for-the-badge&logo=github)](https://github.com/Maxllh7809/Sequence-SMP-Site)
[![Minecraft Plugin](https://img.shields.io/badge/GitHub-Radio_Plugin_Repo-blue?style=for-the-badge&logo=github)](https://github.com/Maxllh7809/sequence-radio-audio)
![NodeJS](https://img.shields.io/badge/node.js-6DA55F?style=for-the-badge&logo=openjdk&logoColor=white)

## 🚀 How it Works

1.  **Input:** A Minecraft plugin (or you manually) sends a `POST` request to this server.
2.  **Process:** This server receives the request containing an Audio URL.
3.  **Broadcast:** It immediately sends a WebSocket message to all open website tabs.
4.  **Output:** The website receives the message and plays the audio for the player.

---

## 📡 API Endpoints (Controlling the Music)

You can test these using **Postman**, **ReqBin**, or **cURL**.

### 1. Play Audio
**Endpoint:** `POST /play`  
**Headers:** `Content-Type: application/json`  
**Body:**
```json
{
  "url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
  "text": "Epic Boss Battle Music"
}
```

### 2. Stop Audio
**Endpoint:** `POST /stop`  
**Body:** *(Empty)*

### 3. Check Status
**Endpoint:** `GET /`  
**Response:** Returns "Audio Server Running" and the count of connected clients.

---

## 🔌 WebSocket Protocol

The frontend connects via **WebSocket (WSS)**. The backend sends JSON messages following this structure:

**On Play:**
```json
{
  "action": "play",
  "url": "https://direct-link-to-audio.mp3",
  "text": "Song Name"
}
```

**On Stop:**
```json
{
  "action": "stop"
}
```

---

## ☁️ Deployment (Render)

This repository includes a `render.yaml` file for automatic deployment on **Render.com**.

1.  Create a new **Blueprint** on Render.
2.  Connect this repository.
3.  Render will automatically detect the Node.js environment and start the server.
4.  **Copy your Render URL** (e.g., `https://sequence-audio-backend.onrender.com`) and update your Frontend `script.js` file.

---

## 🛠️ Local Development

To run this on your own computer:

1.  Clone the repo:
    ```bash
    git clone https://github.com/Maxllh7809/sequence-audio-backend.git
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the server:
    ```bash
    node server.js
    ```
4.  Server runs at: `http://localhost:8080` (WebSocket: `ws://localhost:8080`)

&copy; 2025 Sequence SMP
