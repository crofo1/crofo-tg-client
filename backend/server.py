# -*- coding: utf-8 -*-
import os
import sys
import json
import asyncio
import threading
import shutil
import mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from telethon import TelegramClient, events
from telethon.errors import SessionPasswordNeededError

# Configuration
PORT = 8080
D_DIR = r"D:\crofo-tg-client"
BACKEND_DIR = os.path.join(D_DIR, "backend")
FRONTEND_DIR = os.path.join(D_DIR, "frontend")
DB_FILE = os.path.join(BACKEND_DIR, "database.json")
KEYS_FILE = r"C:\Users\User\Desktop\jarvis\crofo_keys.json"
JARVIS_SESSION = r"C:\Users\User\Desktop\jarvis\jarvis_tg.session"
LOCAL_SESSION = os.path.join(BACKEND_DIR, "client_session")

# Global Variables
client = None
loop = None
db = {
    "deleted_messages": {}, # (chat_id, msg_id) -> message_data
    "edited_messages": {},  # (chat_id, msg_id) -> list of edits
    "crypto_keys": {},      # chat_id -> password
    "spy_settings": {
        "channels": [],
        "keywords": [],
        "alert_chat": "me"
    },
    "ghost_mode": {
        "silent_read": True,
        "typing_hide": True
    }
}

# Message cache to intercept deletes
message_cache = {} # (chat_id, msg_id) -> message_data
event_queue = [] # Queue of events for the frontend

# Load DB
def load_db():
    global db
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                db.update(loaded)
        except Exception as e:
            print(f"[DB] Error loading DB: {e}")

# Save DB
def save_db():
    try:
        with open(DB_FILE, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"[DB] Error saving DB: {e}")

# Copy existing session if available
def check_session():
    if not os.path.exists(LOCAL_SESSION + ".session"):
        if os.path.exists(JARVIS_SESSION):
            try:
                print(f"[SESSION] Copying existing session from Jarvis: {JARVIS_SESSION}")
                shutil.copy(JARVIS_SESSION, LOCAL_SESSION + ".session")
            except Exception as e:
                print(f"[SESSION] Could not copy Jarvis session: {e}")

# Get API credentials
def get_api_credentials():
    api_id = 35237422
    api_hash = "17a3cf15e5918bd3dc9e5d261e402b55"
    if os.path.exists(KEYS_FILE):
        try:
            with open(KEYS_FILE, 'r', encoding='utf-8') as f:
                keys = json.load(f)
                api_id = keys.get("telegram_api_id", api_id)
                api_hash = keys.get("telegram_api_hash", api_hash)
        except Exception:
            pass
    return int(api_id), api_hash

# Setup Telethon Client
api_id, api_hash = get_api_credentials()
check_session()

async def init_client():
    global client, loop
    loop = asyncio.get_event_loop()
    client = TelegramClient(LOCAL_SESSION, api_id, api_hash)
    
    # Register events
    @client.on(events.NewMessage)
    async def on_new_message(event):
        try:
            chat_id = event.chat_id
            msg_id = event.id
            sender = await event.get_sender()
            sender_name = getattr(sender, 'first_name', '') or getattr(sender, 'title', '') or "Unknown"
            
            msg_data = {
                "id": msg_id,
                "chat_id": chat_id,
                "text": event.text,
                "date": event.date.isoformat(),
                "sender_id": event.sender_id,
                "sender_name": sender_name,
                "out": event.out
            }
            
            # Cache the message
            message_cache[(chat_id, msg_id)] = msg_data
            
            # Smart Channel Spy
            spy_channels = db["spy_settings"]["channels"]
            spy_keywords = db["spy_settings"]["keywords"]
            
            if spy_channels and spy_keywords:
                is_spy_channel = False
                # Check if chat is in spy list
                chat = await event.get_chat()
                chat_username = getattr(chat, 'username', '')
                if str(chat_id) in spy_channels or (chat_username and chat_username in spy_channels):
                    is_spy_channel = True
                
                if is_spy_channel:
                    text_lower = event.text.lower()
                    matched_keywords = [kw for kw in spy_keywords if kw.lower() in text_lower]
                    if matched_keywords:
                        # Forward to alert chat or me
                        alert_target = db["spy_settings"]["alert_chat"]
                        alert_text = (
                            f"🔔 **SPY ALERT!**\n"
                            f"Channel: {chat.title} (@{chat_username or 'no_username'})\n"
                            f"Keyword: {', '.join(matched_keywords)}\n"
                            f"Message: {event.text}"
                        )
                        await client.send_message(alert_target, alert_text)
                        
                        event_queue.append({
                            "type": "spy_alert",
                            "chat_id": chat_id,
                            "chat_title": chat.title,
                            "text": event.text,
                            "keywords": matched_keywords
                        })

            # Queue new message event
            event_queue.append({
                "type": "new_message",
                "chat_id": chat_id,
                "message": msg_data
            })
            
        except Exception as e:
            print(f"[CLIENT] Error in on_new_message: {e}")

    @client.on(events.MessageDeleted)
    async def on_message_deleted(event):
        try:
            chat_id = event.chat_id
            for msg_id in event.deleted_ids:
                cached = message_cache.get((chat_id, msg_id))
                if cached:
                    # Save to db
                    db["deleted_messages"][f"{chat_id}_{msg_id}"] = cached
                    save_db()
                    
                    event_queue.append({
                        "type": "message_deleted",
                        "chat_id": chat_id,
                        "msg_id": msg_id,
                        "message": cached
                    })
        except Exception as e:
            print(f"[CLIENT] Error in on_message_deleted: {e}")

    @client.on(events.MessageEdited)
    async def on_message_edited(event):
        try:
            chat_id = event.chat_id
            msg_id = event.id
            cached = message_cache.get((chat_id, msg_id))
            
            edit_history = db["edited_messages"].setdefault(f"{chat_id}_{msg_id}", [])
            if cached and cached["text"] != event.text:
                edit_history.append({
                    "text": cached["text"],
                    "date": cached["date"]
                })
                cached["text"] = event.text
                cached["date"] = event.date.isoformat()
                message_cache[(chat_id, msg_id)] = cached
                save_db()
                
                event_queue.append({
                    "type": "message_edited",
                    "chat_id": chat_id,
                    "msg_id": msg_id,
                    "new_text": event.text,
                    "history": edit_history
                })
        except Exception as e:
            print(f"[CLIENT] Error in on_message_edited: {e}")

# HTTP Request Handler
class ClientHTTPRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        BaseHTTPRequestHandler.end_headers(self)

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # Serve Frontend Static Files
        if path == "/" or path == "/index.html":
            self.serve_file(os.path.join(FRONTEND_DIR, "index.html"), "text/html")
        elif path == "/style.css":
            self.serve_file(os.path.join(FRONTEND_DIR, "style.css"), "text/css")
        elif path == "/app.js":
            self.serve_file(os.path.join(FRONTEND_DIR, "app.js"), "application/javascript")
        
        # API Endpoints
        elif path == "/api/status":
            is_connected = client.is_connected() if client else False
            is_authorized = False
            me = None
            if is_connected:
                # Need run_until_complete style check safely
                future = asyncio.run_coroutine_threadsafe(client.is_user_authorized(), loop)
                try:
                    is_authorized = future.result(timeout=5)
                    if is_authorized:
                        future_me = asyncio.run_coroutine_threadsafe(client.get_me(), loop)
                        me_obj = future_me.result(timeout=5)
                        me = {
                            "first_name": me_obj.first_name,
                            "last_name": me_obj.last_name,
                            "username": me_obj.username,
                            "phone": me_obj.phone
                        }
                except Exception as e:
                    print(f"[API] Error checking auth status: {e}")
            
            self.send_json({
                "connected": is_connected,
                "authorized": is_authorized,
                "me": me
            })
            
        elif path == "/api/chats":
            if not client or not client.is_connected():
                self.send_json({"success": False, "error": "Not connected"})
                return
            
            future = asyncio.run_coroutine_threadsafe(get_chats_list(), loop)
            try:
                chats = future.result(timeout=10)
                self.send_json({"success": True, "chats": chats})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})

        elif path == "/api/messages":
            chat_id = query.get("chat_id")
            if not chat_id:
                self.send_json({"success": False, "error": "chat_id is required"})
                return
            
            limit = int(query.get("limit", [50])[0])
            future = asyncio.run_coroutine_threadsafe(get_chat_messages(int(chat_id[0]), limit), loop)
            try:
                messages = future.result(timeout=10)
                self.send_json({"success": True, "messages": messages})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})

        elif path == "/api/poll_events":
            global event_queue
            events_to_send = list(event_queue)
            event_queue.clear()
            self.send_json({"events": events_to_send})

        elif path == "/api/settings":
            self.send_json({
                "success": True,
                "crypto_keys": db["crypto_keys"],
                "spy_settings": db["spy_settings"],
                "ghost_mode": db["ghost_mode"]
            })

        else:
            # Try to serve files from frontend directory as fallback
            filepath = os.path.join(FRONTEND_DIR, path.lstrip('/'))
            if os.path.exists(filepath) and os.path.isfile(filepath):
                mime_type, _ = mimetypes.guess_type(filepath)
                self.serve_file(filepath, mime_type or "application/octet-stream")
            else:
                self.send_response(404)
                self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')
        data = {}
        if post_data:
            try:
                data = json.loads(post_data)
            except Exception:
                pass

        if path == "/api/login/start":
            phone = data.get("phone")
            if not phone:
                self.send_json({"success": False, "error": "Phone number is required"})
                return
            
            future = asyncio.run_coroutine_threadsafe(start_telegram_login(phone), loop)
            try:
                res = future.result(timeout=15)
                self.send_json(res)
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})

        elif path == "/api/login/code":
            code = data.get("code")
            phone = data.get("phone")
            future = asyncio.run_coroutine_threadsafe(submit_telegram_code(phone, code), loop)
            try:
                res = future.result(timeout=15)
                self.send_json(res)
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})

        elif path == "/api/login/password":
            password = data.get("password")
            phone = data.get("phone")
            future = asyncio.run_coroutine_threadsafe(submit_telegram_password(phone, password), loop)
            try:
                res = future.result(timeout=15)
                self.send_json(res)
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})

        elif path == "/api/send_message":
            chat_id = data.get("chat_id")
            text = data.get("text")
            silent_read = data.get("silent_read", db["ghost_mode"]["silent_read"])
            
            if not chat_id or text is None:
                self.send_json({"success": False, "error": "chat_id and text are required"})
                return
            
            future = asyncio.run_coroutine_threadsafe(send_telegram_message(int(chat_id), text), loop)
            try:
                res = future.result(timeout=10)
                self.send_json(res)
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})

        elif path == "/api/set_crypto_key":
            chat_id = str(data.get("chat_id"))
            key = data.get("key")
            
            if not chat_id:
                self.send_json({"success": False, "error": "chat_id is required"})
                return
            
            if key:
                db["crypto_keys"][chat_id] = key
            elif chat_id in db["crypto_keys"]:
                del db["crypto_keys"][chat_id]
                
            save_db()
            self.send_json({"success": True})

        elif path == "/api/settings/spy":
            db["spy_settings"]["channels"] = data.get("channels", db["spy_settings"]["channels"])
            db["spy_settings"]["keywords"] = data.get("keywords", db["spy_settings"]["keywords"])
            db["spy_settings"]["alert_chat"] = data.get("alert_chat", db["spy_settings"]["alert_chat"])
            save_db()
            self.send_json({"success": True})

        elif path == "/api/toggle_ghost":
            db["ghost_mode"]["silent_read"] = data.get("silent_read", db["ghost_mode"]["silent_read"])
            db["ghost_mode"]["typing_hide"] = data.get("typing_hide", db["ghost_mode"]["typing_hide"])
            save_db()
            self.send_json({"success": True})

        elif path == "/api/mark_read":
            chat_id = int(data.get("chat_id"))
            # Mark messages read (if Ghost Mode: Silent Read is off, or manually triggered)
            future = asyncio.run_coroutine_threadsafe(mark_chat_read(chat_id), loop)
            try:
                future.result(timeout=5)
                self.send_json({"success": True})
            except Exception as e:
                self.send_json({"success": False, "error": str(e)})

        else:
            self.send_response(404)
            self.end_headers()

    def serve_file(self, filepath, content_type):
        if not os.path.exists(filepath):
            self.send_response(404)
            self.end_headers()
            return
        
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(os.path.getsize(filepath)))
        self.end_headers()
        with open(filepath, 'rb') as f:
            self.wfile.write(f.read())

    def send_json(self, data):
        response_bytes = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

# --- Telethon Async Operations Wrapper ---

phone_code_hash_cache = {}

async def start_telegram_login(phone):
    global client
    if not client.is_connected():
        await client.connect()
    
    try:
        sent = await client.send_code_request(phone)
        phone_code_hash_cache[phone] = sent.phone_code_hash
        return {"success": True, "requires_code": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def submit_telegram_code(phone, code):
    global client
    phone_code_hash = phone_code_hash_cache.get(phone)
    if not phone_code_hash:
        return {"success": False, "error": "Login session not found. Please start again."}
    
    try:
        await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
        return {"success": True, "logged_in": True}
    except SessionPasswordNeededError:
        return {"success": True, "requires_password": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def submit_telegram_password(phone, password):
    global client
    try:
        await client.sign_in(password=password)
        return {"success": True, "logged_in": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def get_chats_list():
    global client
    chats_list = []
    try:
        async for dialog in client.iter_dialogs(limit=100):
            # Check last message content
            last_msg_text = dialog.message.message if dialog.message else ""
            
            chat_type = "user"
            if dialog.is_group:
                chat_type = "group"
            elif dialog.is_channel:
                chat_type = "channel"
                
            chats_list.append({
                "id": dialog.id,
                "title": dialog.name,
                "unread_count": dialog.unread_count,
                "last_message": last_msg_text,
                "last_message_date": dialog.message.date.isoformat() if dialog.message else None,
                "type": chat_type,
                "crypto_enabled": str(dialog.id) in db["crypto_keys"]
            })
    except Exception as e:
        print(f"[CLIENT] Error fetching dialogs: {e}")
    return chats_list

async def get_chat_messages(chat_id, limit=50):
    global client
    messages = []
    try:
        # Mark read on backend if ghost mode silent read is disabled
        if not db["ghost_mode"]["silent_read"]:
            await client.send_read_acknowledge(chat_id)

        async for msg in client.iter_messages(chat_id, limit=limit):
            sender = await msg.get_sender()
            sender_name = getattr(sender, 'first_name', '') or getattr(sender, 'title', '') or "Unknown"
            
            msg_id = msg.id
            is_deleted = f"{chat_id}_{msg_id}" in db["deleted_messages"]
            is_edited = f"{chat_id}_{msg_id}" in db["edited_messages"]
            
            # Fetch message text from local DB if it was deleted, to preserve it
            text = msg.message
            if is_deleted:
                text = db["deleted_messages"][f"{chat_id}_{msg_id}"]["text"]
                
            edit_history = db["edited_messages"].get(f"{chat_id}_{msg_id}", [])
            
            msg_data = {
                "id": msg_id,
                "chat_id": chat_id,
                "text": text,
                "date": msg.date.isoformat(),
                "sender_id": msg.sender_id,
                "sender_name": sender_name,
                "out": msg.out,
                "deleted": is_deleted,
                "edited": is_edited,
                "edit_history": edit_history
            }
            
            # Add to local cache if not already there
            message_cache[(chat_id, msg_id)] = msg_data
            
            messages.append(msg_data)
            
        # Reverse to show chronological order
        messages.reverse()
    except Exception as e:
        print(f"[CLIENT] Error fetching messages: {e}")
    return messages

async def send_telegram_message(chat_id, text):
    global client
    try:
        # Ghost mode typing hide
        if db["ghost_mode"]["typing_hide"]:
            # Simply send message without triggering typing events
            pass
        else:
            # Trigger typing indicator
            async with client.action(chat_id, 'typing'):
                await asyncio.sleep(0.5)

        msg = await client.send_message(chat_id, text)
        
        sender = await msg.get_sender()
        sender_name = getattr(sender, 'first_name', '') or "Me"
        
        msg_data = {
            "id": msg.id,
            "chat_id": chat_id,
            "text": msg.message,
            "date": msg.date.isoformat(),
            "sender_id": msg.sender_id,
            "sender_name": sender_name,
            "out": True
        }
        message_cache[(chat_id, msg.id)] = msg_data
        
        return {"success": True, "message": msg_data}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def mark_chat_read(chat_id):
    global client
    try:
        await client.send_read_acknowledge(chat_id)
    except Exception as e:
        print(f"[CLIENT] Error marking chat read: {e}")

# Run Telethon loop
def run_telethon():
    global client, loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    loop.run_until_complete(init_client())
    
    # Run Telethon event loop
    print("[TELETHON] Connecting and starting...")
    client.start()
    print("[TELETHON] Client started.")
    client.run_until_disconnected()

# Run Web Server
def run_web_server():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, ClientHTTPRequestHandler)
    print(f"[SERVER] HTTP server running on http://localhost:{PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    # Ensure directories exist
    os.makedirs(BACKEND_DIR, exist_ok=True)
    os.makedirs(FRONTEND_DIR, exist_ok=True)
    
    # Load settings database
    load_db()
    
    # Start Web Server in a background thread
    web_thread = threading.Thread(target=run_web_server, daemon=True)
    web_thread.start()
    
    # Start Telethon client in the main thread (since it handles async event loop and signals)
    run_telethon()
