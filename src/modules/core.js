import { getContext } from "/scripts/extensions.js";
import { chat_metadata } from '../../../../chat.js';

const EXT_ID = "universal-immersion-engine";

const MIRROR_KEY = "uie_settings_mirror_v1";
const MIRROR_IDB_FLAG_KEY = "uie_settings_mirror_idb_v1";
const MIRROR_IDB_DB = "uie_settings_mirror";
const MIRROR_IDB_STORE = "mirror";
const MIRROR_IDB_ID = "current";
let saveRetryScheduled = false;

let bootstrapSettings = {};
let bootstrapTouched = false;

const INIT_GRACE_MS = 30000;
const INIT_DEADLINE = Date.now() + INIT_GRACE_MS;

let mirrorIdbCache = null;
let mirrorIdbLoadPromise = null;

function applyMirrorToCurrent(data) {
    try {
        if (!isNonEmptyObject(data)) return false;
        if (!window.extension_settings) window.extension_settings = {};
        if (!window.extension_settings[EXT_ID] || typeof window.extension_settings[EXT_ID] !== "object") {
            window.extension_settings[EXT_ID] = {};
        }
        const current = window.extension_settings[EXT_ID];
        try {
            const curAt = Number(current?.__uie_saved_at || 0) || 0;
            const mirAt = Number(data?.__uie_saved_at || 0) || 0;
            if (hasUserData(current) && mirAt > 0 && curAt > 0 && mirAt <= curAt + 250) return false;
            if (hasUserData(current) && mirAt <= 0) return false;
        } catch (_) {
            if (hasUserData(current)) return false;
        }
        for (const k of Object.keys(current)) delete current[k];
        for (const [k, v] of Object.entries(data)) current[k] = v;

        try {
            setTimeout(() => {
                try { window.UIE_refreshStateSaves?.(); } catch (_) {}
                try {
                    const event = new CustomEvent("uie:state_updated", { detail: { mirror: true } });
                    window.dispatchEvent(event);
                } catch (_) {}
                try { updateLayout(); } catch (_) {}
            }, 0);
        } catch (_) {}
        return true;
    } catch (_) {
        return false;
    }
}

function openMirrorDb() {
    return new Promise((resolve, reject) => {
        try {
            const req = indexedDB.open(MIRROR_IDB_DB, 1);
            req.onupgradeneeded = () => {
                try {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(MIRROR_IDB_STORE)) {
                        db.createObjectStore(MIRROR_IDB_STORE, { keyPath: "id" });
                    }
                } catch (_) {}
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    });
}

async function mirrorDbPut(payload) {
    const db = await openMirrorDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(MIRROR_IDB_STORE, "readwrite");
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.objectStore(MIRROR_IDB_STORE).put(payload);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

async function mirrorDbGet() {
    const db = await openMirrorDb();
    return new Promise((resolve, reject) => {
        try {
            const tx = db.transaction(MIRROR_IDB_STORE, "readonly");
            const req = tx.objectStore(MIRROR_IDB_STORE).get(MIRROR_IDB_ID);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        } catch (e) {
            reject(e);
        }
    }).finally(() => {
        try { db.close(); } catch (_) {}
    });
}

function kickMirrorIdbLoad() {
    try {
        if (mirrorIdbLoadPromise) return mirrorIdbLoadPromise;
        mirrorIdbLoadPromise = (async () => {
            try {
                const rec = await mirrorDbGet();
                const data = rec?.data;
                if (isNonEmptyObject(data)) {
                    try {
                        if (!Number(data.__uie_saved_at) && Number(rec?.at || 0)) data.__uie_saved_at = Number(rec.at || 0) || Date.now();
                    } catch (_) {}
                    mirrorIdbCache = { at: Number(rec?.at || 0) || 0, data };
                    try { localStorage.setItem(MIRROR_IDB_FLAG_KEY, String(mirrorIdbCache.at || Date.now())); } catch (_) {}
                    try { applyMirrorToCurrent(mirrorIdbCache.data); } catch (_) {}
                }
            } catch (_) {}
            return mirrorIdbCache;
        })();
        return mirrorIdbLoadPromise;
    } catch (_) {
        return null;
    }
}

try { kickMirrorIdbLoad(); } catch (_) {}

function isPersistentSettingsReady() {
    try {
        const es = window.extension_settings;
        if (!es || typeof es !== "object") return false;
        if (Object.prototype.hasOwnProperty.call(es, EXT_ID)) return true;
        try { if (hasNonEmptyMirror()) return true; } catch (_) {}
        return Date.now() > INIT_DEADLINE;
    } catch (_) {
        return false;
    }
}

function hasUserData(s) {
    try {
        if (!s || typeof s !== "object") return false;
        const invItems = Array.isArray(s?.inventory?.items) ? s.inventory.items.length : 0;
        const hasSavedStates = s.savedStates && typeof s.savedStates === "object\" && Object.keys(s.savedStates).length > 0;
        return invItems > 0 || hasSavedStates;
    } catch (_) {
        return false;
    }
}

function looksEmptySettings(s) {
    try {
        if (!s || typeof s !== "object") return true;
        const keys = Object.keys(s);
        if (!keys.length) return true;
        return false;
    } catch (_) {
        return true;
    }
}

function hasNonEmptyMirror() {
     try {
         const raw = localStorage.getItem(MIRROR_KEY);
         if (!raw) return !!(mirrorIdbCache && isNonEmptyObject(mirrorIdbCache.data));
         let payload = JSON.parse(raw);
         return isNonEmptyObject(payload?.data);
     } catch (_) {
        return false;
     }
}

export function commitStateUpdate(opts = {}) {
    saveSettings();
    if (opts.layout) updateLayout();
    if (opts.emit) {
        const event = new CustomEvent("uie:state_updated", { detail: opts });
        window.dispatchEvent(event);
    }
}

export function failsafeRecover(opts = {}) {
    try { kickMirrorIdbLoad(); } catch (_) {}
    try { updateLayout(); } catch (_) {}
    try { window.UIE_refreshStateSaves?.(); } catch (_) {}
}

export async function ensureChatStateLoaded() {
    if (getContext()) return true;
    for (let i = 0; i < 20; i++) {
        if (getContext()) return true;
        await new Promise(r => setTimeout(r, 100));
    }
    return false;
}

// --- CHAT PERSISTENCE ---
let lastChatId = null;
const SESSION_KEYS = [
    "inventory", "character", "currency", "currencySymbol", "currencyRate", 
    "calendar", "map", "social", "diary", "databank", "activities",
    "xp", "hp", "mp", "ap", "maxHp", "maxMp", "maxAp", "maxXp", "life", "image", "worldState"
];

function saveCurrentChatState() {
    if (!lastChatId) return;
    const s = getSettings();
    if (!chat_metadata['uie_state']) chat_metadata['uie_state'] = {};
    
    for (const k of SESSION_KEYS) {
        if (s[k] !== undefined) {
            chat_metadata['uie_state'][k] = JSON.parse(JSON.stringify(s[k]));
        }
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
    }
    sanitizeSettings();
    updateLayout();
}

function checkChatIdAndLoad() {
    try {
        const ctx = getContext();
        const cid = ctx ? ctx.chatId : null;
        if (cid !== lastChatId) {
            console.log(`[UIE] Chat changed: ${lastChatId} -> ${cid}`);
            loadChatState(cid);
        } else if (cid) {
            saveCurrentChatState();
        }
    } catch (_) {}
}

setInterval(checkChatIdAndLoad, 1000);

export function updateLayout() {
    const s = getSettings();
    // Layout logic (launcher, scales, etc.)
}

export function sanitizeSettings() {
    const s = getSettings();
    if (!s.inventory) s.inventory = { items: [] };
    if (!s.character) s.character = { stats: {} };
    // Add additional sanitization as needed
}

// Global UI and toggle listeners
$("body").on("change", "#uie-setting-enable", function (e) {
    const s = getSettings();
    s.enabled = $(this).prop("checked");
    saveSettings();
});
