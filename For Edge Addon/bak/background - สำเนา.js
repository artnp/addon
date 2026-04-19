
// --- Storage Helpers ---
const getGeminiToYoutubeMap = async () => (await chrome.storage.local.get('geminiToYoutubeMap')).geminiToYoutubeMap || {};
const saveGeminiToYoutubeMap = async (map) => await chrome.storage.local.set({ geminiToYoutubeMap: map });

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message.action);

    if (message.action === 'OPEN_GEMINI_SIDETAB') {
        handleOpenGemini(message, sender).then(() => sendResponse({ success: true }));
        return true;
    } else if (message.action === 'PASTE_TO_GEMINI') {
        handlePasteToGemini(message, sender).then(() => sendResponse({ success: true }));
        return true;
    } else if (message.action === 'CLOSE_GEMINI_SIDETAB') {
        chrome.storage.local.get('geminiWindowId').then(data => {
            if (data.geminiWindowId) {
                chrome.windows.remove(data.geminiWindowId).catch(() => { });
                chrome.storage.local.remove('geminiWindowId');
            }
            sendResponse({ success: true });
        });
        return true;
    } else if (message.action === 'PROCESS_GEMINI_IMAGE') {
        const { image, prompt } = message;
        chrome.storage.local.set({
            'pendingGeminiImage': { image: image, timestamp: Date.now() },
            'requestingTabId': sender.tab.id
        }).then(() => {
            handleOpenGemini({ url: 'https://gemini.google.com', customPrompt: prompt }, sender);
        });
        sendResponse({ success: true });
        return true;
    } else if (message.action === 'CAPTURE_SCREEN_FOR_CROP') {
        const { rect } = message;
        chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError);
                return;
            }
            // Send back to the same tab to crop and copy to clipboard
            chrome.tabs.sendMessage(sender.tab.id, {
                action: 'CROP_AND_COPY',
                dataUrl: dataUrl,
                rect: rect
            });
        });
        sendResponse({ success: true });
        return true;
    } else if (message.action === 'OPEN_GEMINI_FOR_PASTE') {
        chrome.storage.local.set({
            'pendingClipboardPaste': true,
            'requestingTabId': sender.tab.id
        }).then(() => {
            handleOpenGemini({ url: 'https://gemini.google.com/u/1/app', customPrompt: message.prompt || "" }, sender);
        });
        sendResponse({ success: true });
        return true;
    } else if (message.action === 'DOWNLOAD_CLEANED_IMAGE') {
        const dataUrl = message.dataUrl;
        chrome.downloads.download({
            url: dataUrl,
            filename: 'complete.png',
            saveAs: false,
            conflictAction: 'overwrite'
        });

        // Auto-close Gemini sidetab
        chrome.storage.local.get('geminiWindowId').then(data => {
            if (data.geminiWindowId) {
                setTimeout(() => {
                    chrome.windows.remove(data.geminiWindowId).catch(() => { });
                    chrome.storage.local.remove('geminiWindowId');
                }, 1500);
            }
        });
        sendResponse({ success: true });
        return true;
    } else if (message.action === 'CLOSE_AD_TABS') {
        const faucetTabId = sender.tab.id;
        const faucetWindowId = sender.tab.windowId;
        chrome.tabs.query({ windowId: faucetWindowId }, (tabs) => {
            tabs.forEach(tab => {
                // Heuristic: Close tabs in the same window that:
                // 1. Were opened by this tab (openerTabId)
                // 2. Are NOT FaucetCrypto
                // 3. Are NOT Gemini
                // 4. Are NOT the faucet tab itself
                const isFaucet = tab.url?.includes('faucetcrypto.com');
                const isGemini = tab.url?.includes('gemini.google.com');
                const isSelf = tab.id === faucetTabId;

                if (!isFaucet && !isGemini && !isSelf) {
                    // Also check if it was likely an ad (if openerTabId matches, or if it was recently opened)
                    if (tab.openerTabId === faucetTabId || !tab.url || tab.url.startsWith('http')) {
                        chrome.tabs.remove(tab.id).catch(() => { });
                    }
                }
            });
        });
        sendResponse({ success: true });
        return true;
    } else if (message.action === 'CLOSE_CURRENT_TAB') {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.remove(sender.tab.id).catch(() => { });
        }
        sendResponse({ success: true });
        return true;
    } else if (message.action === 'STORE_RESULT_IMAGE') {
        const { imageContent } = message;
        const timestamp = Date.now();
        console.log('%c[Background] Received STORE_RESULT_IMAGE (size: ' + (imageContent?.length || 0) + ')', 'color: #fbbc04; font-weight: bold;');
        
        chrome.storage.local.set({ 
            'lastGeminiResult': imageContent,
            'lastGeminiResultTime': timestamp
        }).then(() => {
            chrome.storage.local.get('requestingTabId').then(data => {
                if (data.requestingTabId) {
                    console.log('[Background] Signaling Facebook tab with FRESH data:', data.requestingTabId);
                    chrome.tabs.sendMessage(data.requestingTabId, { 
                        action: 'PREPARE_FOR_PASTE',
                        imageContent: imageContent,
                        timestamp: timestamp
                    }).catch(e => console.warn('[Background] Target tab not found or closed:', e));
                }
            });
            sendResponse({ success: true });
        });
        return true;
    } else if (message.action === 'DOWNLOAD_AND_CLOSE') {
        const { url, filename, imageContent } = message;
        console.log('[Background] Fast download and close requested:', url);
        
        // 1. Process result image for automation flow (if provided)
        if (imageContent) {
           chrome.storage.local.set({ 
               'lastGeminiResult': imageContent,
               'lastGeminiResultTime': Date.now()
           });
        }

        // 2. Start the download
        chrome.downloads.download({
            url: url,
            filename: filename || 'complete.png',
            saveAs: false,
            conflictAction: 'overwrite'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('[Background] Download failed:', chrome.runtime.lastError);
                return;
            }
            console.log('[Background] Download started:', downloadId);
            
            // 3. Signal the original tab to continue (Facebook paste, etc.)
            chrome.storage.local.get(['requestingTabId']).then(data => {
                if (data.requestingTabId) {
                    console.log('[Background] Signaling continuation to tab:', data.requestingTabId);
                    chrome.tabs.sendMessage(data.requestingTabId, { 
                        action: 'PREPARE_FOR_PASTE',
                        imageContent: imageContent || null
                    }).catch(() => { });
                }
            });

            // 4. Auto-close the Gemini tab
            setTimeout(() => {
                if (sender.tab && sender.tab.id) {
                    console.log('[Background] Closing Gemini tab:', sender.tab.id);
                    chrome.tabs.remove(sender.tab.id).catch(() => { });
                }
            }, 1000);
        });
        sendResponse({ success: true });
        return true;
    }
    return true;
});

// --- Intercept Gemini Downloads to Rename ---
const geminiDownloadIds = new Set();
let lastOriginalLayerTrigger = 0; // Debounce lock for original layer backup
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const lowerName = (item.filename || '').toLowerCase();
    const url = (item.url || '').toLowerCase();
    const referrer = (item.referrer || '').toLowerCase();

    if (lowerName === 'complete.png' || lowerName.includes('gemini_original_layer')) {
        suggest();
        return;
    }

    const isFromGeminiDomain = referrer.includes('gemini.google.com') ||
        url.includes('gemini.google.com') ||
        url.includes('googleusercontent.com');

    const isNativeGemini = (isFromGeminiDomain ||
        lowerName.includes('gemini_generate') ||
        lowerName.includes('gemini_image') ||
        lowerName.includes('ดาวน์โหลด') ||
        lowerName.includes('download') ||
        lowerName.includes('input_file'));

    if (isNativeGemini || lowerName.includes('complete')) {
        console.log('[Background] Forcing .png extension for:', item.filename);
        // Force the filename AND the extension to be .png
        suggest({ filename: 'complete.png', conflictAction: 'overwrite' });
    } else {
        suggest();
    }
});

// --- Download Listener: Sync Native Gemini Download with Original Layer Backup ---
chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state && delta.state.current === 'interrupted') {
        geminiDownloadIds.delete(delta.id);
    }

    if (delta.state && delta.state.current === 'complete') {
        chrome.downloads.search({ id: delta.id }, (results) => {
            const download = results[0];
            if (download) {
                const lowerName = (download.filename || '').toLowerCase();
                const url = (download.url || '').toLowerCase();

                // 1. Detect Native Gemini Download
                const referrer = (download.referrer || '').toLowerCase();
                const isFromGeminiDomain = referrer.includes('gemini.google.com') || url.includes('googleusercontent.com');
                let isNativeGemini = geminiDownloadIds.has(download.id);

                if (isNativeGemini) {
                    console.log('%c[Background] Gemini download completed! Triggering paste signal...', 'color: #22c55e; font-weight: bold;');
                    geminiDownloadIds.delete(delta.id);

                    chrome.storage.local.get(['lastOriginalImage', 'requestingTabId', 'lastGeminiResult']).then(data => {
                        if (data.requestingTabId) {
                            // Send SIGNAL again. 
                            // If Gemini content script was fast, lastGeminiResult will have the data.
                            // If Gemini content script is slow, it will send STORE_RESULT_IMAGE shortly after, which also triggers the signal.
                            chrome.tabs.sendMessage(data.requestingTabId, { 
                                action: 'PREPARE_FOR_PASTE',
                                imageContent: data.lastGeminiResult || null
                            }).catch(() => { });
                        }
                        
                        // Backup original layer
                        if (data.lastOriginalImage) {
                            console.log('[Background] Backing up original layer...');
                            chrome.downloads.download({
                                url: data.lastOriginalImage,
                                filename: 'gemini_original_layer.png',
                                saveAs: false,
                                conflictAction: 'overwrite'
                            });
                        }
                    });
                }

                // Cleanup Gemini sidetab
                if (isNativeGemini || isCleanedImage || isOriginalLayer) {
                    chrome.storage.local.get('geminiWindowId').then(data => {
                        if (data.geminiWindowId) {
                            setTimeout(() => {
                                chrome.windows.remove(data.geminiWindowId).catch(() => { });
                                chrome.storage.local.remove('geminiWindowId');
                            }, 1000);
                        }
                    });
                }
            }
        });
    }
});


// --- Core Logic ---
async function handleOpenGemini(message, sender) {
    const { url, customPrompt } = message;

    // Only generate default 'Summarize this: url' prompt if it's NOT the gemini page itself
    let promptText = customPrompt || (url && !url.includes('gemini.google.com') ? `Summarize this: ${url}` : "");

    if (promptText && promptText.trim().length > 0) {
        promptText = promptText.trim() + " (ให้ภาพคงตำแหน่งเดิมไว้ทุกประการและปรับให้ชัด)";
        await chrome.storage.local.set({ 'pendingGeminiPrompt': { text: promptText, timestamp: Date.now() } });
    }

    try {
        let targetWindow = (sender && sender.tab) ? await chrome.windows.get(sender.tab.windowId) : await chrome.windows.getCurrent();
        const displays = await chrome.system.display.getInfo();
        const display = displays.find(d => targetWindow.left >= d.bounds.left && targetWindow.left < d.bounds.left + d.bounds.width) || displays[0];
        const { workArea } = display;

        const data = await chrome.storage.local.get('geminiWindowId');
        let geminiWindowId = data.geminiWindowId;
        let exists = false;

        if (geminiWindowId) {
            try { await chrome.windows.get(geminiWindowId); exists = true; } catch (e) { }
        }

        if (exists) {
            try { await chrome.windows.remove(geminiWindowId); } catch (e) { }
            await chrome.storage.local.remove('geminiWindowId');
        }

        const win = await chrome.windows.create({
            url: 'https://gemini.google.com/u/1/app',
            type: 'popup',
            width: Math.floor(workArea.width * 0.3),
            height: workArea.height,
            left: workArea.left + Math.floor(workArea.width * 0.7),
            top: workArea.top,
            focused: true
        });
        geminiWindowId = win.id;
        await chrome.storage.local.set({ 'geminiWindowId': win.id });

        // Layout and Mapping (Mapping only now)
        const g2yMap = await getGeminiToYoutubeMap();
        g2yMap[geminiWindowId] = targetWindow.id;
        await saveGeminiToYoutubeMap(g2yMap);

    } catch (err) {
        console.error('Error in handleOpenGemini:', err);
    }
}

async function handlePasteToGemini(message, sender) {
    const { content } = message;
    const { geminiWindowId } = await chrome.storage.local.get('geminiWindowId');
    if (!geminiWindowId) return;
    const tabs = await chrome.tabs.query({ windowId: geminiWindowId, active: true });
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'PASTE_CONTENT', content });
}

async function layoutYoutubeGemini70_30({ youtubeWindowId, geminiWindowId }) {
    try {
        const youtubeWin = await chrome.windows.get(youtubeWindowId);
        const displays = await chrome.system.display.getInfo();
        const display = displays.find(d => youtubeWin.left >= d.bounds.left && youtubeWin.left < d.bounds.left + d.bounds.width) || displays[0];
        const { workArea } = display;

        const geminiW = Math.floor(workArea.width * 0.3);
        const youtubeW = workArea.width - geminiW;

        await chrome.windows.update(youtubeWindowId, {
            left: workArea.left, top: workArea.top, width: youtubeW, height: workArea.height, state: 'normal'
        });
        await chrome.windows.update(geminiWindowId, {
            left: workArea.left + youtubeW, top: workArea.top, width: geminiW, height: workArea.height, state: 'normal'
        });
    } catch (e) {
        console.error('Layout error:', e);
    }
}

chrome.windows.onRemoved.addListener(async (windowId) => {
    const { geminiWindowId } = await chrome.storage.local.get('geminiWindowId');
    if (windowId === geminiWindowId) {
        chrome.storage.local.remove('geminiWindowId');
        const g2yMap = await getGeminiToYoutubeMap();
        if (g2yMap[windowId]) {
            delete g2yMap[windowId];
            await saveGeminiToYoutubeMap(g2yMap);
        }
    }
});

// ── CPX Gemini AI Handler ──
async function handleCpxGemini(prompt, sender) {
    try {
        // Create small Gemini popup
        const win = await chrome.windows.create({
            url: 'https://gemini.google.com/u/1/app',
            type: 'popup',
            width: 500, height: 600,
            left: 50, top: 50,
            focused: false
        });

        const cpxGeminiWinId = win.id;

        // Wait for the tab to load
        const tabId = win.tabs[0].id;
        await new Promise(resolve => {
            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
            // Timeout after 15s
            setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
        });

        // Wait a bit more for Gemini UI to initialize
        await new Promise(r => setTimeout(r, 3000));

        // Inject prompt into Gemini
        await chrome.scripting.executeScript({
            target: { tabId },
            func: async (promptText) => {
                // Find the input area
                let inputEl = null;
                for (let attempt = 0; attempt < 20; attempt++) {
                    const editables = Array.from(document.querySelectorAll('div[contenteditable="true"], [role="textbox"], rich-textarea'));
                    const candidates = editables.filter(el => {
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
                    }).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);

                    if (candidates.length > 0) {
                        inputEl = candidates[0];
                        if (inputEl.tagName === 'RICH-TEXTAREA') {
                            const inner = inputEl.querySelector('div[contenteditable="true"]');
                            if (inner) inputEl = inner;
                        }
                        break;
                    }
                    await new Promise(r => setTimeout(r, 500));
                }

                if (!inputEl) return;

                // Type the prompt
                inputEl.focus();
                inputEl.textContent = promptText;
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));

                // Wait a bit then click send
                await new Promise(r => setTimeout(r, 500));

                // Find send button
                const sendBtn = document.querySelector('button[aria-label="Send message"], button.send-button, button[mattooltip="Send message"]')
                    || Array.from(document.querySelectorAll('button')).find(b => b.querySelector('mat-icon')?.textContent?.includes('send') || b.innerHTML.includes('send'));

                if (sendBtn) {
                    sendBtn.click();
                }

                // Wait for response (poll for completion)
                let response = '';
                let lastLen = 0;
                let stableCount = 0;

                for (let i = 0; i < 120; i++) { // Max 60 seconds
                    await new Promise(r => setTimeout(r, 500));

                    // Get the latest response message
                    const messages = document.querySelectorAll('.response-container, .model-response-text, [class*="response"], message-content');
                    if (messages.length > 0) {
                        const lastMsg = messages[messages.length - 1];
                        const text = lastMsg.textContent?.trim();
                        if (text && text.length > 0) {
                            if (text.length === lastLen) {
                                stableCount++;
                                if (stableCount >= 4) { // Stable for 2 seconds = done
                                    response = text;
                                    break;
                                }
                            } else {
                                lastLen = text.length;
                                stableCount = 0;
                            }
                        }
                    }
                }

                // Store response
                if (response) {
                    await chrome.storage.local.set({ 'cpxAiResponse': response });
                }
            },
            args: [prompt]
        });

        // Wait for response to be stored, then close the popup
        let closeAttempts = 0;
        const closeInterval = setInterval(async () => {
            closeAttempts++;
            const result = await chrome.storage.local.get('cpxAiResponse');
            if (result.cpxAiResponse || closeAttempts > 70) {
                clearInterval(closeInterval);
                // Close the Gemini popup
                try { await chrome.windows.remove(cpxGeminiWinId); } catch (e) { }
            }
        }, 500);

    } catch (err) {
        console.error('[CPX Gemini]', err);
    }
}
