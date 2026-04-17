const EXT_ID = "universal-immersion-engine";
const basePathFallback = `scripts/extensions/third-party/${EXT_ID}`;
const baseUrl = (() => {
    try {
        const u = new URL(".", import.meta.url);
        return u.href.endsWith("/") ? u.href : `${u.href}/`;
    } catch (_) {
        const p = basePathFallback.startsWith("/") ? basePathFallback : `/${basePathFallback}`;
        return `${p}/`;
    }
})();
try {
    window.UIE_BASEURL = baseUrl;
    window.UIE_BASEPATH = baseUrl.replace(location.origin, "").replace(/\/$/, "");
} catch (_) {}

jQuery(async () => {
    try {
        if (window.UIE_DEBUG === true) console.log("[UIE] Initializing (Import Only Mode)...", { url: import.meta.url, baseUrl });
    } catch (_) {}

    try {
        window.UIE_moduleErrors = window.UIE_moduleErrors || [];
        window.UIE_moduleLoaded = window.UIE_moduleLoaded || {};
        window.UIE_debugStatus = () => {
            const s = (() => {
                try { return window.extension_settings?.["universal-immersion-engine"]; } catch (_) { return undefined; }
            })();
            const q = (sel) => {
                try { return document.querySelector(sel); } catch (_) { return null; }
            };
            const qAll = (sel) => {
                try { return Array.from(document.querySelectorAll(sel) || []); } catch (_) { return []; }
            };
            const wandCandidates = qAll("[id='wand_popup'], [id^='wand_popup'], [id*='wand_popup'], [id*='wandPopup']");
            const status = {
                baseUrl: window.UIE_BASEURL,
                build: window.UIE_BUILD,
                lastInitError: window.UIE_lastInitError || null,
                moduleErrors: Array.isArray(window.UIE_moduleErrors) ? window.UIE_moduleErrors.slice(-10) : [],
                moduleLoaded: window.UIE_moduleLoaded || {},
                settingsFlags: {
                    enabled: s && typeof s === "object" ? (s.enabled !== false) : null,
                    scanAllEnabled: s && typeof s === "object" ? (s?.generation?.scanAllEnabled !== false) : null,
                    allowSystemChecks: s && typeof s === "object" ? (s?.generation?.allowSystemChecks !== false) : null,
                    showPopups: s && typeof s === "object" ? (s?.ui?.showPopups !== false) : null,
                },
                dom: {
                    launcher: !!q("#uie-launcher"),
                    mainMenu: !!q("#uie-main-menu"),
                    settingsBlock: !!q("#uie-settings-block, .uie-settings-block"),
                    killSwitch: !!q("#uie-setting-enable"),
                    scanAll: !!q("#uie-scanall-enable"),
                    turboEnable: !!q("#uie-turbo-enable"),
                    backupNow: !!q("#uie-backup-now"),
                    wandPopup: !!q("#wand_popup"),
                    wandUieControls: !!q("#wand_popup #uie-wand-controls"),
                    wandPopupCandidates: wandCandidates.length,
                    wandPopupCandidateIds: wandCandidates.map((el) => String(el?.id || "")).filter(Boolean).slice(0, 12),
                },
                runtime: {
                    autoScanBound: window.UIE_autoScanBound === true,
                    autoScanBoundAt: window.UIE_autoScanBoundAt || null,
                    autoScanHasEventBus: window.UIE_autoScanHasEventBus === true,
                    domAutoScanBound: window.UIE_domAutoScanBound === true,
                    domAutoScanBoundAt: window.UIE_domAutoScanBoundAt || null,
                    autoScanLastTriggerAt: window.UIE_autoScanLastTriggerAt || null,
                    autoScanLastRunAt: window.UIE_autoScanLastRunAt || null,
                    autoScanLastError: window.UIE_autoScanLastError || null,
                    lastCoreToggle: window.UIE_lastCoreToggle || null,
                    wandPopupLastSeen: window.UIE_wandPopupLastSeen || null,
                    wandPopupCandidatesLast: window.UIE_wandPopupCandidatesLast || null,
                    wandPopupDeepCandidatesLast: window.UIE_wandPopupDeepCandidatesLast || null,
                    wandControlsInjectedAt: window.UIE_wandControlsInjectedAt || null,
                    wandControlsInjectedInto: window.UIE_wandControlsInjectedInto || null,
                    promptBound: window.UIE_promptBound === true,
                    promptBoundAt: window.UIE_promptBoundAt || null,
                    promptLastUpdateAt: window.UIE_promptLastUpdateAt || null,
                    promptLastError: window.UIE_promptLastError || null,
                    rpBufferLen: Number(window.UIE_rpBufferLen || 0) || 0,
                    rpLastBufferedAt: window.UIE_rpLastBufferedAt || null,
                },
                globals: {
                    hasGetSettings: typeof window?.UIE?.getSettings === "function" || typeof window?.UIE?.get_settings === "function",
                    hasRefreshStateSaves: typeof window.UIE_refreshStateSaves === "function",
                    hasBackupNow: typeof window.UIE_backupNow === "function",
                    hasScanNow: typeof window.UIE_scanNow === "function",
                },
                settingsBucket: {
                    exists: !!s,
                    type: typeof s,
                    keys: s && typeof s === "object" ? Object.keys(s).slice(0, 30) : [],
                },
            };
            try { console.log("[UIE] debugStatus", status); } catch (_) {}
            return status;
        };
    } catch (_) {}

    const uieBuildV = Date.now();
    try { window.UIE_BUILD = uieBuildV; } catch (_) {}

    const markInitError = (stage, e) => {
        try {
            window.UIE_lastInitError = {
                stage,
                message: String(e?.message || e || "Unknown error"),
                stack: String(e?.stack || ""),
                at: Date.now(),
                baseUrl,
                url: import.meta.url
            };
        } catch (_) {}
        try { window.toastr?.error?.(`UIE init failed (${stage}). Open console for details.`); } catch (_) {}
    };

    const safeImport = async (path, initFn, required = false) => {
        try {
            const m = await import(path);
            const fn = initFn ? m?.[initFn] : null;
            if (typeof fn === "function") await fn();
            try { window.UIE_moduleLoaded = window.UIE_moduleLoaded || {}; window.UIE_moduleLoaded[path] = true; } catch (_) {}
            return true;
        } catch (e) {
            const errorMsg = e?.message || e?.toString() || String(e) || "Unknown error";
            const errorStack = e?.stack || "";
            console.error(`[UIE] Module failed: ${path}${initFn ? ` (${initFn})` : ""}`, {
                message: errorMsg,
                stack: errorStack,
                error: e
            });
            try {
                window.UIE_moduleErrors = window.UIE_moduleErrors || [];
                window.UIE_moduleErrors.push({ at: Date.now(), path, initFn, message: String(errorMsg), stack: String(errorStack) });
            } catch (_) {}
            try { window.toastr?.error?.(`UIE module failed: ${path.split("/").pop()}`); } catch (_) {}
            if (required) throw e;
            return false;
        }
    };

    // 1. Styles
    $("<link>").attr({rel: "stylesheet", type: "text/css", href: `${baseUrl}style.css?v=${uieBuildV}`}).appendTo("head");
    $("<link>").attr({rel: "stylesheet", type: "text/css", href: `${baseUrl}src/styles/overrides.css?v=${uieBuildV}`}).appendTo("head");

    // 2. Cleanup Old Elements
    $("#uie-launcher, #uie-main-menu, .uie-window, .uie-book-overlay, .uie-phone, #uie-settings-block, .uie-settings-block").remove();

    // 3. Import Core & Startup
    try {
        const Core = await import(`./src/modules/core.js?v=${uieBuildV}`);
        const sleep = (ms) => new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
        const ensureSanitized = async () => {
            let lastErr = null;
            for (let i = 0; i < 150; i++) {
                try {
                    Core.sanitizeSettings();
                    return true;
                } catch (e) {
                    lastErr = e;
                    const msg = String(e?.message || e || "");
                    const looksLikeSettingsNotReady =
                        msg.includes("universal-immersion-engine") ||
                        msg.toLowerCase().includes("extension_settings") ||
                        msg.toLowerCase().includes("cannot read properties of undefined");
                    if (!looksLikeSettingsNotReady) throw e;
                    await sleep(100);
                }
            }
            throw lastErr || new Error("sanitizeSettings failed (timeout waiting for extension_settings)");
        };
        await ensureSanitized();
        try { (await import(`./src/modules/stateSubscriptions.js?v=${uieBuildV}`)).initStateSubscriptions?.(); } catch (_) {}

        const Startup = await import(`./src/modules/startup.js?v=${uieBuildV}`);
        Startup.patchToastr();
        try {
            await Startup.loadTemplates();
        } catch (e) {
            markInitError("templates", e);
            throw e;
        }

        try {
            const ok = $("#uie-inventory-window").length > 0;
            if (!ok) {
                console.error("[UIE] Templates loaded but inventory window missing. BaseUrl likely wrong.", { baseUrl });
                window.alert?.("[UIE] Inventory template did not load. Check console for baseUrl/template errors.");
                throw new Error("Inventory template missing after loadTemplates()");
            }
        } catch (_) {}
        setTimeout(() => { try { Startup.injectSettingsUI(); } catch (_) {} }, 1200);

        // 4. Load only critical modules synchronously for fast first paint.
        // Non-critical modules are deferred in the background.
        await safeImport(`./src/modules/dragging.js?v=${uieBuildV}`, "initDragging", true);
        await safeImport(`./src/modules/interaction.js?v=${uieBuildV}`, "initInteractions", true);
        await safeImport(`./src/modules/inventory.js?v=${uieBuildV}`, "initInventory", true);

        const deferredModules = [
            ["./src/modules/i18n.js", "initI18n"],
            ["./src/modules/backup.js", "initBackups"],
            ["./src/modules/navigation.js", "initNavigation"],
            ["./src/modules/prompt_injection.js", "initPromptInjection"],
            ["./src/modules/stateTracker.js", "initAutoScanning"],
            ["./src/modules/features/generation.js", "init"],
            ["./src/modules/features/activities.js", "initActivities"],
            ["./src/modules/diary.js", "initDiary"],
            ["./src/modules/diagnostics.js", "initDiagnostics"],
            ["./src/modules/calendar.js", "initCalendar"],
            ["./src/modules/databank.js", "initDatabank"],
            ["./src/modules/journal.js", "initJournal"],
            // Do not init War Room at startup; only init when the user explicitly opens it.
            ["./src/modules/map.js", "initMap"],
            ["./src/modules/party.js", "initParty"],
            ["./src/modules/social.js", "initSocial"],
            ["./src/modules/world.js", "initWorld"],
            ["./src/modules/chatbox.js", "initChatbox"],
            ["./src/modules/sprites.js", "initSprites"],
            ["./src/modules/features/stats.js", "initStats"],
            ["./src/modules/phone.js", "initPhone"],
        ];

        const runDeferredModules = async () => {
            for (const [modPath, initFn] of deferredModules) {
                await safeImport(`${modPath}?v=${uieBuildV}`, initFn, false);
                await sleep(80);
            }
            try { Core.updateLayout(); } catch (_) {}
        };

        try {
            if (typeof window.requestIdleCallback === "function") {
                window.requestIdleCallback(() => { void runDeferredModules(); }, { timeout: 4000 });
            } else {
                setTimeout(() => { void runDeferredModules(); }, 1200);
            }
        } catch (_) {
            setTimeout(() => { void runDeferredModules(); }, 1200);
        }

        // 5. Finalize (critical-ready)
        Core.updateLayout();
        try { $("#uie-battle-window").hide().css("display", "none"); } catch (_) {}
        
        // --- NEW: Safe Global Loading for Chat State ---
        try {
            const stateManager = await import(`./src/modules/StateManager.js?v=${uieBuildV}`);
            if (window.eventSource && window.event_types) {
                 window.eventSource.on(window.event_types.CHAT_CHANGED, () => {
                     stateManager.migrateLegacyData();
                     const localData = stateManager.getChatData();
                     
                     if (window.UIE) {
                         if (window.UIE.Phone?.loadData) window.UIE.Phone.loadData(localData.phone);
                         if (window.UIE.Inventory?.loadData) window.UIE.Inventory.loadData(localData.inventory);
                         if (window.UIE.Databank?.loadData) window.UIE.Databank.loadData(localData.databank);
                     }
                 });

                function onMessageReceived(messageId) {
    const context = SillyTavern.getContext();
    const msg = context.chat[messageId];
    
    // Only trigger on character messages, not swipes or user inputs
    if (!msg || msg.is_user) return;

    // Check if message contains our trigger
    if (msg.mes.includes('[SMS]') || msg.mes.includes('📞')) {
        // Path is relative to the ST root directory
        const ringPath = '/scripts/extensions/universal-immersion-engine/assets/ringtone.mp3';
        const ringtone = new Audio(ringPath);
        
        ringtone.volume = 0.6;
        ringtone.play().catch(e => console.warn('Audio play blocked by browser policy:', e));
    }
}

// Listen for new messages
window.eventSource.on('characterMessageRendered', onMessageReceived);
                 console.log("[UIE] Chat state listener attached safely!");
            } else {
                 console.warn("[UIE] window.eventSource not found. Cannot attach chat state listener.");
            }
        } catch (err) {
            console.error("[UIE] Failed to attach chat state listener:", err);
        }

        console.log("[UIE] Ready.");

    } catch (e) {
        console.error("[UIE] Critical Initialization Error:", e);
        markInitError("critical", e);
    }
});

jQuery(async () => {
    try {
        // --- UIE PHONE AUDIO SYSTEM ---
        
        let audioCtx = null;
        function getAudioContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            return audioCtx;
        }

        function makeDistortionCurve(amount = 20) {
            const n_samples = 44100;
            const curve = new Float32Array(n_samples);
            const deg = Math.PI / 180;
            for (let i = 0; i < n_samples; ++i) {
                const x = (i * 2) / n_samples - 1;
                curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
            }
            return curve;
        }

        const originalPlay = HTMLAudioElement.prototype.play;

        HTMLAudioElement.prototype.play = function() {
            try {
                const ctx = getAudioContext();
                if (ctx.state === 'suspended') ctx.resume();

                if (!this.dataset.uieGraphSetup) {
                    this.dataset.uieGraphSetup = "true";
                    this.crossOrigin = "anonymous"; 
                    
                    const source = ctx.createMediaElementSource(this);
                    const dryGain = ctx.createGain();
                    const wetGain = ctx.createGain();
                    
                    const highpass = ctx.createBiquadFilter();
                    highpass.type = 'highpass';
                    highpass.frequency.value = 400;
                    
                    const lowpass = ctx.createBiquadFilter();
                    lowpass.type = 'lowpass';
                    lowpass.frequency.value = 3000;
                    
                    const distortion = ctx.createWaveShaper();
                    distortion.curve = makeDistortionCurve(20);
                    distortion.oversample = '4x';
                    
                    source.connect(dryGain);
                    dryGain.connect(ctx.destination);
                    
                    source.connect(highpass);
                    highpass.connect(lowpass);
                    lowpass.connect(distortion);
                    distortion.connect(wetGain);
                    wetGain.connect(ctx.destination);
                    
                    this.uieNodes = { wetGain, dryGain };
                    console.log('[UIE] Phone filter attached safely.');
                }

                const context = window.SillyTavern?.getContext?.();
                const isCallActive = context?.chatMetadata?.UIE?.isCallActive === true;

                if (this.uieNodes) {
                    if (isCallActive) {
                        this.uieNodes.dryGain.gain.value = 0;
                        this.uieNodes.wetGain.gain.value = 1;
                    } else {
                        this.uieNodes.dryGain.gain.value = 1;
                        this.uieNodes.wetGain.gain.value = 0;
                    }
                }

            } catch (error) {
                console.warn("[UIE] Audio filter failed, falling back:", error);
            }

            return originalPlay.apply(this, arguments);
        };
        
    } catch (err) {
        console.error("[UIE] Init Error:", err);
    }
});
        // 2. Read context and toggle volumes dynamically
        const context = window.SillyTavern?.getContext?.();
        const isCallActive = context?.chatMetadata?.UIE?.isCallActive === true;

        if (this.uieNodes) {
            if (isCallActive) {
                this.uieNodes.dryGain.gain.value = 0; // Mute normal
                this.uieNodes.wetGain.gain.value = 1; // Play static
            } else {
                this.uieNodes.dryGain.gain.value = 1; // Play normal
                this.uieNodes.wetGain.gain.value = 0; // Mute static
            }
        }

    // REQUIRED to prevent crashes: Actually run the play function and return its Promise!
    return originalPlay.apply(this, arguments);
};
                
                // 2. Toggle Logic
                // Grab SillyTavern's current chat context safely
const context = window.SillyTavern?.getContext ? window.SillyTavern.getContext() : null;

let isPhoneActive = false;

// Ensure we are actually in a chat and the metadata exists
if (context && context.chatId && context.chatMetadata) {
    
    // Read from your UIE metadata object
    // Adjust 'UIE' and 'isCallActive' to match your actual keys!
    const uieData = context.chatMetadata.UIE || {};
    
    if (uieData.isCallActive === true) {
        isPhoneActive = true;
    }
}

// Quick log for debugging so you can see it working in the console
// console.log(`[UIE] Phone filter active: ${isPhoneActive}`); 
                
                if (this.uieNodes) {
                    this.uieNodes.dryGain.gain.value = isPhoneActive ? 0 : 1;
                    this.uieNodes.wetGain.gain.value = isPhoneActive ? 1 : 0;
                }

            } catch (e) {
                console.warn('[UIE] Filter bypassed (audio will play normally):', e);
            }
            
            // 3. Let SillyTavern play the audio
            return originalPlay.apply(this, arguments);
        };
        
        console.log('[UIE] Phone Audio interceptor loaded.');
    } catch (error) {
        console.error('[UIE] Fatal initialization error:', error);
    }
});
