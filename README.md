# 🌀 CROFO Telegram Desktop Client (Super-Secret Edition)

Welcome to the **CROFO Telegram Desktop Client**! This is a custom, premium, and feature-rich Telegram desktop application built on top of Python (Telethon) and an interactive glassmorphic web frontend, launched as a native borderless application.

---

## 🚀 Key Features

1. **🔒 Super-Secret Crypto Chat (AES-256 Overlay)**:
   - End-to-end encrypted messaging inside *any* chat (private, group, or channel).
   - Enter a shared secret key for a chat, and all messages sent in this mode will be encrypted locally using AES-256.
   - Telegram servers and other Telegram clients only see encrypted gibberish (e.g., `🔒 [ENC]: U2FsdGVkX1...`).
   - The CROFO Client automatically decrypts it in real-time in your UI when a key is provided!

2. **👻 Ghost Mode (Yashirin Rejim)**:
   - **Silent Read**: Read messages in any chat without sending read receipts (the sender will only see one tick, while you have read the message).
   - **Typing Hide**: Read and type messages without broadcasting the "typing..." status.

3. **💾 Anti-Delete & Anti-Edit (Xabarlar Himoyachisi)**:
   - If someone deletes a message in a group or private chat, it remains visible in your client with a red `[O'chirilgan]` badge.
   - If a message is edited, the original text is preserved and displayed with a yellow `[Tahrirlangan]` badge and history log.

4. **📡 Smart Channel Spy & Keyword Alerts**:
   - Add target channels to watch for specific keywords (e.g., "crypto", "aksiyalar", "vakansiya").
   - Instant popup notifications and auto-forwarding to your private chat.

5. **🎨 Premium Glassmorphic UI**:
   - Ultra-modern dark-mode design with glowing glass panels, customized message bubbles, and smooth micro-animations.

---

## 📂 Project Structure

* **`backend/server.py`**: Local Python backend running the Telethon Telegram client and hosting a WebSocket server for communication with the frontend.
* **`backend/database.json`**: Stores deleted/edited messages, pre-shared crypto keys, spy settings, and configuration.
* **`frontend/index.html`**: The UI dashboard template.
* **`frontend/style.css`**: Styling, theme variables, glassmorphic effects, and neon glows.
* **`frontend/app.js`**: Core frontend engine handling WebSockets, message loading, UI updates, and local encryption/decryption.
* **`launch.py`**: Launcher script that starts the backend and boots Microsoft Edge in App Mode (`--app=http://localhost:8080`).
* **`Start.bat`**: Windows batch shortcut to launch the app.
