// --- CORE UTILITIES ---
function getSettings() {
    const EXT_ID = "universal-immersion-engine";
    if (!window.extension_settings) window.extension_settings = {};
    if (!window.extension_settings[EXT_ID]) window.extension_settings[EXT_ID] = {};
    return window.extension_settings[EXT_ID];
}

function saveSettings() {
    if (typeof window.saveSettings === 'function') {
        window.saveSettings();
    }
}

// --- CHAT PERSISTENCE LOGIC ---
let lastChatId = null;
const SESSION_KEYS = [
    "inventory", "character", "currency", "currencySymbol", "currencyRate", 
    "calendar", "map", "social", "diary", "databank", "activities",
    "xp", "hp", "mp", "ap", "maxHp", "maxMp", "maxAp", "maxXp", "life", "image", "worldState"
];

function getChatMetadata() {
    // Access the global chat_metadata object safely
    if (typeof window.chat_metadata !== 'undefined') {
        return window.chat_metadata;
    }
    // Fallback if accessed before chat is loaded
    return {}; 
}

function saveCurrentChatState() {
    if (!lastChatId) return;
    const s = getSettings();
    const meta = getChatMetadata();
    
    if (!meta['uie_state']) {
        meta['uie_state'] = {};
    }
    
    for (const k of SESSION_KEYS) {
        if (s[k] !== undefined) {
            meta['uie_state'][k] = JSON.parse(JSON.stringify(s[k]));
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
    
    const meta = getChatMetadata();
    const saved = meta['uie_state'];
    
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
        try { window.UIE.updateLayout(); } catch (_) {}
    }, 50);
}

function checkChatIdAndLoad() {
    try {
        // Access ST's context safely
        let cid = null;
        if (typeof window.getContext === 'function') {
            const ctx = window.getContext();
            cid = ctx ? ctx.chatId : null;
        } else if (typeof window.chat_metadata !== 'undefined') {
            // Fallback for older ST versions or different loading orders
            cid = window.chat_metadata.chatId;
        }

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

// --- UI & LAYOUT ---
window.UIE = window.UIE || {};

window.UIE.updateLayout = function() {
    const s = getSettings();
    const launcher = document.getElementById("uie-launcher");
    if (launcher) {
        launcher.style.display = s?.enabled === false ? "none" : "flex";
    }
};

window.UIE.sanitizeSettings = function() {
    const s = getSettings();
    if (!s.inventory) s.inventory = { items: [] };
    if (!s.character) s.character = { stats: {} };
    if (s.enabled === undefined) s.enabled = true;
};

// --- INITIALIZATION ---
$(document).ready(function() {
    window.UIE.sanitizeSettings();
    window.UIE.updateLayout();
});

// --- EVENT LISTENERS ---
$("body").on("change", "#uie-setting-enable", function() {
    const s = getSettings();
    s.enabled = $(this).prop("checked");
    saveSettings();
    window.UIE.updateLayout();
});
