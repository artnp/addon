// --- Global State ---
// lastSource is now managed via chrome.storage.local (v3 service worker persistence)
let pendingFastDownload = false; // Flag สำหรับบังคับชื่อไฟล์ complete.png

const GEMINI_ACCOUNTS = [
    'https://gemini.google.com/u/0/app',
    'https://gemini.google.com/u/1/app',
    'https://gemini.google.com/u/2/app',
    'https://gemini.google.com/u/3/app',
    'https://gemini.google.com/u/4/app'
];

async function rotateGeminiAccount() {
    const data = await chrome.storage.local.get('geminiUrl');
    const currentUrl = data.geminiUrl || 'https://gemini.google.com/u/1/app';
    const currentIndex = GEMINI_ACCOUNTS.indexOf(currentUrl);
    const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % GEMINI_ACCOUNTS.length : 0;
    const nextUrl = GEMINI_ACCOUNTS[nextIndex];
    await chrome.storage.local.set({ 'geminiUrl': nextUrl });
    return currentUrl; // We use currentUrl BEFORE rotating to the next for the next request
}

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

    // ตรวจสอบว่ามาจาก Gemini domain จริงๆ หรือไม่
    const isFromGeminiDomain = referrer.includes('gemini.google.com') ||
        url.includes('gemini.google.com') ||
        url.includes('googleusercontent.com');

    // data: หรือ blob: URL → เปลี่ยนชื่อเฉพาะเมื่อ referrer มาจาก Gemini เท่านั้น
    if (url.startsWith('data:') || url.startsWith('blob:')) {
        if (isFromGeminiDomain) {
            suggest({ filename: 'complete.png', conflictAction: 'overwrite' });
        } else {
            suggest(); // ไม่ยุ่ง ปล่อยใช้ชื่อเดิม
        }
        return;
    }

    if (lowerName.includes('gemini_original_layer')) {
        suggest();
        return;
    }

    // เปลี่ยนชื่อเป็น complete.png เฉพาะเมื่อมาจาก Gemini domain เท่านั้น
    const isGeminiFile = isFromGeminiDomain && (
        lowerName.includes('gemini_generate') ||
        lowerName.includes('gemini_image') ||
        lowerName.includes('input_file') ||
        lowerName.includes('complete') ||
        lowerName.includes('ดาวน์โหลด') ||
        lowerName.includes('download'));

    if (isGeminiFile) {
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
        rotateGeminiAccount().then(baseUrl => {
            chrome.storage.local.set({ 'lastSource': 'fb' });
            handleOpenGemini({ url: baseUrl, customPrompt: "" }, sender);
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'OPEN_GEMINI_FOR_PASTE') {
        rotateGeminiAccount().then(baseUrl => {
            chrome.storage.local.set({
                'lastSource': 'fb',
                'pendingClipboardPaste': true,
                'requestingTabId': sender.tab.id
            }).then(() => {
                handleOpenGemini({ url: baseUrl, customPrompt: message.prompt || "" }, sender);
            });
        });
        sendResponse({ success: true });
        return true;
    }

    if (message.action === 'RETRY_NEXT_ACCOUNT') {
        (async () => {
             // For safety, force rotation of the URL immediately
             const currentUrl = await rotateGeminiAccount();
             const data = await chrome.storage.local.get('geminiUrl');
             const nextUrl = data.geminiUrl || 'https://gemini.google.com/u/1/app';
             
             await chrome.storage.local.set({
                 'pendingGeminiPrompt': message.payload.prompt,
                 'pendingMultipleImages': message.payload.images,
                 'pendingClipboardPaste': true,
             });
             
             handleOpenGemini({ url: nextUrl }, sender);
        })();
        return true;
    }

    if (message.action === 'SUBMIT_HUB_DATA') {
        (async () => {
            const { prompt, images = [], imagePaths = [], origin = 'http://127.0.0.1:5000' } = message;
            const fullPrompt = prompt ? prompt.trim() + ' (ให้ภาพคงตำแหน่งเดิมไว้ทุกประการและปรับให้ชัด)' : '(ให้ภาพคงตำแหน่งเดิมไว้ทุกประการและปรับให้ชัด)';

            const allImages = [...images];

            // Resolver: Fetch image paths to data URLs locally in background to bypass 64MB limit
            for (const path of imagePaths) {
                try {
                    const fetchUrl = `${origin}/get-img?path=${encodeURIComponent(path)}`;
                    const resp = await fetch(fetchUrl);
                    if (resp.ok) {
                        const blob = await resp.blob();
                        const bmp = await createImageBitmap(blob);
                        
                        let w = bmp.width;
                        let h = bmp.height;
                        const maxSide = 1800;
                        
                        // Resize logic to avoid 64MB extension limit
                        if (w > h) {
                            if (w > maxSide) { h = Math.floor(h * maxSide / w); w = maxSide; }
                        } else {
                            if (h > maxSide) { w = Math.floor(w * maxSide / h); h = maxSide; }
                        }
                        
                        // Add padding
                        const padding = Math.max(180, Math.floor(h * 0.12));
                        const canvas = new OffscreenCanvas(w, h + padding);
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = 'white';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(bmp, 0, 0, w, h);
                        
                        const newBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
                        const dataUrl = await new Promise(r => {
                            const reader = new FileReader();
                            reader.onloadend = () => r(reader.result);
                            reader.readAsDataURL(newBlob);
                        });
                        allImages.push(dataUrl);
                    }
                } catch (e) {
                    console.error('[Background] Failed to fetch image via path:', path, e);
                }
            }

            const data = await chrome.storage.local.get('geminiUrl');
            const baseUrl = data.geminiUrl || 'https://gemini.google.com/u/1/app';
            await chrome.storage.local.set({
                'lastSource': 'hub',
                'pendingGeminiPrompt': { text: fullPrompt, timestamp: Date.now() },
                'pendingMultipleImages': allImages,
                'pendingClipboardPaste': true
            });
            handleOpenGemini({ url: baseUrl }, sender);
            sendResponse({ success: true });
        })();
        return true;
    }

    if (message.action === 'SET_GEMINI_URL') {
        chrome.storage.local.set({
            'geminiUrl': message.url,
            'lastSource': 'hub' // Reset to hub mode when changing account via Hub
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
        chrome.storage.local.get(['lastSource', 'requestingTabId']).then(data => {
            const mode = data.lastSource || 'fb';
            fetch(`http://127.0.0.1:5000/set-mode?mode=${mode}`).catch(() => { });
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
                if (mode === 'fb' && data.requestingTabId) {
                    chrome.tabs.sendMessage(data.requestingTabId, {
                        action: 'PREPARE_FOR_PASTE',
                        imageContent: message.imageContent || null
                    }).catch(() => { });
                }
                if (sender && sender.tab) {
                    chrome.windows.remove(sender.tab.windowId).catch(() => { });
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
            url: url || 'https://gemini.google.com/u/1/app',
            type: 'popup',
            width: Math.floor(workArea.width * 0.3),
            height: workArea.height,
            left: workArea.left + Math.floor(workArea.width * 0.7),
            top: workArea.top, focused: true
        });
        await chrome.storage.local.set({ 'geminiWindowId': win.id });
    } catch (err) { console.error(err); }
}
