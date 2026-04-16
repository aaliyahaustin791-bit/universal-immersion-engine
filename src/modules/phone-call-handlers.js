export function initPhoneCallHandlers() {
    // 1. User clicks ACCEPT CALL
    document.getElementById('call-accept-btn').addEventListener('click', () => {
        const context = window.SillyTavern?.getContext();
        if (context && context.chatId) {
            // Ensure the UIE object exists
            if (!context.chatMetadata.UIE) context.chatMetadata.UIE = {};
            
            // Turn ON the call flag
            context.chatMetadata.UIE.isCallActive = true;
            context.saveChat();
            console.log("[UIE] Call Answered! Audio filter ENABLED.");
        }
        
        // ... (Your code to swap the UI to the active call screen goes here) ...
    });

    // 2. User clicks HANG UP
    document.getElementById('call-end-btn').addEventListener('click', () => {
        const context = window.SillyTavern?.getContext();
        if (context && context.chatId && context.chatMetadata.UIE) {
            
            // Turn OFF the call flag
            context.chatMetadata.UIE.isCallActive = false;
            context.saveChat();
            console.log("[UIE] Call Ended. Audio filter DISABLED.");
        }
        
        // ... (Your code to hide the call screen goes here) ...
    });
}