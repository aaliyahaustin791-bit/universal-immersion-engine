const EXT_ID = "universal-immersion-engine";

export function getChatData() {
    const context = window.getContext();
    if (!context.chatId || !context.chat_metadata) {
        return { inventory: [], phone: {}, databank: {} };
    }
    if (!context.chat_metadata[EXT_ID]) {
        context.chat_metadata[EXT_ID] = {
            inventory: [],
            phone: { messages: [], activeContacts: [] },
            databank: {}
        };
    }
    return context.chat_metadata[EXT_ID];
}

export function saveChatData(data) {
    const context = window.getContext();
    if (!context.chatId || !context.chat_metadata) return;
    context.chat_metadata[EXT_ID] = data;
}

export function migrateLegacyData() {
    const context = window.getContext();
    const globalSettings = window.extension_settings?.[EXT_ID] || {};
    const hasOldData = globalSettings.inventory || globalSettings.phone || globalSettings.databank;
    
    if (!hasOldData || !context.chatId || !context.chat_metadata) return false;
    
    console.log("[UIE] Migrating legacy data to chat...");
    context.chat_metadata[EXT_ID] = {
        inventory: globalSettings.inventory || [],
        phone: globalSettings.phone || { messages: [], activeContacts: [] },
        databank: globalSettings.databank || {}
    };
    delete globalSettings.inventory;
    delete globalSettings.phone;
    delete globalSettings.databank;
    
    if (typeof window.saveSettingsDebounced === 'function') window.saveSettingsDebounced();
    return true;
}
