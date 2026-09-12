// ================= GLOBAL STATES ================= */
let activeChatId = null;
let activeChatTitle = "";
let currentChats = [];
let pollInterval = null;
let currentCryptoKeys = {}; // chat_id -> string password
let activeCryptoPassword = ""; // Current active chat's password
let myUserObj = null;

const API_BASE = "http://localhost:8080";

// ================= CRYPTOGRAPHY HELPERS (AES-GCM) ================= */
async function deriveKey(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return await crypto.subtle.importKey(
        'raw',
        hash,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
    );
}

function bufToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBuf(hexString) {
    if (!hexString) return new Uint8Array();
    const matches = hexString.match(/.{1,2}/g);
    if (!matches) return new Uint8Array();
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

async function encryptMessage(plaintext, password) {
    try {
        const key = await deriveKey(password);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoder = new TextEncoder();
        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encoder.encode(plaintext)
        );
        const ivHex = bufToHex(iv);
        const cipherHex = bufToHex(ciphertext);
        return `🔒 [ENC]:${ivHex}:${cipherHex}`;
    } catch (e) {
        console.error("Encryption failed:", e);
        return plaintext;
    }
}

async function decryptMessage(encryptedText, password) {
    if (!encryptedText.startsWith("🔒 [ENC]:")) return encryptedText;
    if (!password) return "🔒 [ENC]: (Shifrlangan - parolni kiriting)";
    
    try {
        const parts = encryptedText.split(":");
        if (parts.length < 3) return "🔒 [ENC]: (Format xato)";
        const ivHex = parts[1];
        const cipherHex = parts[2];
        
        const key = await deriveKey(password);
        const iv = hexToBuf(ivHex);
        const ciphertext = hexToBuf(cipherHex);
        
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            ciphertext
        );
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error("Decryption failed:", e);
        return "🔒 [ENC]: (Xato parol kiritilgan)";
    }
}

// ================= AUTHENTICATION FLOW ================= */
async function checkAuthStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        const data = await res.json();
        
        if (data.connected && data.authorized) {
            myUserObj = data.me;
            document.getElementById("auth-screen").classList.add("hidden");
            document.getElementById("main-screen").classList.remove("hidden");
            
            // Set User Info
            document.getElementById("my-name").textContent = `${data.me.first_name || ""} ${data.me.last_name || ""}`.trim() || data.me.username || "Siz";
            document.getElementById("my-avatar").textContent = (data.me.first_name || "C").charAt(0).toUpperCase();
            
            // Start loading data
            loadChats();
            loadSettings();
            
            // Start updates polling
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(pollEvents, 1500);
        } else {
            // Show auth screen
            document.getElementById("auth-screen").classList.remove("hidden");
            document.getElementById("main-screen").classList.add("hidden");
            showAuthStep("phone");
        }
    } catch (e) {
        console.error("Error checking auth status:", e);
        showAuthStatus("Backend serverga ulanib bo'lmadi! server.py ishlayotganiga ishonch hosil qiling.", true);
    }
}

function showAuthStep(step) {
    document.querySelectorAll(".auth-step").forEach(el => el.classList.add("hidden"));
    document.getElementById(`auth-step-${step}`).classList.remove("hidden");
}

function showAuthStatus(msg, isError = false) {
    const el = document.getElementById("auth-status-msg");
    el.textContent = msg;
    el.style.color = isError ? "var(--red)" : "var(--cyan)";
}

// Login actions
document.getElementById("btn-send-code").addEventListener("click", async () => {
    const phone = document.getElementById("phone-input").value.trim();
    if (!phone) {
        showAuthStatus("Telefon raqamni kiriting!", true);
        return;
    }
    showAuthStatus("Kod yuborilmoqda...");
    try {
        const res = await fetch(`${API_BASE}/api/login/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();
        if (data.success) {
            showAuthStatus("Kod yuborildi. Telegramingizni tekshiring.");
            showAuthStep("code");
        } else {
            showAuthStatus("Xatolik: " + data.error, true);
        }
    } catch (e) {
        showAuthStatus("Ulanish xatosi!", true);
    }
});

document.getElementById("btn-verify-code").addEventListener("click", async () => {
    const code = document.getElementById("code-input").value.trim();
    const phone = document.getElementById("phone-input").value.trim();
    if (!code) {
        showAuthStatus("Kodni kiriting!", true);
        return;
    }
    showAuthStatus("Tasdiqlanmoqda...");
    try {
        const res = await fetch(`${API_BASE}/api/login/code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, code })
        });
        const data = await res.json();
        if (data.success) {
            if (data.logged_in) {
                showAuthStatus("Muvaffaqiyatli kirdingiz!");
                checkAuthStatus();
            } else if (data.requires_password) {
                showAuthStatus("2FA Parol talab etiladi.");
                showAuthStep("password");
            }
        } else {
            showAuthStatus("Xatolik: " + data.error, true);
        }
    } catch (e) {
        showAuthStatus("Ulanish xatosi!", true);
    }
});

document.getElementById("btn-verify-password").addEventListener("click", async () => {
    const password = document.getElementById("password-input").value;
    const phone = document.getElementById("phone-input").value.trim();
    if (!password) {
        showAuthStatus("Parolni kiriting!", true);
        return;
    }
    showAuthStatus("Kirilmoqda...");
    try {
        const res = await fetch(`${API_BASE}/api/login/password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, password })
        });
        const data = await res.json();
        if (data.success && data.logged_in) {
            showAuthStatus("Muvaffaqiyatli kirdingiz!");
            checkAuthStatus();
        } else {
            showAuthStatus("Parol xato yoki boshqa xatolik: " + data.error, true);
        }
    } catch (e) {
        showAuthStatus("Ulanish xatosi!", true);
    }
});

document.getElementById("btn-back-phone").addEventListener("click", () => {
    showAuthStep("phone");
    showAuthStatus("");
});

// ================= LOAD DATA (CHATS & SETTINGS) ================= */
async function loadChats() {
    try {
        const res = await fetch(`${API_BASE}/api/chats`);
        const data = await res.json();
        if (data.success) {
            currentChats = data.chats;
            renderChatsList();
        }
    } catch (e) {
        console.error("Error loading chats:", e);
    }
}

function renderChatsList() {
    const container = document.getElementById("chats-container");
    const filter = document.querySelector(".filter-tab.active").dataset.filter;
    const searchQuery = document.getElementById("search-input").value.toLowerCase();
    
    container.innerHTML = "";
    
    const filtered = currentChats.filter(chat => {
        // Filter by tab
        if (filter !== "all" && chat.type !== filter) return false;
        // Filter by search
        if (searchQuery && !(chat.title || "").toLowerCase().includes(searchQuery)) return false;
        return true;
    });
    
    if (filtered.length === 0) {
        container.innerHTML = `<div class="loading-spinner"><span>Chatlar topilmadi</span></div>`;
        return;
    }
    
    filtered.forEach(chat => {
        const isCrypto = currentCryptoKeys[chat.id.toString()] ? true : false;
        
        const item = document.createElement("div");
        item.className = `chat-item ${chat.id === activeChatId ? "active" : ""}`;
        item.dataset.id = chat.id;
        
        const avatarLetter = chat.title ? chat.title.charAt(0).toUpperCase() : "U";
        
        item.innerHTML = `
            <div class="avatar">${avatarLetter}</div>
            <div class="chat-item-details">
                <div class="chat-item-title-row">
                    <h4>${chat.title || "Muloqot"}</h4>
                    <span class="chat-badge ${isCrypto ? "crypto" : ""}">${isCrypto ? "<i class='fa-solid fa-lock'></i> Crypt" : chat.type}</span>
                </div>
                <div class="chat-item-msg-row">
                    <p>${chat.last_message || "(Xabar yo'q)"}</p>
                    ${chat.unread_count > 0 ? `<span class="unread-badge">${chat.unread_count}</span>` : ""}
                </div>
            </div>
        `;
        
        item.addEventListener("click", () => selectChat(chat));
        container.appendChild(item);
    });
}

// Search and Filter Listeners
document.getElementById("search-input").addEventListener("input", renderChatsList);
document.querySelectorAll(".filter-tab").forEach(tab => {
    tab.addEventListener("click", (e) => {
        document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
        e.target.classList.add("active");
        renderChatsList();
    });
});

// ================= LOAD & SEND MESSAGES ================= */
async function selectChat(chat) {
    activeChatId = chat.id;
    activeChatTitle = chat.title || "Muloqot";
    
    // UI changes
    document.getElementById("chat-empty-state").classList.add("hidden");
    document.getElementById("chat-active-state").classList.remove("hidden");
    
    document.getElementById("active-chat-title").textContent = chat.title || "Muloqot";
    document.getElementById("active-chat-type").textContent = chat.type;
    document.getElementById("active-chat-avatar").textContent = (chat.title || "U").charAt(0).toUpperCase();
    
    // Clear message input
    document.getElementById("message-input").value = "";
    
    // Check Crypto chat password
    activeCryptoPassword = currentCryptoKeys[chat.id.toString()] || "";
    updateCryptoUIState();
    
    // Update active class in list
    document.querySelectorAll(".chat-item").forEach(item => {
        if (parseInt(item.dataset.id) === chat.id) {
            item.classList.add("active");
            // clear unread count in UI
            const badge = item.querySelector(".unread-badge");
            if (badge) badge.remove();
        } else {
            item.classList.remove("active");
        }
    });

    // Mark as read in backend
    try {
        await fetch(`${API_BASE}/api/mark_read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chat.id })
        });
    } catch(e){}
    
    // Load Message History
    loadMessages();
}

async function loadMessages() {
    if (!activeChatId) return;
    const container = document.getElementById("messages-container");
    container.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i></div>`;
    
    try {
        const res = await fetch(`${API_BASE}/api/messages?chat_id=${activeChatId}&limit=50`);
        const data = await res.json();
        if (data.success) {
            container.innerHTML = "";
            for (let msg of data.messages) {
                const messageRow = await renderMessageBubble(msg);
                container.appendChild(messageRow);
            }
            scrollToBottom();
        }
    } catch (e) {
        console.error("Error loading messages:", e);
    }
}

async function renderMessageBubble(msg) {
    const row = document.createElement("div");
    row.className = `message-row ${msg.out ? "sent" : "received"}`;
    row.id = `msg-${msg.id}`;
    
    // Decrypt if encrypted message
    let displayText = msg.text;
    let isEncryptedMsg = msg.text.startsWith("🔒 [ENC]:");
    
    if (isEncryptedMsg) {
        displayText = await decryptMessage(msg.text, activeCryptoPassword);
    }
    
    const timeStr = new Date(msg.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    row.innerHTML = `
        <div class="message-bubble ${msg.deleted ? "deleted" : ""}">
            <div class="message-text">${displayText}</div>
            <div class="message-meta">
                ${!msg.out ? `<span class="sender-name">${msg.sender_name}</span>` : ""}
                <span class="message-time">${timeStr}</span>
                ${isEncryptedMsg ? `<span class="badge-crypto" title="E2E AES-256 shifrlangan"><i class="fa-solid fa-shield-halved"></i> Crypto</span>` : ""}
                ${msg.edited ? `<span class="badge-edited" data-msg-id="${msg.id}" title="Tahrir tarixi"><i class="fa-solid fa-pen"></i> Tahrirlangan</span>` : ""}
                ${msg.deleted ? `<span class="badge-deleted" title="O'chirilgan xabar saqlab qolindi"><i class="fa-solid fa-trash"></i> O'chirilgan</span>` : ""}
            </div>
        </div>
    `;
    
    // Add edit history event listener
    const editedBadge = row.querySelector(".badge-edited");
    if (editedBadge) {
        editedBadge.addEventListener("click", () => showEditHistory(msg.id, msg.edit_history));
    }
    
    return row;
}

function scrollToBottom() {
    const container = document.getElementById("messages-container");
    container.scrollTop = container.scrollHeight;
}

// Send Message action
async function sendMessage() {
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    if (!text || !activeChatId) return;
    
    input.value = "";
    
    let textToSend = text;
    if (activeCryptoPassword) {
        textToSend = await encryptMessage(text, activeCryptoPassword);
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/send_message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: activeChatId, text: textToSend })
        });
        const data = await res.json();
        if (data.success) {
            // Render locally
            const container = document.getElementById("messages-container");
            const bubble = await renderMessageBubble(data.message);
            container.appendChild(bubble);
            scrollToBottom();
            
            // update last message in sidebar
            loadChats();
        } else {
            alert("Xabarni yuborib bo'lmadi: " + data.error);
        }
    } catch (e) {
        console.error("Error sending message:", e);
    }
}

document.getElementById("btn-send-msg").addEventListener("click", sendMessage);
document.getElementById("message-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

// ================= CRYPTO CONFIGURATION ================= */
const btnToggleCrypto = document.getElementById("btn-toggle-crypto");
const cryptoConfigBar = document.getElementById("crypto-config-bar");
const cryptoSendIndicator = document.getElementById("crypto-send-indicator");

btnToggleCrypto.addEventListener("click", () => {
    cryptoConfigBar.classList.toggle("hidden");
    document.getElementById("crypto-key-input").value = activeCryptoPassword;
});

document.getElementById("btn-save-crypto-key").addEventListener("click", async () => {
    const password = document.getElementById("crypto-key-input").value.trim();
    if (!password) {
        alert("Parolni kiriting!");
        return;
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/set_crypto_key`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: activeChatId, key: password })
        });
        const data = await res.json();
        if (data.success) {
            currentCryptoKeys[activeChatId.toString()] = password;
            activeCryptoPassword = password;
            updateCryptoUIState();
            cryptoConfigBar.classList.add("hidden");
            loadChats(); // Reload sidebar to show lock status
            loadMessages(); // Reload message log to decrypt messages
        }
    } catch(e) {}
});

document.getElementById("btn-clear-crypto-key").addEventListener("click", async () => {
    try {
        const res = await fetch(`${API_BASE}/api/set_crypto_key`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: activeChatId, key: null })
        });
        const data = await res.json();
        if (data.success) {
            delete currentCryptoKeys[activeChatId.toString()];
            activeCryptoPassword = "";
            updateCryptoUIState();
            cryptoConfigBar.classList.add("hidden");
            loadChats(); // Reload sidebar
            loadMessages(); // Reload message log
        }
    } catch(e) {}
});

function updateCryptoUIState() {
    if (activeCryptoPassword) {
        btnToggleCrypto.classList.add("active");
        document.getElementById("crypto-status-text").innerHTML = `<i class='fa-solid fa-lock-open'></i> Secret: ON`;
        cryptoSendIndicator.classList.remove("hidden");
    } else {
        btnToggleCrypto.classList.remove("active");
        document.getElementById("crypto-status-text").innerHTML = `<i class='fa-solid fa-lock'></i> Secret: OFF`;
        cryptoSendIndicator.classList.add("hidden");
    }
}

// ================= GHOST MODE & SPY SETTINGS ================= */
// Toggle Settings Drawer
const settingsDrawer = document.getElementById("settings-drawer");
document.getElementById("btn-open-settings").addEventListener("click", () => {
    settingsDrawer.classList.remove("hidden");
});
document.getElementById("btn-close-settings").addEventListener("click", () => {
    settingsDrawer.classList.add("hidden");
});

async function loadSettings() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        const data = await res.json();
        if (data.success) {
            currentCryptoKeys = data.crypto_keys;
            
            // Set Ghost Toggles
            document.getElementById("setting-silent-read").checked = data.ghost_mode.silent_read;
            document.getElementById("setting-typing-hide").checked = data.ghost_mode.typing_hide;
            
            updateGhostIndicatorUI(data.ghost_mode);
            
            // Set Spy Form
            document.getElementById("spy-channels-input").value = data.spy_settings.channels.join(", ");
            document.getElementById("spy-keywords-input").value = data.spy_settings.keywords.join(", ");
            document.getElementById("spy-alert-chat-input").value = data.spy_settings.alert_chat;
        }
    } catch (e) {
        console.error("Error loading settings:", e);
    }
}

function updateGhostIndicatorUI(ghostMode) {
    const indicator = document.getElementById("ghost-indicator");
    if (ghostMode.silent_read || ghostMode.typing_hide) {
        indicator.classList.remove("hidden");
        let text = "<i class='fa-solid fa-ghost'></i> Ghost: ";
        if (ghostMode.silent_read && ghostMode.typing_hide) text += "Full";
        else if (ghostMode.silent_read) text += "Silent Read";
        else text += "Typing Hide";
        indicator.innerHTML = text;
    } else {
        indicator.classList.add("hidden");
    }
}

// Ghost mode listeners
async function toggleGhostSettings() {
    const silent_read = document.getElementById("setting-silent-read").checked;
    const typing_hide = document.getElementById("setting-typing-hide").checked;
    
    try {
        const res = await fetch(`${API_BASE}/api/toggle_ghost`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ silent_read, typing_hide })
        });
        const data = await res.json();
        if (data.success) {
            updateGhostIndicatorUI({ silent_read, typing_hide });
        }
    } catch(e) {}
}

document.getElementById("setting-silent-read").addEventListener("change", toggleGhostSettings);
document.getElementById("setting-typing-hide").addEventListener("change", toggleGhostSettings);

// Save Spy settings
document.getElementById("btn-save-spy").addEventListener("click", async () => {
    const channels = document.getElementById("spy-channels-input").value.split(",").map(s => s.trim()).filter(s => s.length > 0);
    const keywords = document.getElementById("spy-keywords-input").value.split(",").map(s => s.trim()).filter(s => s.length > 0);
    const alert_chat = document.getElementById("spy-alert-chat-input").value.trim() || "me";
    
    try {
        const res = await fetch(`${API_BASE}/api/settings/spy`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channels, keywords, alert_chat })
        });
        const data = await res.json();
        if (data.success) {
            alert("Kanal Snayperi muvaffaqiyatli saqlandi!");
        }
    } catch(e) {}
});

// Logout
document.getElementById("btn-logout").addEventListener("click", async () => {
    if (confirm("Rostdan ham akkauntdan chiqmoqchimisiz?")) {
        // Simple mock logout - since server has the session file, we can clear locally
        alert("Akkauntdan chiqish uchun D:\\crofo-tg-client\\backend\\client_session.session faylini o'chirib yuboring va ilovani qayta ishga tushiring.");
    }
});

// ================= EDIT HISTORY MODAL ================= */
const historyModal = document.getElementById("history-modal");
const historyModalBody = document.getElementById("history-modal-body");

function showEditHistory(msgId, history) {
    historyModalBody.innerHTML = "";
    
    const wrapper = document.createElement("div");
    wrapper.className = "edit-history-list";
    
    if (!history || history.length === 0) {
        wrapper.innerHTML = `<p>Tahrirlash tarixi topilmadi.</p>`;
    } else {
        history.forEach((item, index) => {
            const timeStr = new Date(item.date).toLocaleString();
            wrapper.innerHTML += `
                <div class="history-item">
                    <div><strong>Tahrir #${index + 1}</strong></div>
                    <div style="margin-top: 5px;">${item.text}</div>
                    <span class="history-item-date">${timeStr}</span>
                </div>
            `;
        });
    }
    
    historyModalBody.appendChild(wrapper);
    historyModal.classList.remove("hidden");
}

document.getElementById("btn-close-modal").addEventListener("click", () => {
    historyModal.classList.add("hidden");
});

// ================= REAL-TIME EVENTS POLLING ================= */
async function pollEvents() {
    try {
        const res = await fetch(`${API_BASE}/api/poll_events`);
        const data = await res.json();
        if (data.events && data.events.length > 0) {
            for (let event of data.events) {
                await handleIncomingEvent(event);
            }
        }
    } catch (e) {
        console.error("Polling error:", e);
    }
}

async function handleIncomingEvent(event) {
    if (event.type === "new_message") {
        // If message belongs to active chat, append it
        if (event.chat_id === activeChatId) {
            const container = document.getElementById("messages-container");
            const bubble = await renderMessageBubble(event.message);
            container.appendChild(bubble);
            scrollToBottom();
            
            // Mark read if active
            try {
                await fetch(`${API_BASE}/api/mark_read`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ chat_id: activeChatId })
                });
            } catch(e){}
        } else {
            // Just update chats list unread counts
            loadChats();
        }
    }
    
    else if (event.type === "message_deleted") {
        if (event.chat_id === activeChatId) {
            // Find message in DOM and update
            const bubbleRow = document.getElementById(`msg-${event.msg_id}`);
            if (bubbleRow) {
                const bubble = bubbleRow.querySelector(".message-bubble");
                bubble.classList.add("deleted");
                
                // Add deleted badge
                const meta = bubble.querySelector(".message-meta");
                if (meta && !meta.querySelector(".badge-deleted")) {
                    const badge = document.createElement("span");
                    badge.className = "badge-deleted";
                    badge.innerHTML = `<i class="fa-solid fa-trash"></i> O'chirilgan`;
                    meta.appendChild(badge);
                }
            }
        }
    }
    
    else if (event.type === "message_edited") {
        if (event.chat_id === activeChatId) {
            const bubbleRow = document.getElementById(`msg-${event.msg_id}`);
            if (bubbleRow) {
                // Update text
                const textEl = bubbleRow.querySelector(".message-text");
                let textToDisplay = event.new_text;
                if (event.new_text.startsWith("🔒 [ENC]:")) {
                    textToDisplay = await decryptMessage(event.new_text, activeCryptoPassword);
                }
                textEl.textContent = textToDisplay;
                
                // Update meta with edited badge
                const meta = bubbleRow.querySelector(".message-meta");
                if (meta) {
                    let editedBadge = meta.querySelector(".badge-edited");
                    if (!editedBadge) {
                        editedBadge = document.createElement("span");
                        editedBadge.className = "badge-edited";
                        editedBadge.innerHTML = `<i class="fa-solid fa-pen"></i> Tahrirlangan`;
                        meta.appendChild(editedBadge);
                    }
                    // Rebind history trigger
                    editedBadge.replaceWith(editedBadge.cloneNode(true));
                    const newBadge = meta.querySelector(".badge-edited");
                    newBadge.addEventListener("click", () => showEditHistory(event.msg_id, event.history));
                }
            }
        }
    }
    
    else if (event.type === "spy_alert") {
        showSpyAlert(event.chat_title, event.text, event.keywords);
    }
}

// Spy alerts Banner UI
const notifBanner = document.getElementById("notification-banner");
let notifTimeout = null;

function showSpyAlert(chatTitle, text, keywords) {
    document.getElementById("notif-title").textContent = `🔔 SPY ALERT: ${chatTitle}`;
    document.getElementById("notif-body").textContent = `Kalit so'zlar: [${keywords.join(", ")}] — "${text.substring(0, 100)}..."`;
    
    notifBanner.classList.remove("hidden");
    
    if (notifTimeout) clearTimeout(notifTimeout);
    notifTimeout = setTimeout(() => {
        notifBanner.classList.add("hidden");
    }, 8000);
}

document.getElementById("btn-close-notif").addEventListener("click", () => {
    notifBanner.classList.add("hidden");
});

// ================= APP INITIALIZATION ================= */
window.addEventListener("DOMContentLoaded", () => {
    checkAuthStatus();
});
