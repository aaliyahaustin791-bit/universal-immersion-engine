import { getContext } from "/scripts/extensions.js";
import { chat_metadata } from "/scripts/chat.js";

const EXT_ID = "universal-immersion-engine";

// --- CORE UTILITIES ---
function getSettings() {
    if (!window.extension_settings[EXT_ID]) window.extension_settings[EXT_ID] = {};
    return window.extension_settings[EXT_ID];
}

function saveSettings() {
    window.saveSettings();
}

function isNonEmptyObject(o) {
    try {
        return !!(o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).length > 0);
    } catch (_) { return false; }
}

// --- CHAT PERSISTENCE LOGIC ---
let lastChatId = null;
const SESSION_KEYS = [
    "inventory", "character", "currency", "currencySymbol", "currencyRate", 
    "calendar", "map", "social", "diary", "databank", "activities",
    "xp", "hp", "mp", "ap", "maxHp", "maxMp", "maxAp", "maxXp", "life", "image", "worldState"
];

function saveCurrentChatState() {
    if (!lastChatId) return;
    const s = getSettings();
    
    if (!chat_metadata['uie_state']) {
        chat_metadata['uie_state'] = {};
    }
    
    for (const k of SESSION_KEYS) {
        if (s[k] !== undefined) {
            chat_metadata['uie_state'][k] = JSON.parse(JSON.stringify(s[k]));
        }
    }
    
    // Clean up old bloat if it exists
    if (s.chats) {
        delete s.chats;
        saveSettings();
    }
}

function loadChatState(chatId) {
    const s = getSettings();
    lastChatId = chatId;
    
    if (!chatId) return;
    
    const saved = chat_metadata['uie_state'];
    
    if (saved) {
        for (const k of SESSION_KEYS) {
            if (saved[k] !== undefined) {
                s[k] = JSON.parse(JSON.stringify(saved[k]));
            } else {
                delete s[k];
            }
        }
    } else {
        // New chat: Reset session keys
        for (const k of SESSION_KEYS) {
            delete s[k];
        }
    }
    
    // Refresh UI
    setTimeout(() => {
        try { window.UIE_refreshStateSaves?.(); } catch (_) {}
        try { updateLayout(); } catch (_) {}
    }, 50);
}

function checkChatIdAndLoad() {
    try {
        const ctx = getContext();
        const cid = ctx ? ctx.chatId : null;
        if (cid !== lastChatId) {
            console.log(`[UIE] Chat changed to: ${cid}`);
            loadChatState(cid);
        } else if (cid) {
            saveCurrentChatState();
        }
    } catch (_) {}
}

// Start the persistence loop
setInterval(checkChatIdAndLoad, 1000);

// --- UI & LAYOUT (Placeholder for your existing logic) ---
export function updateLayout() {
    const s = getSettings();
    const launcher = document.getElementById("uie-launcher");
    if (launcher) {
        launcher.style.display = s?.enabled === false ? "none" : "flex";
    }
}

export function sanitizeSettings() {
    const s = getSettings();
    if (!s.inventory) s.inventory = { items: [] };
    if (!s.character) s.character = { stats: {} };
    if (s.enabled === undefined) s.enabled = true;
}

// --- INITIALIZATION ---
$(document).ready(function() {
    sanitizeSettings();
    updateLayout();
});

// --- EVENT LISTENERS ---
$("body").on("change", "#uie-setting-enable", function() {
    const s = getSettings();
    s.enabled = $(this).prop("checked");
    saveSettings();
    updateLayout();
});
