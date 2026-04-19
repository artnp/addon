// --- Global State ---
// lastSource is now managed via chrome.storage.local (v3 service worker persistence)
let pendingFastDownload = false; // Flag สำหรับบังคับชื่อไฟล์ complete.png

// --- Download Name Interceptor ---
// ทุกการดาวน์โหลดจาก Gemini จะเซฟเป็น complete.png เสมอ
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    const lowerName = (item.filename || '').toLowerCase();
    const url = (item.url || '').toLowerCase();
    const referrer = (item.referrer || '').toLowerCase();

    // ★ ถ้ากดจากปุ่ม Fast Download → บังคับเป็น complete.png ทุกกรณี
    if (pendingFastDownload) {
        pendingFastDownload = false;
        console.log('[Background] Fast Download -> complete.png (forced)');
        suggest({ filename: 'complete.png', conflictAction: 'overwrite' });
        return;
    }

    // ไม่ยุ่งกับไฟล์ที่เซฟจาก Fast Download (data: URL)
    if (url.startsWith('data:') || url.startsWith('blob:')) {
        suggest({ filename: 'complete.png', conflictAction: 'overwrite' });
        return;
    }

    if (lowerName.includes('gemini_original_layer')) {
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
        lowerName.includes('input_file') ||
        lowerName.includes('complete'));

    if (isNativeGemini) {
        console.log('[Background] Gemini download -> complete.png');
        suggest({ filename: 'complete.png', conflictAction: 'overwrite' });
    } else {
        suggest();
    }
});

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message.action);

    if (message.action === 'OPEN_GEMINI_WITH_IMAGE') {
        chrome.storage.local.set({ 'lastSource': 'fb' });
        handleOpenGemini({ url: 'https://gemini.google.com', customPrompt: "" }, sender);
        sendResponse({ success: true });
        return true;
    }
    
    if (message.action === 'OPEN_GEMINI_FOR_PASTE') {
        chrome.storage.local.set({ 
            'lastSource': 'fb',
            'pendingClipboardPaste': true,
            'requestingTabId': sender.tab.id
        }).then(() => {
            handleOpenGemini({ url: 'https://gemini.google.com/u/1/app', customPrompt: message.prompt || "" }, sender);
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'SUBMIT_HUB_DATA') {
        const { prompt, images } = message;
        // ต่อท้ายพร้อมพ์ด้วยคำสั่งคงตำแหน่ง
        const fullPrompt = prompt ? prompt.trim() + ' (ให้ภาพคงตำแหน่งเดิมไว้ทุกประการและปรับให้ชัด)' : '(ให้ภาพคงตำแหน่งเดิมไว้ทุกประการและปรับให้ชัด)';
        chrome.storage.local.set({
            'lastSource': 'hub',
            'pendingGeminiPrompt': { text: fullPrompt, timestamp: Date.now() },
            'pendingMultipleImages': images,
            'pendingClipboardPaste': true
        }).then(() => {
            handleOpenGemini({ url: 'https://gemini.google.com/u/1/app' }, sender);
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === "FETCH_IMAGE_BLOB") {
        fetch(message.url, { credentials: 'include' })
            .then(response => {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.blob();
            })
            .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => sendResponse({ dataUrl: reader.result });
                reader.readAsDataURL(blob);
            })
            .catch(error => {
                console.error('[Background] FETCH_IMAGE_BLOB error:', error.message);
                sendResponse({ error: error.message });
            });
        return true;
    }

    if (message.action === 'DOWNLOAD_AND_CLOSE') {
        // ★ ดึงโหมดที่เซฟไว้ (fb หรือ hub)
        chrome.storage.local.get(['lastSource', 'requestingTabId']).then(data => {
            const mode = data.lastSource || 'fb';
            // ★ บอก Watcher ว่าโหมดไหนก่อนดาวน์โหลด
            fetch(`http://127.0.0.1:5000/set-mode?mode=${mode}`).catch(() => {});
            
            // ★ ตั้ง Flag เพื่อให้ Interceptor บังคับชื่อเป็น complete.png
            pendingFastDownload = true;
            chrome.downloads.download({
                url: message.url,
                filename: 'complete.png',
                conflictAction: 'overwrite'
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error('[Background] Download error:', chrome.runtime.lastError.message);
                    pendingFastDownload = false;
                }

                // ★ ส่งสัญญาณบอก Facebook ว่ากำลังเตรียมนำภาพไปวาง
                if (mode === 'fb' && data.requestingTabId) {
                    chrome.tabs.sendMessage(data.requestingTabId, { 
                        action: 'PREPARE_FOR_PASTE',
                        imageContent: message.imageContent || null
                    }).catch(() => { });
                }

                // ★ ปิดหน้าต่าง Gemini side tab หลังดาวน์โหลดเสร็จ
                if (sender && sender.tab) {
                    chrome.windows.remove(sender.tab.windowId).catch(() => {});
                }
            });
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'GET_RECENT_DOWNLOADS') {
        chrome.downloads.search({ limit: 30, orderBy: ['-startTime'] }, async (items) => {
            const images = items.filter(item => {
                const ext = item.filename.toLowerCase();
                return ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png');
            });
            const result = await Promise.all(images.map(async img => {
                return new Promise((resolve) => {
                    chrome.downloads.getFileIcon(img.id, { size: 64 }, (iconUrl) => {
                        resolve({ id: img.id, filename: img.filename, startTime: img.startTime, iconUrl: iconUrl || '' });
                    });
                });
            }));
            sendResponse({ success: true, downloads: result });
        });
        return true;
    } else if (message.action === 'DELETE_FILE') {
        chrome.downloads.erase({ id: message.id }, () => {
            chrome.downloads.removeFile(message.id, () => { sendResponse({ success: true }); });
        });
        return true;
    }
    return true; 
});

async function handleOpenGemini(message, sender) {
    const { url, customPrompt } = message;
    let promptText = customPrompt || "";
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
        if (data.geminiWindowId) {
            try { await chrome.windows.remove(data.geminiWindowId); } catch (e) { }
        }
        const win = await chrome.windows.create({
            url: 'https://gemini.google.com/u/1/app',
            type: 'popup',
            width: Math.floor(workArea.width * 0.3),
            height: workArea.height,
            left: workArea.left + Math.floor(workArea.width * 0.7),
            top: workArea.top, focused: true
        });
        await chrome.storage.local.set({ 'geminiWindowId': win.id });
    } catch (err) { console.error(err); }
}
