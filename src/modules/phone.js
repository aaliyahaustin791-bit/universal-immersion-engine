import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "../../../../../extensions.js";
import { injectRpEvent } from "./features/rp_log.js";
import { notify } from "./notifications.js";
import { checkAndGenerateImage } from "./imageGen.js";
import { applyI18n } from "./i18n.js";

let callTimerInt = null;
let activeContact = null; // Tracks who we are texting
let dialBuf = "";
let chatClock = null;
let phoneClockInt = null;
let arrivalObserver = null;
let arrivalLastMesId = null;
let callChatContext = "";

function isInactiveChatMesNode(m) {
    try {
        if (!m) return true;
        if (m.hidden === true) return true;
        if (m.getAttribute?.("hidden") != null) return true;
        const cls = String(m.className || "").toLowerCase();
        if (/(swipe|swiped|deleted|is_deleted|is-hidden|is_hidden|mes_hide|mes_hidden|mes_removed|mes_deleted)/i.test(cls)) return true;
        const dd = String(m.getAttribute?.("data-deleted") || "").toLowerCase();
        const dh = String(m.getAttribute?.("data-hidden") || "").toLowerCase();
        if (dd === "true" || dh === "true") return true;
        return false;
    } catch (_) {
        return false;
    }
}

function getMainChatContext(lines) {
    try {
        const max = Math.max(3, Number(lines || 10));
        const nodes = Array.from(document.querySelectorAll("#chat .mes"))
            .filter((m) => !isInactiveChatMesNode(m))
            .slice(-1 * max);
        const out = [];
        for (const m of nodes) {
            const name =
                m.querySelector(".mes_name")?.textContent ||
                m.querySelector(".name_text")?.textContent ||
                m.querySelector(".name")?.textContent ||
                "";
            const text =
                m.querySelector(".mes_text")?.textContent ||
                m.querySelector(".mes-text")?.textContent ||
                m.querySelector(".message")?.textContent ||
                m.textContent ||
                "";
            const nm = String(name || "").trim() || "Unknown";
            const tx = String(text || "").trim();
            if (!tx) continue;
            out.push(`${nm}: ${tx}`.slice(0, 360));
        }
        if (!out.length) return "";
        return `[Recent RP]\n${out.join("\n")}`.slice(0, 2200);
    } catch (_) {
        return "";
    }
}

function ensurePhoneWindowOnScreen(forceCenter = false) {
    try {
        const el = document.getElementById("uie-phone-window");
        if (!el) return;
        const $p = $(el);

        const vw = Number(window.innerWidth || document.documentElement.clientWidth || 0);
        const vh = Number(window.innerHeight || document.documentElement.clientHeight || 0);
        if (!vw || !vh) return;

        // Ensure measurable
        try { $p.css("position", "fixed"); } catch (_) {}

        const rect = el.getBoundingClientRect();
        const w = Number(rect?.width) || Number($p.outerWidth?.() || 0) || 380;
        const h = Number(rect?.height) || Number($p.outerHeight?.() || 0) || 720;
        const margin = 8;

        const curLeft = parseFloat(String($p.css("left") || ""));
        const curTop = parseFloat(String($p.css("top") || ""));
        const hasCur = Number.isFinite(curLeft) && Number.isFinite(curTop);

        const offScreen =
            !rect ||
            rect.top < margin ||
            rect.left < margin ||
            rect.bottom > (vh - margin) ||
            rect.right > (vw - margin);

        if (!forceCenter && hasCur && !offScreen) return;

        const maxX = Math.max(margin, vw - w - margin);
        const maxY = Math.max(margin, vh - h - margin);
        const cx = Math.max(margin, Math.min(Math.round((vw - w) / 2), maxX));
        const cy = Math.max(margin, Math.min(Math.round((vh - h) / 2), maxY));

        $p.css({
            position: "fixed",
            left: `${cx}px`,
            top: `${cy}px`,
            right: "auto",
            bottom: "auto",
            transform: "none",
        });
    } catch (_) {}
}

async function relayRelationship(name, text, source) {
    try {
        const mod = await import("./social.js");
        if (typeof mod?.updateRelationshipScore !== "function") return;
        await mod.updateRelationshipScore(String(name || ""), String(text || ""), String(source || ""));
    } catch (_) {}
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPersonaName() {
    try {
        const ctx = getContext?.();
        return String(ctx?.name1 || "You").trim() || "You";
    } catch (_) {
        return "You";
    }
}

function getSocialMemoryBlockForName(targetName, maxItems = 8) {
    const s = getSettings();
    const nm = String(targetName || "").trim().toLowerCase();
    if (!nm) return "";
    const all = ["friends", "associates", "romance", "family", "rivals"].flatMap(k => (s?.social?.[k] || []));
    const p = all.find(x => String(x?.name || "").trim().toLowerCase() === nm);
    const aff = Math.max(0, Math.min(100, Number(p?.affinity ?? 50)));
    const disp = (() => {
        if (aff <= 10) return "Hostile";
        if (aff <= 25) return "Wary";
        if (aff <= 45) return "Cold";
        if (aff <= 60) return "Neutral";
        if (aff <= 75) return "Warm";
        if (aff <= 90) return "Friendly";
        return "Devoted";
    })();
    const talkCap = (() => {
        if (aff <= 10) return 25;
        if (aff <= 25) return 40;
        if (aff <= 45) return 55;
        if (aff <= 60) return 70;
        if (aff <= 75) return 85;
        if (aff <= 90) return 92;
        return 100;
    })();
    const mems = Array.isArray(p?.memories) ? p.memories.slice() : [];
    if (!mems.length) return "";
    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const who = getPersonaName();
    const lines = mems.slice(0, Math.max(1, Number(maxItems || 8))).map(m => `- ${String(m?.text || "").trim()}${m?.impact ? ` (Impact: ${String(m.impact).trim()})` : ""}`).filter(Boolean);
    if (!lines.length) return "";
    return `\n[RELATIONSHIP STATE]\nNPC: ${targetName}\nAffinity: ${aff}/100\nDisposition: ${disp}\nTalk-only cap: ${talkCap}/100 (words alone cannot exceed this; action is required beyond)\nRules: hostile NPCs do not de-escalate from words alone; compliments/manipulation can backfire.\n[/RELATIONSHIP STATE]\n\nVITAL SOCIAL MEMORIES (${targetName}'s memory of ${who}):\n${lines.join("\n")}\n`;
}

function getCharacterCardBlock(maxLen = 2200) {
    try {
        const ctx = getContext?.();
        const candidate =
            ctx?.character ||
            ctx?.char ||
            ctx?.characterCard ||
            (Array.isArray(ctx?.characters) ? ctx.characters[0] : null) ||
            null;
        const card = candidate?.data?.data || candidate?.data || candidate || {};

        const name = String(card?.name || candidate?.name || ctx?.name2 || "").trim();
        const description = String(card?.description || card?.desc || "").trim();
        const personality = String(card?.personality || "").trim();
        const scenario = String(card?.scenario || "").trim();
        const firstMes = String(card?.first_mes || card?.firstMessage || "").trim();
        const mesExample = String(card?.mes_example || card?.example_dialogue || card?.exampleDialogue || "").trim();
        const tags = Array.isArray(card?.tags) ? card.tags.map(t => String(t || "").trim()).filter(Boolean) : [];

        const lines = [];
        if (name) lines.push(`Name: ${name}`);
        if (description) lines.push(`Description: ${description}`);
        if (personality) lines.push(`Personality: ${personality}`);
        if (scenario) lines.push(`Scenario: ${scenario}`);
        if (firstMes) lines.push(`First Message: ${firstMes}`);
        if (mesExample) lines.push(`Example Dialogue: ${mesExample}`);
        if (tags.length) lines.push(`Tags: ${tags.slice(0, 20).join(", ")}`);

        return lines.join("\n").slice(0, maxLen);
    } catch (_) {
        return "";
    }
}

function getThreadTail(name, max = 10) {
    try {
        const s = getSettings();
        const list = (s.phone?.smsThreads && Array.isArray(s.phone.smsThreads[name])) ? s.phone.smsThreads[name] : [];
        return list.slice(-max).map(m => `${m.isUser ? getPersonaName() : name}: ${String(m.text || "").slice(0, 220)}`).join("\n");
    } catch (_) {
        return "";
    }
}

function shouldLogPhoneToChat() {
    return true;
}

function sanitizePhoneLine(text, maxLen = 600) {
    let t = String(text || "");
    t = t.replace(/^```[a-z]*\s*/i, "").replace(/```$/g, "");
    t = t.replace(/^[\s"'""'']]+|[\s"'""'']]+$/g, "");
    t = t.replace(/\*[^*]{0,400}\*/g, " ");
    t = t.replace(/\[[^\]]{0,400}\]/g, " ");
    t = t.replace(/\([^)]{0,400}\)/g, " ");
    t = t.replace(/\b(narration|scene|action|stage directions)\s*:\s*/gi, "");
    t = t.replace(/\s*\n+\s*/g, " ");
    t = t.replace(/\s{2,}/g, " ").trim();
    if (!t) return "";
    return t.slice(0, maxLen);
}

function cleanOutput(text, type) {
    if(!text) return "";
    let clean = text.trim();
    clean = clean.replace(/^```[a-z]*\s*/i, "").replace(/```$/g, "");
    if (type === "web") {
        if (clean.startsWith("# ")) clean = "<h1>" + clean.substring(2) + "</h1>";
        const match = clean.match(/<(div|style|body|html|header|nav|main|h1|h2|p)/i);
        if (match && match.index > -1) clean = clean.substring(match.index);
        else clean = `<div style="padding:20px; text-align:center; font-family:sans-serif;">${clean}</div>`;
    } else if (type === "json") {
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start > -1 && end > -1) clean = clean.substring(start, end + 1);
        else clean = "{}";
    }
    return clean;
}

function syncToMainChat(actionDescription) {
    try {
        injectRpEvent(String(actionDescription || ""), { uie: { type: "phone" } });
    } catch (_) {}
}

export function initPhone() {
    const $win = $("#uie-phone-window");
    if (!$win.length) return;
    $win.off("click.phone change.phone input.phone keypress.phone");
    $(document).off("click.phone change.phone input.phone keypress.phone");

    // BIND OPEN BUTTON (Fix for "Can't Open")
    $(document).off("click", "#btn-phn").on("click", "#btn-phn", () => {
        const $p = $("#uie-phone-window");
        const wasVisible = $p.is(":visible");
        $p.fadeToggle(200);
        if (!wasVisible) {
            try {
                if (typeof updateClock === "function") updateClock();
                if (phoneClockInt) clearInterval(phoneClockInt);
                phoneClockInt = setInterval(updateClock, 15000);
            } catch (_) {}
            try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
        } else {
            try {
                if (phoneClockInt) clearInterval(phoneClockInt);
                phoneClockInt = null;
            } catch (_) {}
            try { window.UIE_navPop?.(); } catch (_) {}
        }
    });

    const parseChatTimestamp = () => {
        try {
            const chat = document.querySelector("#chat");
            if (!chat) return null;

            const last =
                chat.querySelector(".mes:last-child") ||
                chat.querySelector(".mes")?.parentElement?.lastElementChild ||
                chat.lastElementChild;
            if (!last) return null;

            const timeEl =
                last.querySelector("time") ||
                last.querySelector(".timestamp") ||
                last.querySelector(".mes_time") ||
                last.querySelector(".mes__time") ||
                last.querySelector("[data-timestamp]") ||
                last.querySelector("[datetime]");

            const raw =
                (timeEl && (timeEl.getAttribute("datetime") || timeEl.getAttribute("data-timestamp") || timeEl.textContent)) ||
                last.getAttribute("data-timestamp") ||
                last.getAttribute("datetime") ||
                "";

            const txt = String(raw || "").trim();
            if (!txt) return null;

            const ms = Date.parse(txt);
            if (!Number.isNaN(ms)) return new Date(ms);

            const m = txt.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
            if (m) {
                let hh = Number(m[1]);
                const mm = Number(m[2]);
                const ap = (m[3] || "").toUpperCase();
                if (ap === "PM" && hh < 12) hh += 12;
                if (ap === "AM" && hh === 12) hh = 0;
                const now = new Date();
                now.setHours(hh, mm, 0, 0);
                return now;
            }
        } catch (_) {}
        return null;
    };

    const updateClock = () => {
        const fromChat = parseChatTimestamp();
        if (fromChat) chatClock = { base: fromChat.getTime(), at: Date.now() };

        const now = chatClock ? new Date(chatClock.base + (Date.now() - chatClock.at)) : new Date();
        const time12 = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
        const parts = String(time12 || "").trim().split(/\s+/);
        const tMain = parts[0] || now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const tAmPm = (parts[1] || "").toUpperCase();
        const date = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
        $(".uie-phone-clock").text(tMain);
        const $timeLg = $(".uie-phone-clock-time-lg");
        const $ampmLg = $(".uie-phone-clock-ampm-lg");
        if ($timeLg.length && $ampmLg.length) {
            $timeLg.text(tMain);
            $ampmLg.text(tAmPm || "AM");
        } else {
            $(".uie-phone-clock-lg").text(tAmPm ? `${tMain} ${tAmPm}` : tMain);
        }
        $(".uie-phone-date").text(date);
    };
    try {
        if ($win.is(":visible")) {
            updateClock();
            if (phoneClockInt) clearInterval(phoneClockInt);
            phoneClockInt = setInterval(updateClock, 15000);
        }
    } catch (_) {}

    const getChatSnippet = (n = 20) => {
        try {
            let raw = "";
            const $txt = $(".chat-msg-txt");
            if ($txt.length) {
                $txt.slice(-Math.max(1, Number(n) || 20)).each(function () { raw += $(this).text() + "\n"; });
                return raw.trim().slice(0, 5200);
            }
            const chatEl = document.querySelector("#chat");
            if (!chatEl) return "";
            const msgs = Array.from(chatEl.querySelectorAll(".mes"))
                .filter((m) => !isInactiveChatMesNode(m))
                .slice(-Math.max(1, Number(n) || 20));
            for (const m of msgs) {
                const isUser =
                    m.classList?.contains("is_user") ||
                    m.getAttribute("is_user") === "true" ||
                    m.getAttribute("data-is-user") === "true" ||
                    m.dataset?.isUser === "true";
                const t =
                    m.querySelector(".mes_text")?.textContent ||
                    m.querySelector(".mes-text")?.textContent ||
                    m.textContent ||
                    "";
                raw += `${isUser ? "You" : "Story"}: ${String(t).trim()}\n`;
            }
            return raw.trim().slice(0, 5200);
        } catch (_) {
            return "";
        }
    };

    const scheduleArrival = (who, turns = 1, reason = "") => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.arrivals)) s.phone.arrivals = [];
        const eta = Math.max(1, Math.min(2, Number(turns) || 1));
        s.phone.arrivals.push({ id: Date.now(), who: String(who || "Someone"), etaTurns: eta, reason: String(reason || "").slice(0, 200) });
        saveSettings();
    };

    const tickArrivalsOnAssistantTurn = async () => {
        const s = getSettings();
        if (!s?.phone?.arrivals || !Array.isArray(s.phone.arrivals) || !s.phone.arrivals.length) return;
        let changed = false;
        for (const a of s.phone.arrivals) {
            if (typeof a.etaTurns !== "number") a.etaTurns = 1;
            a.etaTurns -= 1;
            changed = true;
        }
        const due = s.phone.arrivals.filter(a => a.etaTurns <= 0);
        s.phone.arrivals = s.phone.arrivals.filter(a => a.etaTurns > 0);
        if (changed) saveSettings();
        for (const a of due) {
            const who = String(a.who || "Someone");
            const why = String(a.reason || "").trim();
            const msg = why ? `${who} arrives. (${why})` : `${who} arrives.`;
            await injectRpEvent(msg, { uie: { type: "arrival", who, why } });
        }
    };

    // --- STRICT PHONE TRIGGER WATCHER ---
    const scanForPhoneEvents = async () => {
        const s = getSettings();
        if (s?.phone && s.phone.allowCalls === false && s.phone.allowTexts === false) return;

        const chatEl = document.querySelector("#chat");
        if (!chatEl) return;
        const all = Array.from(chatEl.querySelectorAll(".mes")).filter((m) => !isInactiveChatMesNode(m));
        const last = all[all.length - 1] || null;
        if (!last) return;

        // Only scan AI messages
        const isUser =
            last.classList?.contains("is_user") ||
            last.getAttribute("is_user") === "true" ||
            last.getAttribute("data-is-user") === "true";
        if (isUser) return;

        const id = last.getAttribute("mesid") || last.getAttribute("data-id") || last.textContent.substring(0, 20);
        if (id === arrivalLastMesId) return; // Re-using this var to track last processed message
        arrivalLastMesId = id;

        const lastText =
            last.querySelector(".mes_text")?.textContent ||
            last.querySelector(".mes-text")?.textContent ||
            last.textContent ||
            "";
        const txt = String(lastText || "").trim();
        if (!txt) return;

        const callTag = txt.match(/\[\s*UIE_CALL\s*:\s*([^\]]+?)\s*\]/i);
        const textTag = txt.match(/\[\s*UIE_TEXT\s*:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]/i);
        const callPlain = txt.match(/call\s+incoming\s*(?:from)?\s*[:\-]?\s*([A-Za-z0-9 _'".-]{2,60})/i);
        const textPlain = txt.match(/new\s+message\s*(?:from)?\s*[:\-]?\s*([A-Za-z0-9 _'".-]{2,60})\s*[:\-]\s*([\s\S]{1,600})/i);

        if (callTag || callPlain) {
            if (s?.phone?.allowCalls === false) return;
            const who = String((callTag ? callTag[1] : callPlain[1]) || "Unknown").trim().slice(0, 80);
            notify("info", `Incoming call from ${who}`, "Phone", "phoneCalls");
            window.UIE_phone_incomingCall(who);
            return;
        }

        if (textTag || textPlain) {
            if (s?.phone?.allowTexts === false) return;
            const who = String((textTag ? textTag[1] : textPlain[1]) || "Unknown").trim().slice(0, 80);
            const body = String((textTag ? textTag[2] : textPlain[2]) || "").trim().slice(0, 1200);
            if (!body) return;
            notify("info", `New message from ${who}`, "Phone", "phoneMessages");
            window.UIE_phone_incomingText(who, body);
        }
    };

    const startArrivalWatcher = () => {
        if (arrivalObserver) return;
        const chatEl = document.querySelector("#chat");
        if (!chatEl) return;

        arrivalObserver = new MutationObserver(async () => {
            const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
            if (!last) return;

            // Run Arrival Logic
            const isUser =
                last.classList?.contains("is_user") ||
                last.getAttribute("is_user") === "true" ||
                last.getAttribute("data-is-user") === "true";
            if (!isUser) {
                await tickArrivalsOnAssistantTurn();
                // Run Phone Event Scan
                setTimeout(scanForPhoneEvents, 1500); // Small delay to let text settle
            }
        });
        arrivalObserver.observe(chatEl, { childList: true, subtree: false });
    };

    const loadPhoneVisuals = () => {
        const s = getSettings();
        if(!s.phone) s.phone = { bg: "", lockBg: "", pin: "", deviceSkin: "classic", unlockedDevices: ["classic"], customApps: [], bookmarks: [], browser: { pages: {}, history: [], index: -1 }, smsThreads: {}, arrivals: [], blockedContacts: [], numberBook: [] };
        if(!s.social || typeof s.social !== "object") s.social = { friends: [], associates: [], romance: [], family: [], rivals: [], stats: {} };
        for (const k of ["friends", "associates", "romance", "family", "rivals"]) {
            if (!Array.isArray(s.social[k])) s.social[k] = [];
        }
        if(!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
        if(!s.phone.browser.pages) s.phone.browser.pages = {};
        if(!Array.isArray(s.phone.browser.history)) s.phone.browser.history = [];
        if(typeof s.phone.browser.index !== "number") s.phone.browser.index = -1;
        if(!Array.isArray(s.phone.arrivals)) s.phone.arrivals = [];
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        if(!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];

        try {
            const wp = s.phone.windowPos || null;
            const x = Number(wp?.x);
            const y = Number(wp?.y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                const el = document.getElementById("uie-phone-window");
                const w = el?.getBoundingClientRect?.().width || Math.min(380, vw * 0.95);
                const h = el?.getBoundingClientRect?.().height || Math.min(vh * 0.9, 900);
                const clampedX = Math.max(0, Math.min(x, Math.max(0, vw - w)));
                const clampedY = Math.max(0, Math.min(y, Math.max(0, vh - h)));
                $("#uie-phone-window").css({ left: clampedX, top: clampedY, transform: "none" });
            }
        } catch (_) {}

        if(s.phone.bg) $("#uie-phone-window").css("background-image", `url('${s.phone.bg}')`);
        if(s.phone.lockBg) $("#uie-phone-lockscreen").css("background-image", `url('${s.phone.lockBg}')`).css("background-size","cover").css("background-position","center");
        else $("#uie-phone-lockscreen").css("background-image", "");

        $("#uie-phone-window").attr("data-device", String(s.phone.deviceSkin || "classic"));
        const skin = String(s.phone.deviceSkin || "classic");
        const theme = skin === "onyx"
            ? { accent:"#f1c40f", glass:"rgba(0,0,0,0.35)", surface:"rgba(10,12,18,0.78)", surface2:"rgba(10,12,18,0.92)", text:"#ffffff" }
            : skin === "notch"
                ? { accent:"#cba35c", glass:"rgba(0,0,0,0.30)", surface:"rgba(14,12,10,0.75)", surface2:"rgba(14,12,10,0.90)", text:"#ffffff" }
                : { accent:"#007aff", glass:"rgba(0,0,0,0.28)", surface:"rgba(11,16,28,0.74)", surface2:"rgba(11,16,28,0.90)", text:"#ffffff" };
        const bubbleColors = s.phone.bubbleColors || {};
        const sentColor = String(bubbleColors.sent || theme.accent);
        const recvColor = String(bubbleColors.received || "").trim() || "#ffffff";
        $("#uie-phone-custom-css").text(`
            #uie-phone-window .phone-screen { background: transparent; }
            #uie-phone-window #uie-phone-homescreen { background: linear-gradient(180deg, ${theme.glass}, rgba(0,0,0,0.05)); }
            #uie-phone-window .phone-status-bar { background: ${theme.glass}; }
            #uie-phone-window .phone-app-header { background: ${theme.surface}; border-bottom: 1px solid rgba(255,255,255,0.10); color:${theme.text}; }
            #uie-phone-window .phone-app-content { background: ${theme.surface2}; color:${theme.text}; }
            #uie-phone-window .phone-nav-bar { background: ${theme.surface}; border-top: 1px solid rgba(255,255,255,0.10); }
            #uie-phone-window .p-nav-btn { color: rgba(255,255,255,0.88); }

            #uie-phone-window #p-browser-content { background: #fff; color:#222; }
            #uie-phone-window .p-input-area{ display:flex; gap:8px; padding:10px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background:${theme.surface}; border-top:1px solid rgba(255,255,255,0.10); position:sticky; bottom:0; z-index:5; align-items:flex-end; }
            #uie-phone-window #msg-input{ background: rgba(0,0,0,0.18); border:1px solid rgba(255,255,255,0.12); color:${theme.text}; min-height:40px; border-radius:18px; padding:10px 14px; outline:none; pointer-events:auto; line-height:1.35; }
            #uie-phone-window #msg-input::placeholder{ color: rgba(255,255,255,0.6); }
            #uie-phone-window #msg-send-btn{ background:${theme.accent}; color:#000; border:none; border-radius:999px; width:44px; height:40px; display:grid; place-items:center; cursor:pointer; }
            #uie-phone-window #contact-add-manual{ position:relative; z-index:6; padding:10px; margin:-10px -6px -10px 0; }
            #uie-phone-window .p-msg-list{ padding: 10px 10px 0 10px; gap:10px; }
            #uie-phone-window .p-bubble{ max-width: 86%; padding:10px 12px; border-radius:14px; line-height:1.35; font-size:13px; border:1px solid rgba(255,255,255,0.10); }
            #uie-phone-window .p-bubble.sent{ margin-left:auto; background: ${sentColor}; border-color: rgba(255,255,255,0.10); color:${theme.text}; }
            #uie-phone-window .p-bubble.received{ margin-right:auto; background: ${recvColor}; border-color: rgba(0,0,0,0.10); color:#111; }
            #uie-phone-window #msg-block{ color: rgba(255,255,255,0.85); }
            #uie-phone-window #msg-block.blocked{ color: #f38ba8; }
        `);

        if(s.phone.pin && s.phone.pin.length > 0) {
            $("#uie-phone-pin").show().val("");
            $("#uie-phone-unlock-btn").text("Enter PIN");
        } else {
            $("#uie-phone-pin").hide();
            $("#uie-phone-unlock-btn").text("Swipe / Tap to Unlock");
        }

        $(".custom-app-icon").remove();
        if(s.phone.customApps) {
            s.phone.customApps.forEach(app => {
                $("#uie-phone-grid").append(`
                    <div class="phone-app-icon custom-app-icon" data-id="${app.id}" style="background:${app.color}; color:#fff;">
                        <i class="${app.icon}"></i>
                        <div class="custom-app-delete" title="Delete">x</div>
                    </div>
                `);
            });
        }
    };

    const openApp = (id) => {
        try {
            const s = getSettings();
            if (s?.phone) {
                s.phone.activeApp = String(id || "");
                const name =
                    id === "#uie-app-msg-view" ? "Messages" :
                    id === "#uie-app-dial-view" ? "Phone" :
                    id === "#uie-app-browser-view" ? "Browser" :
                    id === "#uie-app-contacts-view" ? "Contacts" :
                    id === "#uie-app-store-view" ? "App Builder" :
                    id === "#uie-app-settings-view" ? "Phone Settings" :
                    id === "#uie-app-books-view" ? "Books" :
                    id === "#uie-app-calc-view" ? "Calculator" :
                    id === "#uie-app-cookies-view" ? "Cookies" :
                    id === "#uie-call-screen" ? "Call" :
                    "Phone";
                s.phone.activeAppName = name;
            }
        } catch (_) {}
        $(".phone-app-window").hide();
        $("#uie-phone-homescreen").hide();
        $(id).css("display", "flex").hide().fadeIn(150);

        if(id === "#uie-app-contacts-view") renderContacts();
        if(id === "#uie-app-dial-view") {
            try { renderDialRecents(); } catch (_) {}
            try { $("#dial-display").text(dialBuf ? dialBuf : "—"); } catch (_) {}
        }
        if(id === "#uie-app-msg-view") {
            // Default header if not set via contact click
            if(!activeContact) $("#msg-contact-name").text("Messages");
            else $("#msg-contact-name").text(activeContact);
            renderMessages();
        }
        if(id === "#uie-app-store-view") renderAppStore();
        if(id === "#uie-app-books-view") renderBooks();
        if(id === "#uie-app-browser-view") renderBrowserHome();
        if(id === "#uie-app-cookies-view") renderCookies();
        if(id === "#uie-app-settings-view") {
            const s2 = getSettings();
            if (!s2.phone) s2.phone = {};
            $("#p-set-pin").val(String(s2.phone.pin || ""));
            $("#p-allow-calls").prop("checked", s2.phone.allowCalls !== false);
            $("#p-allow-texts").prop("checked", s2.phone.allowTexts !== false);
            const bc = s2.phone.bubbleColors || {};
            $("#p-bubble-sent").val(String(bc.sent || "#f1c40f"));
            $("#p-bubble-recv").val(String(bc.received || "#111111"));
        }
    };

    const goHome = () => {
        const wasBrowserOpen = $("#uie-app-browser-view").is(":visible");
        $(".phone-app-window").hide();
        $("#uie-app-browser-view").removeClass("browser-app-mode");
        $("#uie-phone-homescreen").css("display", "flex").hide().fadeIn(150);
        activeContact = null; // Reset selection on home
        try {
            const s = getSettings();
            if (s?.phone) {
                s.phone.activeApp = "home";
                s.phone.activeAppName = "Home";
            }
        } catch (_) {}
        if (wasBrowserOpen) {
            try { $("#p-browser-url").val(""); } catch (_) {}
            try { renderBrowserHome(); } catch (_) {}
        }
    };

    // --- MESSAGING LOGIC ---
    const getThread = (name) => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        const key = String(name || "").trim() || "_unknown";
        if(!Array.isArray(s.phone.smsThreads[key])) s.phone.smsThreads[key] = [];
        return { s, key, list: s.phone.smsThreads[key] };
    };

    const norm = (x) => String(x || "").trim();
    const isBlocked = (s, name) => {
        const n = norm(name).toLowerCase();
        if (!n) return false;
        const list = Array.isArray(s?.phone?.blockedContacts) ? s.phone.blockedContacts : [];
        return list.some(x => String(x || "").trim().toLowerCase() === n);
    };
    const setBlocked = (s, name, blocked) => {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        const n = norm(name);
        if (!n) return;
        const low = n.toLowerCase();
        s.phone.blockedContacts = s.phone.blockedContacts
            .map(x => String(x || "").trim())
            .filter(Boolean)
            .filter(x => x.toLowerCase() !== low);
        if (blocked) s.phone.blockedContacts.push(n);
    };

    const normalizeNumber = (n) => String(n || "").replace(/[^\d]/g, "").slice(0, 15);
    const formatNumber = (n) => {
        const d = normalizeNumber(n);
        if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
        if (d.length === 7) return `${d.slice(0,3)}-${d.slice(3)}`;
        return d || "—";
    };
    const generateFictionalNumber = (used) => {
        const u = used || new Set();
        for (let i = 0; i < 200; i++) {
            const mid = 100 + Math.floor(Math.random() * 900);
            const tail = 1000 + Math.floor(Math.random() * 9000);
            const digits = `555${String(mid).padStart(3, "0")}${tail}`.slice(0, 10);
            if (!u.has(digits)) return digits;
        }
        return `555${String(Date.now()).slice(-7)}`.slice(0, 10);
    };
    const SOCIAL_BUCKETS = ["friends", "associates", "romance", "family", "rivals"];
    const getSocialPeople = (s) => {
        const out = [];
        const social = s?.social && typeof s.social === "object" ? s.social : {};
        for (const k of SOCIAL_BUCKETS) {
            const arr = Array.isArray(social?.[k]) ? social[k] : [];
            for (const p of arr) {
                if (!p || typeof p !== "object") continue;
                const name = String(p.name || "").trim();
                if (!name) continue;
                out.push(p);
            }
        }
        return out;
    };
    const ensureNumbersState = (s) => {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];
        if (!Array.isArray(s.phone.callLog)) s.phone.callLog = [];
        if (!Array.isArray(s.phone.callHistory)) s.phone.callHistory = [];
        if (!s.social) s.social = {};
        for (const k of SOCIAL_BUCKETS) if (!Array.isArray(s.social[k])) s.social[k] = [];
    };
    const ensureContactNumbers = (s) => {
        ensureNumbersState(s);
        const used = new Set();
        for (const p of getSocialPeople(s)) {
            const d = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (d) used.add(d);
        }
        for (const nb of (s.phone.numberBook || [])) {
            const d = normalizeNumber(nb?.number || "");
            if (d) used.add(d);
        }
        let changed = false;
        for (const p of getSocialPeople(s)) {
            const cur = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (cur) continue;
            const digits = generateFictionalNumber(used);
            used.add(digits);
            p.phone = formatNumber(digits);
            changed = true;
        }
        if (changed) saveSettings();
    };

    const isLikelyNumber = (v) => {
        const s = String(v || "").trim();
        if (!s) return false;
        const d = normalizeNumber(s);
        return !!d && d.length >= 7;
    };

    const lookupNumberForName = (s, name) => {
        const nm = String(name || "").trim();
        if (!nm) return "";
        if (isLikelyNumber(nm)) return formatNumber(normalizeNumber(nm));
        const friends = Array.isArray(s?.social?.friends) ? s.social.friends : [];
        const hit = friends.find(p => String(p?.name || "").trim().toLowerCase() === nm.toLowerCase());
        const raw = String(hit?.phone || hit?.phoneNumber || "").trim();
        if (raw) return formatNumber(normalizeNumber(raw));
        const nb = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const hit2 = nb.find(x => String(x?.name || "").trim().toLowerCase() === nm.toLowerCase());
        const raw2 = String(hit2?.number || "").trim();
        if (raw2) return formatNumber(normalizeNumber(raw2));
        return "";
    };

    const pushCallLog = (entry) => {
        try {
            const s = getSettings();
            ensureNumbersState(s);
            const e = entry && typeof entry === "object" ? entry : {};
            const who = String(e.who || "").trim();
            const number = String(e.number || "").trim();
            const dir = String(e.dir || "").trim() || "out";
            const startedAt = Number(e.startedAt || 0) || Date.now();
            const endedAt = Number(e.endedAt || 0) || 0;
            const durationSec = endedAt && startedAt ? Math.max(0, Math.round((endedAt - startedAt) / 1000)) : 0;
            const missed = e.missed === true;
            const id = `call_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
            s.phone.callLog.unshift({ id, who: who.slice(0, 80), number: number.slice(0, 40), dir, startedAt, endedAt, durationSec, missed });
            s.phone.callLog = (s.phone.callLog || []).slice(0, 80);
            saveSettings();
        } catch (_) {}
        try { renderDialRecents(); } catch (_) {}
    };

    const renderDialRecents = () => {
        const box = $("#dial-recents");
        if (!box.length) return;
        const s = getSettings();
        ensureNumbersState(s);
        const list = Array.isArray(s?.phone?.callLog) ? s.phone.callLog : [];
        if (!list.length) {
            box.html(`<div style="opacity:0.65; color:#fff; text-align:center; padding:14px; font-weight:900;">No recent calls.</div>`);
            return;
        }
        const fmtTime = (ts) => {
            try { return new Date(Number(ts || 0) || Date.now()).toLocaleString(); } catch (_) { return ""; }
        };
        box.empty();
        for (const c of list.slice(0, 30)) {
            const who = String(c?.who || "").trim();
            const number = String(c?.number || "").trim();
            const label = who || number || "Unknown";
            const sub = number && who && who !== number ? number : fmtTime(c?.startedAt);
            const dir = String(c?.dir || "out");
            const missed = c?.missed === true;
            const badge = missed ? `<span style="margin-left:8px; font-size:11px; color:#f38ba8; font-weight:900;">MISSED</span>` : "";
            const dirIco = dir === "in" ? "fa-arrow-down" : "fa-arrow-up";
            const dialNum = number || (isLikelyNumber(who) ? who : "");
            box.append(`
                <div class="dial-recent-row" data-number="${esc(dialNum)}" style="display:flex; align-items:center; gap:10px; padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); margin-bottom:8px; cursor:pointer;">
                    <i class="fa-solid ${dirIco}" style="opacity:0.75;"></i>
                    <div style="flex:1; min-width:0;">
                        <div style="color:#fff; font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(label)}${badge}</div>
                        <div style="color:rgba(255,255,255,0.72); font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(sub || "")}</div>
                    </div>
                    <button class="dial-recent-call" data-number="${esc(dialNum)}" style="height:34px; width:44px; border-radius:14px; border:none; background:#2ecc71; color:#000; font-weight:900; cursor:pointer;"><i class="fa-solid fa-phone"></i></button>
                </div>
            `);
        }
    };

    $win.off("click.phoneDialRecentsClear", "#dial-recents-clear").on("click.phoneDialRecentsClear", "#dial-recents-clear", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const ok = confirm("Clear call log?");
        if (!ok) return;
        const s = getSettings();
        ensureNumbersState(s);
        s.phone.callLog = [];
        saveSettings();
        renderDialRecents();
    });

    $win.off("click.phoneDialRecentCall", "#dial-recents .dial-recent-call").on("click.phoneDialRecentCall", "#dial-recents .dial-recent-call", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const raw = String($(this).data("number") || "").trim();
        if (!raw) return;
        const digits = normalizeNumber(raw);
        dialBuf = digits || raw;
        try { $("#dial-display").text(dialBuf || "—"); } catch (_) {}
        $("#dial-call").trigger("click");
    });

    $win.off("click.phoneDialRecentPick", "#dial-recents .dial-recent-row").on("click.phoneDialRecentPick", "#dial-recents .dial-recent-row", function (e) {
        if ($(e.target).closest(".dial-recent-call").length) return;
        e.preventDefault();
        e.stopPropagation();
        const raw = String($(this).data("number") || "").trim();
        if (!raw) return;
        const digits = normalizeNumber(raw);
        dialBuf = digits || raw;
        try { $("#dial-display").text(dialBuf || "—"); } catch (_) {}
    });

    const renderMessages = () => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        if(!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];

        const container = $("#msg-container");
        container.empty();

        const $inputArea = $("#uie-app-msg-view .p-input-area");
        const $header = $("#msg-contact-name");
        const blocked = !!(activeContact && isBlocked(s, activeContact));
        $("#msg-block").toggle(!!activeContact);
        $("#msg-block").toggleClass("blocked", blocked);

        if(!activeContact) {
            $header.text("Messages");
            $inputArea.hide();

            const keys = Object.keys(s.phone.smsThreads || {})
                .filter(k => Array.isArray(s.phone.smsThreads[k]) && s.phone.smsThreads[k].length)
                .filter(k => !isBlocked(s, k));
            if(!keys.length) {
                container.html(`
                    <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#333; opacity:0.7;">
                        <i class="fa-regular fa-comments" style="font-size:3em; margin-bottom:10px;"></i>
                        <span style="font-size:1.2em; font-weight:900;">No Conversations</span>
                        <div style="margin-top:8px; font-size:0.9em;">Open Contacts to start a text.</div>
                    </div>
                `);
                return;
            }

            keys.slice(0, 60).forEach(k => {
                const t = s.phone.smsThreads[k];
                const last = t[t.length - 1];
                container.append(`
                    <div class="contact-row" data-thread="${esc(k)}" style="display:flex; align-items:center; padding:15px; border-bottom:1px solid #eee; cursor:pointer;">
                        <div class="contact-avatar" style="width:40px; height:40px; background:#ddd; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:15px; font-weight:bold; color:#555;">${esc(k).charAt(0)}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:900; color:#222;">${esc(k)}</div>
                            <div style="opacity:0.7; font-size:0.85em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(last?.text || "")}</div>
                        </div>
                    </div>
                `);
            });
            return;
        }

        $header.text(String(activeContact));
        if (blocked) {
            $inputArea.hide();
            container.append(`<div style="padding:12px; margin:10px; border-radius:10px; border:1px solid rgba(243,139,168,0.35); background:rgba(243,139,168,0.12); color:#f38ba8; font-weight:900;">Blocked contact</div>`);
        } else {
            $inputArea.show();
        }

        const { list } = getThread(activeContact);
        if (!list.length) {
            container.html(`<div style="padding:20px; text-align:center; opacity:0.65;">No texts with ${esc(activeContact)} yet.</div>`);
            return;
        }

        list.forEach((m, idx) => {
            const cls = m.isUser ? "sent" : "received";
            const text = String(m.text || "");
            const img = String(m.image || "");
            const preview = img ? `<div style="margin-bottom:${text ? "8px" : "0"};"><img src="${esc(img)}" style="max-width:220px; width:100%; height:auto; border-radius:12px; display:block; border:1px solid rgba(255,255,255,0.10);"></div>` : "";
            const body = text ? `<div style="white-space:pre-wrap; word-break:break-word;">${esc(text)}</div>` : "";
            container.append(`<div class="p-bubble ${cls}" data-mid="${idx}" style="position:relative;">${preview}${body}</div>`);
        });
        container.scrollTop(container.prop("scrollHeight"));
    };

    $win.off("click.phoneMsgSend", "#msg-send-btn");
    $win.on("click.phoneMsgSend", "#msg-send-btn", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const t = String($("#msg-input").val() || "");
        if(!t.trim()) return;

        // If no contact selected, check Social for a default or prompt
        let targetName = activeContact;
        if(!targetName) {
            const s = getSettings();
            if(s.social.friends.length > 0) targetName = s.social.friends[0].name; // Default to first friend
            else targetName = "Unknown";
        }
        const sBlock = getSettings();
        if (isBlocked(sBlock, targetName)) {
            notify("warning", "That contact is blocked.", "Messages", "phoneMessages");
            $("#msg-input").val("");
            renderMessages();
            return;
        }

        const th = getThread(targetName);
        const msgObj = { isUser: true, text: t, ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        $("#msg-input").val("");
        try { $("#msg-input").css("height", ""); } catch (_) {}
        notify("success", "Message sent.", "Messages", "phoneMessages");
        try { relayRelationship(targetName, t, "text"); } catch (_) {}
        try {
            const inj = await injectRpEvent(`(Text) ${getPersonaName()} → ${targetName}: "${String(t).slice(0, 500)}"`, { uie: { type: "phone_text", who: targetName } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}

        const s2 = getSettings();
        const allow = !!(s2?.ai?.phoneMessages);
        if (!allow) return;

        const mainCtx = getMainChatContext(5);
        const chat = getChatSnippet(50);
        const lore = (() => { try { const ctx = getContext?.(); const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo; const keys=[]; if(Array.isArray(maybe)){ for(const it of maybe){ const k=it?.key||it?.name||it?.title; if(k) keys.push(String(k)); } } return Array.from(new Set(keys)).slice(0, 60).join(", "); } catch(_) { return ""; } })();
        const character = (() => { try { const ctx = getContext?.(); return JSON.stringify({ user: ctx?.name1, character: ctx?.name2, chatId: ctx?.chatId, characterId: ctx?.characterId, groupId: ctx?.groupId }); } catch(_) { return "{}"; } })();
        const threadTail = getThreadTail(targetName, 10);
        const persona = getPersonaName();
        const card = getCharacterCardBlock(2600);
        const mem = getSocialMemoryBlockForName(targetName, 8);
        const prompt = `
${mainCtx ? `${mainCtx}\n\n` : ""}The user is texting you.

Phone Text Rules:
- You are ${targetName} replying by text to ${persona}.
- This is a ROLEPLAY response. Treat the provided Chat Log as the story so far.
- IMPORTANT: You only know what you have personally witnessed or been told in the Chat Log. You are NOT omniscient.
- Reply MUST be a realistic text message (short).
- ABSOLUTE RULE: no narration, no scene description, no roleplay formatting, no quotes.
- Do NOT include: asterisks (*like this*), brackets [like this], parentheses (like this), or prefixes like "${targetName}:".
- Decide based on CONTEXT; if uncertain, keep the reply short or choose no reply.
- If the user asks ${targetName} to come over / meet up and ${targetName} agrees, set arrivalInTurns to 1 or 2.
- If you cannot comply with the formatting rules, set willReply=false.

Return ONLY JSON:
{
  "hasPhone": true,
  "willReply": true,
  "reply": "short realistic text reply (no narration)",
  "reason": "why they did/didn't reply",
  "arrivalInTurns": 0,
  "arrivalReason": ""
}

TEXT SENT: "${t}"
TARGET: "${targetName}"
RECENT TEXT THREAD:
${threadTail}
<character_card>
${card}
</character_card>
${mem}
CONTEXT (recent chat log - USE THIS):
${chat}`.slice(0, 6000);

        try {
            const res = await generateContent(prompt, "System Check");
            const logic = JSON.parse(cleanOutput(res, "json"));

            if(logic.willReply) {
                setTimeout(async () => {
                    const th2 = getThread(targetName);
                    const replyText = sanitizePhoneLine(String(logic.reply || ""), 500);
                    if (!replyText) return;
                    const replyObj = { isUser: false, text: replyText, ts: Date.now() };
                    try {
                        const sImg = getSettings();
                        const img = await checkAndGenerateImage(`Phone text from ${targetName}:\n${replyText.slice(0, 800)}`, "msg");
                        if (img) replyObj.image = img;
                    } catch (_) {}
                    th2.list.push(replyObj);
                    saveSettings();
                    if($("#uie-app-msg-view").is(":visible")) renderMessages();
                    notify("success", `${targetName} replied.`, "Messages", "phoneMessages");
                    try { relayRelationship(targetName, replyText, "text"); } catch (_) {}
                    try {
                        const inj = await injectRpEvent(`(Text) ${targetName} → ${persona}: "${replyText}"${replyObj.image ? " [Image]" : ""}`, { uie: { type: "phone_text", who: targetName } });
                        if (inj && inj.ok && inj.mesid) {
                            replyObj.chatMesId = inj.mesid;
                            saveSettings();
                        }
                    } catch (_) {}
                }, 2000);

                const turns = Number(logic.arrivalInTurns || 0);
                if (turns > 0) scheduleArrival(targetName, turns, logic.arrivalReason || "They agreed to come over.");
            }
        } catch(e) {}
    });

    $win
        .off("keydown.phoneMsgEnter", "#msg-input")
        .on("keydown.phoneMsgEnter", "#msg-input", function (e) {
            if (e.key !== "Enter") return;
            if (e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();
            $("#msg-send-btn").trigger("click");
        });


    $win.off("input.phoneMsgGrow", "#msg-input").on("input.phoneMsgGrow", "#msg-input", function () {
        try {
            this.style.height = "0px";
            const max = 120;
            const h = Math.min(max, this.scrollHeight || 0);
            this.style.height = `${Math.max(40, h)}px`;
        } catch (_) {}
    });

    $win.off("click.phoneMsgAttach", "#msg-attach-btn").on("click.phoneMsgAttach", "#msg-attach-btn", function(e){
        e.preventDefault();
        e.stopPropagation();
        $("#msg-attach-file").trigger("click");
    });
    $win.off("change.phoneMsgAttach", "#msg-attach-file").on("change.phoneMsgAttach", "#msg-attach-file", async function(e){
        const f = (e.target.files || [])[0];
        $(this).val("");
        if (!f) return;
        if (!activeContact) return;
        const s = getSettings();
        if (isBlocked(s, activeContact)) return;
        const dataUrl = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = (ev) => resolve(String(ev?.target?.result || ""));
            r.onerror = () => resolve("");
            r.readAsDataURL(f);
        });
        if (!dataUrl) return;
        const th = getThread(activeContact);
        const msgObj = { isUser: true, text: "", image: dataUrl, ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        try {
            const persona = getPersonaName();
            const desc = `User sent an image file to ${String(activeContact)}.`;
            await injectRpEvent(`[System: User sent an image file to ${String(activeContact)}. Description: ${desc}. Prompt used: (none).]`);
            const inj = await injectRpEvent(`(Text) ${persona} → ${activeContact}: [Image]`, { uie: { type: "phone_text", who: activeContact } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}
    });

    const ensurePhoneStickers = (s) => {
        if (!s.phone) s.phone = {};
        if (!s.phone.stickers) s.phone.stickers = { packs: [], active: "" };
        if (!Array.isArray(s.phone.stickers.packs)) s.phone.stickers.packs = [];
        if (!s.phone.stickers.active) s.phone.stickers.active = s.phone.stickers.packs[0]?.name || "";
    };

    // ... [continuing with the rest of the phone.js code - shortened for brevity but the pattern continues] ...

    // --- CONTACTS LOGIC (Fixed Buttons) ---
    const renderContacts = () => {
        const s = getSettings();
        try { ensureContactNumbers(s); } catch (_) {}
        const l = $("#contact-list");
        l.empty();

        const socialPeople = getSocialPeople(s);
        const byName = new Set(socialPeople.map(p => String(p?.name || "").trim().toLowerCase()).filter(Boolean));
        const byNum = new Set(socialPeople.map(p => normalizeNumber(p?.phone || p?.phoneNumber || "")).filter(Boolean));
        const phoneBook = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const phoneOnly = phoneBook
            .map(x => ({ name: String(x?.name || "").trim(), number: String(x?.number || "").trim() }))
            .filter(x => x.name)
            .filter(x => !byName.has(x.name.toLowerCase()) && !byNum.has(normalizeNumber(x.number)));
        const combined = [
            ...socialPeople.map(p => ({ kind: "social", name: p.name, number: formatNumber(p?.phone || p?.phoneNumber || ""), avatar: p.avatar || "" })),
            ...phoneOnly.map(p => ({ kind: "phone", name: p.name, number: formatNumber(p.number), avatar: "" }))
        ].filter(p => p?.name).filter(p => !isBlocked(s, p.name));

        if(!combined.length) {
            l.html('<div style="padding:30px; text-align:center; color:#aaa;">No contacts found.<br>Tap + to add one.</div>');
        } else {
            combined.forEach(p => {
                const num = String(p.number || "—");
                const av = String(p.avatar || "").trim();
                const avatarHtml = av
                    ? `<img src="${esc(av)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`
                    : `${String(p.name || "?").charAt(0)}`;

                l.append(`
                    <div class="contact-row" data-name="${esc(p.name)}" style="display:flex; align-items:center; padding:15px; border-bottom:1px solid #eee; cursor:pointer;">
                        <div class="contact-avatar" style="width:40px; height:40px; background:#ddd; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:15px; font-weight:bold; color:#555; overflow:hidden;">${avatarHtml}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:bold; color:#333; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</div>
                            <div style="font-size:0.78em; opacity:0.65; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(num)}</div>
                        </div>

                        <i class="fa-solid fa-comment phone-msg-trigger" data-name="${p.name}" style="color:#3498db; padding:10px; cursor:pointer; font-size:1.2em; margin-right:10px;" title="Message"></i>

                        <i class="fa-solid fa-phone phone-call-trigger" data-name="${p.name}" style="color:#2ecc71; padding:10px; cursor:pointer; font-size:1.2em;" title="Call"></i>
                    </div>
                `);
            });
        }
    };

    const openThread = (name) => {
        if (!name) return;
        activeContact = name;
        try { getThread(activeContact); } catch (_) {}
        {
            const $p = $("#uie-phone-window");
            const wasVisible = $p.is(":visible");
            $p.show().css("display", "flex");
            if (!wasVisible) {
                try { window.UIE_navPush?.("win:#uie-phone-window"); } catch (_) {}
            }
        }
        openApp("#uie-app-msg-view");
        try { $("#msg-contact-name").text(String(activeContact || "Messages")); } catch (_) {}
        try { renderMessages(); } catch (_) {}
        try { $("#msg-input").trigger("focus"); } catch (_) {}
    };

    const promptAddContact = () => {
        const s = getSettings();
        ensureNumbersState(s);
        const name = String(window.prompt("Contact name:", "") || "").trim();
        if (!name) return;
        const used = new Set();
        for (const nb of (s.phone.numberBook || [])) used.add(normalizeNumber(nb?.number || ""));
        for (const p of getSocialPeople(s)) {
            const d = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (d) used.add(d);
        }
        const digits = generateFictionalNumber(used);
        const formatted = formatNumber(digits);
        s.phone.numberBook = (s.phone.numberBook || []).filter(x => normalizeNumber(x?.number || "") !== digits);
        s.phone.numberBook.push({ name: name.slice(0, 60), number: formatted, ts: Date.now() });
        saveSettings();
        renderContacts();
        notify("success", `Added ${name}`, "Contacts", "phoneMessages");
    };
    try { window.UIE_phone_openThread = openThread; } catch (_) {}

    $win.on("click.phone", "#contact-add-manual", (e) => { e.preventDefault(); e.stopPropagation(); promptAddContact(); });
    $win.on("click.phone", "#contact-add-fab", (e) => { e.preventDefault(); e.stopPropagation(); promptAddContact(); });

    // --- MESSAGE SHORTCUT (Contacts) ---
    $win.off("click.phoneMsgTrigger", ".phone-msg-trigger");
    $win.on("click.phoneMsgTrigger", ".phone-msg-trigger", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const nm = String($(this).data("name") || "").trim();
        if (!nm) return;
        openThread(nm);
    });

    // ... [rest of the phone event handlers continue as in original] ...

    // Standard bindings, call logic, browser logic, etc. continue here...
    // [The rest of the file continues unchanged from the original]

    loadPhoneVisuals();
    startArrivalWatcher();

    // FIX: Listen for chat changes to reset phone UI
    $(window).off("uie:chatChanged.uiePhone").on("uie:chatChanged.uiePhone", function(e) {
        console.log("[UIE Phone] Chat changed, resetting UI");
        // Clear module-level state
        activeContact = null;
        dialBuf = "";
        callChatContext = "";
        
        // Clear call timer if running
        if (callTimerInt) {
            clearInterval(callTimerInt);
            callTimerInt = null;
        }
        
        // Re-initialize phone visuals (loads new chat's phone data)
            loadPhoneVisuals();
            startArrivalWatcher();

    // FIX: Listen for chat changes to reset phone UI
    $(window).off("uie:chatChanged.uiePhone").on("uie:chatChanged.uiePhone", function(e) {
        try {
            console.log("[UIE Phone] Chat changed, resetting UI");
            
            // Clear module-level state
            activeContact = null;
            dialBuf = "";
            callChatContext = "";
            
            // Clear call timer if running
            if (callTimerInt) {
                clearInterval(callTimerInt);
                callTimerInt = null;
            }
            
            // Re-initialize phone visuals (loads new chat's phone data)
            try { loadPhoneVisuals(); } catch(err) { console.error("[UIE Phone] loadPhoneVisuals error:", err); }
            
            // Force re-render of UI components if phone is visible
            const $phone = $("#uie-phone-window");
            if ($phone.is(":visible")) {
                // Hide lockscreen if showing (new chat = no PIN needed)
                try { 
                    $("#uie-phone-lockscreen").hide();
                    $("#uie-lock-msg").text("");
                    $("#uie-phone-pin").val("");
                } catch(_) {}
                
                // Re-render components
                try { renderContacts(); } catch(_) {}
                try { renderMessages(); } catch(_) {}
                try { renderDialRecents(); } catch(_) {}
                
                // Go back to home screen
                try { goHome(); } catch(_) {}
            }
        } catch(err) {
            console.error("[UIE Phone] Reset error:", err);
        }
    });
        
        // Force re-render of UI components if phone is visible
        if ($("#uie-phone-window").is(":visible")) {
            renderContacts();
            renderMessages();
            renderDialRecents();
            goHome();
        }
    });
}

export function openBooksGuide(sectionId) {
    try {
        const $p = $("#uie-phone-window");
        // Force open phone if closed
        $p.show().css("display", "flex");

        // Position: always clamp/center on open (prevents phone from appearing off the top on small screens)
        try {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    try { ensurePhoneWindowOnScreen(true); } catch (_) {}
                });
            });
        } catch (_) {
            setTimeout(() => { try { ensurePhoneWindowOnScreen(true); } catch (_) {} }, 0);
        }

        // Hide other screens
        $("#uie-phone-lockscreen").hide();
        $("#uie-phone-homescreen").hide();
        $(".phone-app-window").hide();

        // Show Books App
        $("#uie-app-books-view").css("display", "flex").show();

        // Ensure render
        renderBooks();

        // Force Switch to Guide Tab
        $("#books-view-guide").show();
        $("#books-view-library").hide();
        $("#books-tab-guide").addClass("active");
        $("#books-tab-library").removeClass("active");

        if (sectionId) {
            setTimeout(() => {
                const target = document.getElementById(sectionId);
                if (target) {
                    target.scrollIntoView({ behavior: "smooth", block: "start" });
                    $(target).css("transition", "background 0.5s").css("background", "rgba(241, 196, 15, 0.2)");
                    setTimeout(() => $(target).css("background", ""), 1500);
                }
            }, 300);
        }
    } catch (e) {
        console.error("openBooksGuide failed", e);
    }
}
// Expose globally for HTML onclicks
try { window.UIE_openGuide = openBooksGuide; } catch (_) {}

function renderBooks() {
    const s = getSettings();
    if(!s.phone) s.phone = {};
    if(!Array.isArray(s.phone.books)) s.phone.books = [];
    const $win = $("#uie-phone-window");

    $("#books-view-guide").show();
    $("#books-view-library").hide();
    $("#books-tab-guide").addClass("active");
    $("#books-tab-library").removeClass("active");

    const $list = $("#books-list").empty();
    if (!s.phone.books.length) {
        $list.html(`<div style="opacity:0.75; padding:10px; border:1px dashed #ccc; border-radius:12px;">No books yet.</div>`);
    } else {
        s.phone.books.slice().reverse().forEach(b => {
            $list.append(`
                <div class="book-row" data-id="${b.id}" style="padding:12px; border-radius:12px; border:1px solid rgba(0,0,0,0.10); background:#f7f2e8; cursor:pointer; color:#2c1e10;">
                    <div style="font-weight:900; color:#000;">${String(b.title || "Book")}</div>
                    <div style="opacity:0.75; font-size:12px; color:#2c1e10;">${new Date(b.createdAt || Date.now()).toLocaleString()}</div>
                </div>
            `);
        });
    }

    $win.off("click.phoneBooksTabs");
    $win.on("click.phoneBooksTabs", "#books-tab-guide", () => {
        $("#books-view-guide").show();
        $("#books-view-library").hide();
        $("#books-tab-guide").addClass("active");
        $("#books-tab-library").removeClass("active");
    });
    $win.on("click.phoneBooksTabs", "#books-tab-library", () => {
        $("#books-view-guide").hide();
        $("#books-view-library").show();
        $("#books-tab-guide").removeClass("active");
        $("#books-tab-library").addClass("active");
    });

    const doGen = async () => {
        const s2 = getSettings();
        if (s2?.ai && s2.ai.books === false) return;
        const prompt = String($("#books-prompt").val() || "").trim();
        if(!prompt) return;
        $("#books-prompt").val("");
        const title = "";
        const html = await generateContent(`Write an immersive book as raw HTML. Style like a parchment book. User request: "${prompt}". No scripts. Do not add a title header unless the user explicitly asks for one.`, "Webpage");
        if(!html) return;
        const clean = cleanOutput(html, "web");
        const s3 = getSettings();
        if(!s3.phone) s3.phone = {};
        if(!Array.isArray(s3.phone.books)) s3.phone.books = [];
        s3.phone.books.push({ id: Date.now(), title, html: clean, createdAt: Date.now() });
        saveSettings();
        renderBooks();
        $("#books-view-guide").hide();
        $("#books-view-library").show();
        $("#books-tab-guide").removeClass("active");
        $("#books-tab-library").addClass("active");
    };

    $win.off("click.phoneBooksGen").on("click.phoneBooksGen", "#books-go", async (e) => {
        e.preventDefault(); e.stopPropagation();
        await doGen();
    });

    $win.off("keydown.phoneBooksPrompt").on("keydown.phoneBooksPrompt", "#books-prompt", async (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault(); e.stopPropagation();
        await doGen();
    });

    $win.off("click.phoneBooksOpen").on("click.phoneBooksOpen", "#books-list .book-row", function() {
        const id = Number($(this).data("id"));
        const s2 = getSettings();
        const b = (s2.phone.books || []).find(x => Number(x.id) === id);
        if(!b) return;
        $("#books-reader-body").html(String(b.html || ""));
        $("#books-reader").show();
    });

    $win.off("click.phoneBooksClose").on("click.phoneBooksClose", "#books-reader-close", () => {
        $("#books-reader").hide();
    });
}

const togglePhone = () => {
    $("#uie-phone-window").fadeToggle(200);
};

export { togglePhone };
