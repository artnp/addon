
// === Cleaned up contentScript.js ===
// Features: 
// 1. Long click (1.5s) to enter crop mode.
// 2. Select area to crop.
// 3. Image copied to clipboard -> Pasted into Gemini.
// 4. Fastwork Chat: AI button on images to send to Gemini.

let isGeminiPage = window.location.hostname === 'gemini.google.com';
let isFastworkChat = window.location.hostname === 'chat.fastwork.co';
let isFaucetCrypto = window.location.hostname.includes('faucetcrypto.com');
let isOfferwall = window.location.hostname.includes('offerwall.me');
let isReddit = window.location.hostname.includes('reddit.com');
let isFacebook = window.location.hostname.includes('facebook.com');

// --- Extension Context Protection ---
function checkContext() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
    const msg = '⚠️ ส่วนขยายถูกรีโหลดใหม่ กรุณารีเฟรชหน้าเว็บนี้ครับ (Extension context invalidated)';
    if (typeof showToast === 'function') {
      showToast(msg);
    } else {
      console.warn(msg);
      alert(msg);
    }
    return false;
  }
  return true;
}

// --- Long Click (1.5s) System ---
if (!isGeminiPage) {
  let longClickTimer = null;
  const LONG_CLICK_DURATION = 1500;
  let startX, startY;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Left click only

    // Check if clicking on scrollbar
    const isScrollbar = e.clientX >= window.innerWidth - 20; // Right scrollbar area
    if (isScrollbar) {
      console.log('[Capture] Scrollbar detected, skipping long press');
      return;
    }

    startX = e.clientX;
    startY = e.clientY;

    cancelLongClick(); // Ensure any existing ring/timer is cleared first

    // Create anticipation ring
    const ring = document.createElement('div');
    ring.id = 'gemini-long-click-ring';
    ring.style.cssText = `
        position: fixed; left: ${startX - 25}px; top: ${startY - 25}px;
        width: 50px; height: 50px; border: 4px solid #4285f4;
        border-radius: 50%; opacity: 0; pointer-events: none;
        z-index: 2147483647; transform: scale(0.5);
        transition: transform ${LONG_CLICK_DURATION}ms linear, opacity 0.3s;
    `;
    document.body.appendChild(ring);

    // Animate it
    setTimeout(() => {
      if (longClickTimer) {
        ring.style.opacity = '1';
        ring.style.transform = 'scale(1.5)';
      }
    }, 50);

    longClickTimer = setTimeout(() => {
      console.log('[Capture] Long click detected. Entering crop mode...');
      ring.remove();
      startCropMode(startX, startY);
      longClickTimer = null;
    }, LONG_CLICK_DURATION);
  });

  const cancelLongClick = () => {
    if (longClickTimer) {
      clearTimeout(longClickTimer);
      longClickTimer = null;
    }
    const rings = document.querySelectorAll('#gemini-long-click-ring');
    rings.forEach(ring => {
      ring.style.opacity = '0';
      ring.id = 'gemini-long-click-ring-removing'; // Change ID to avoid being picked up again
      setTimeout(() => ring.remove(), 300);
    });
  };

  document.addEventListener('mouseup', (e) => {
    if (!document.getElementById('gemini-crop-overlay')) {
      cancelLongClick();
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (longClickTimer) {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
        cancelLongClick();
      }
    }
  });
}

// --- Fastwork Chat AI Button Logic ---
if (isFastworkChat) {
  const injectAIButtons = () => {
    // Find images in chat messages. Adjusted for Fastwork's typical structure
    const images = document.querySelectorAll('img:not(.gemini-processed)');
    images.forEach(img => {
      if (img.width < 50 || img.height < 50) return; // Skip small icons
      img.classList.add('gemini-processed');

      const container = img.parentElement;
      if (!container) return;
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      const aiBtn = document.createElement('div');
      aiBtn.innerHTML = 'Gemini';
      aiBtn.style.cssText = `
                position: absolute; top: 5px; right: 5px;
                background: #4285f4; color: white; padding: 4px 8px;
                border-radius: 4px; font-size: 10px; font-weight: bold;
                cursor: pointer; z-index: 100; opacity: 0.8;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                transition: transform 0.2s, opacity 0.2s;
            `;
      aiBtn.onmouseover = () => { aiBtn.style.opacity = '1'; aiBtn.style.transform = 'scale(1.1)'; };
      aiBtn.onmouseout = () => { aiBtn.style.opacity = '0.8'; aiBtn.style.transform = 'scale(1)'; };

      aiBtn.onclick = async (e) => {
        if (!checkContext()) { aiBtn.innerHTML = 'REFRESH'; return; }
        e.preventDefault();
        e.stopPropagation();
        aiBtn.textContent = '...';

        try {
          // Draw image to canvas to get dataURL (handling CORS if necessary)
          const tempImg = new Image();
          tempImg.crossOrigin = "Anonymous";
          tempImg.src = img.src;
          tempImg.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = tempImg.width;
            const padding = Math.max(180, Math.floor(tempImg.height * 0.12));
            canvas.height = tempImg.height + padding;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(tempImg, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            await copyToClipboard(dataUrl);
            showToast('Image sent to Gemini!');
            chrome.runtime.sendMessage({ action: 'OPEN_GEMINI_FOR_PASTE' });
            aiBtn.innerHTML = 'Gemini';
          };
        } catch (err) {
          if (err.message?.includes('Extension context invalidated')) {
            checkContext();
            aiBtn.innerHTML = 'REFRESH';
          } else {
            console.error('Fastwork AI processing error:', err);
            aiBtn.innerHTML = 'ERR';
          }
        }
      };

      container.appendChild(aiBtn);
    });
  };

  const autoCheckSubmitAgreement = () => {
    try {
      const xpath = "//text()[contains(., 'ยอมรับข้อตกลงการส่งงาน')]";
      const result = document.evaluate(xpath, document, null, XPathResult.ANY_TYPE, null);
      let node = result.iterateNext();

      while (node) {
        let textElement = node.parentElement;
        if (textElement) {
          let checkbox = null;
          let current = textElement;
          let labelElement = textElement.closest('label');

          // Traverse up to 8 levels to find a container with a checkbox
          for (let i = 0; i < 8; i++) {
            if (!current) break;
            if (current.querySelector) {
              checkbox = current.querySelector('input[type="checkbox"]');
              if (checkbox) break;
            }
            current = current.parentElement;
          }

          if (!checkbox) {
            const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');
            if (allCheckboxes.length > 0) checkbox = allCheckboxes[0];
          }

          let isChecked = false;
          // Native checkbox is the source of truth if exists
          if (checkbox) {
            isChecked = checkbox.checked;
          } else {
            // Fallback for UI frameworks without native inputs
            if (textElement.closest('.ant-checkbox-checked') || textElement.innerHTML.includes('checked')) {
              isChecked = true;
            }
          }

          if (!isChecked && !textElement.dataset.autoClicking) {
            textElement.dataset.autoClicking = 'true';
            console.log('[Fastwork] Checkbox is unchecked. Attempting to check...');

            if (labelElement) {
              labelElement.click();
            } else if (checkbox) {
              checkbox.click();
              textElement.click();
            } else {
              textElement.click();
              if (textElement.parentElement) textElement.parentElement.click();
            }

            if (checkbox) {
              checkbox.dispatchEvent(new Event('change', { bubbles: true }));
            }

            setTimeout(() => {
              delete textElement.dataset.autoClicking;
            }, 1500);
          }
        }
        node = result.iterateNext();
      }
    } catch (e) {
      console.error(e);
    }
  };

  setInterval(() => {
    // Only run if the URL matches /message/something (where something has content)
    // Skip on exactly /message or /message/
    if (!window.location.pathname.match(/^\/message\/.+/)) {
      return;
    }

    injectAIButtons();
    autoCheckSubmitAgreement();
  }, 2000);
}






// --- Reddit AI & Save Buttons Logic ---
if (isReddit) {
  const injectRedditButtons = () => {
    // Target main feed images, excluding small icons
    const images = Array.from(document.querySelectorAll('main img:not(.reddit-gemini-processed), shreddit-feed img:not(.reddit-gemini-processed)'));

    // Also include <shreddit-post> elements within main container if not caught by above
    const posts = document.querySelectorAll('main shreddit-post, shreddit-feed shreddit-post');
    posts.forEach(post => {
      post.querySelectorAll('img:not(.reddit-gemini-processed)').forEach(img => images.push(img));
    });

    // Remove duplicates
    const uniqueImages = [...new Set(images)];

    uniqueImages.forEach(img => {
      // Skip small images (icons, avatars)
      if (img.width < 150 || img.height < 150) return;

      // Ensure image is actually in a main-like area
      const rect = img.getBoundingClientRect();
      const windowCenter = window.innerWidth / 2;
      // If the image is entirely placed on the far right (sidebar), skip it
      if (rect.left > windowCenter + 200) return;

      img.classList.add('reddit-gemini-processed');

      const container = img.parentElement;
      if (!container) return;
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      // Wrapper for buttons
      const btnWrapper = document.createElement('div');
      btnWrapper.style.cssText = `
        position: absolute; top: 12px; right: 12px;
        display: flex; gap: 8px; z-index: 1000;
        pointer-events: auto;
      `;

      const clickCommentButton = () => {
        const post = img.closest('shreddit-post');
        if (!post) {
          console.log('[Reddit] Could not find shreddit-post');
          return;
        }

        // 1. the best way is using the permalink attribute from the post itself
        let commentUrl = post.getAttribute('permalink');

        // 2. If not found, try to find the standard permalink tag
        if (!commentUrl) {
          const anchor = post.querySelector('a[data-testid="post-title"]');
          if (anchor) commentUrl = anchor.getAttribute('href');
        }

        // 3. Last fallback: try finding the comment button
        let commentBtn = null;
        if (!commentUrl) {
          commentBtn = post.querySelector('shreddit-post-action-row')
            ?.shadowRoot?.querySelector('button[icon-name="comment"]')
            || post.querySelector('a[data-testid="comments-page-link"]')
            || post.querySelector('a[href*="/comments/"]');
        }

        if (commentUrl) {
          // Make sure it's an absolute url
          const fullUrl = new URL(commentUrl, window.location.origin).href;
          console.log('[Reddit] Navigating to comment page:', fullUrl);
          chrome.storage.local.set({
            'redditAutoComment': {
              imageSrc: img.src,
              timestamp: Date.now()
            }
          }, () => {
            window.location.href = fullUrl;
          });
        } else if (commentBtn) {
          console.log('[Reddit] Clicking comment button instead of explicit navigation');
          chrome.storage.local.set({
            'redditAutoComment': {
              imageSrc: img.src,
              timestamp: Date.now()
            }
          }, () => {
            commentBtn.click();
          });
        } else {
          console.log('[Reddit] Could not find comment URL or button to click.');
        }
      };

      // 1. Save Image Button
      const saveBtn = document.createElement('div');
      saveBtn.innerHTML = 'บันทึกภาพ';
      saveBtn.style.cssText = `
        background: rgba(0, 0, 0, 0.6); color: white; padding: 6px 12px;
        border-radius: 16px; font-size: 13px; font-weight: bold;
        cursor: pointer; backdrop-filter: blur(4px);
        transition: transform 0.2s, background 0.2s; border: 1px solid rgba(255,255,255,0.2);
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      `;
      saveBtn.onmouseover = () => { saveBtn.style.background = 'rgba(0, 0, 0, 0.8)'; saveBtn.style.transform = 'scale(1.05)'; };
      saveBtn.onmouseout = () => { saveBtn.style.background = 'rgba(0, 0, 0, 0.6)'; saveBtn.style.transform = 'scale(1)'; };
      saveBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          const res = await fetch(img.src);
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = url;
          a.download = 'reddit_image.png';
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          a.remove();
          showToast('Image saved!');
          clickCommentButton();
        } catch (err) {
          console.error('[Reddit] Download error with fetch, falling back to direct link:', err);
          const a = document.createElement('a');
          a.href = img.src;
          a.download = 'reddit_image.png';
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          a.remove();
          showToast('Opening image to save...');
          clickCommentButton();
        }
      };

      // 2. Gemini Button
      const aiBtn = document.createElement('div');
      aiBtn.innerHTML = 'Gemini';
      aiBtn.style.cssText = `
        background: #4285f4; color: white; padding: 6px 12px;
        border-radius: 16px; font-size: 13px; font-weight: bold;
        cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        transition: transform 0.2s, background 0.2s;
      `;
      aiBtn.onmouseover = () => { aiBtn.style.background = '#3367d6'; aiBtn.style.transform = 'scale(1.05)'; };
      aiBtn.onmouseout = () => { aiBtn.style.background = '#4285f4'; aiBtn.style.transform = 'scale(1)'; };

      aiBtn.onclick = async (e) => {
        if (!checkContext()) { aiBtn.innerHTML = 'REFRESH'; return; }
        e.preventDefault();
        e.stopPropagation();
        const originalText = aiBtn.innerHTML;
        aiBtn.textContent = '...';

        const sendToGemini = async (dataUrl) => {
          let postTitle = '';
          const shredditPost = img.closest('shreddit-post');
          if (shredditPost) {
            postTitle = shredditPost.getAttribute('post-title') || '';
            if (!postTitle) {
              const titleEl = shredditPost.querySelector('div[slot="title"], h1, h2, h3');
              if (titleEl) postTitle = titleEl.textContent.trim();
            }
          }
          await copyToClipboard(dataUrl);
          showToast('Image sent to Gemini!');
          chrome.runtime.sendMessage({ action: 'OPEN_GEMINI_FOR_PASTE', prompt: postTitle });
          aiBtn.innerHTML = originalText;

          clickCommentButton();
        };

        try {
          const tempImg = new Image();
          tempImg.crossOrigin = "Anonymous";
          tempImg.src = img.src;
          tempImg.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = tempImg.width;
            const padding = Math.max(180, Math.floor(tempImg.height * 0.12));
            canvas.height = tempImg.height + padding;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(tempImg, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            await sendToGemini(dataUrl);
          };
          tempImg.onerror = () => {
            // Fallback for CORS
            fetch(img.src).then(r => r.blob()).then(blob => {
              const reader = new FileReader();
              reader.onloadend = () => {
                sendToGemini(reader.result);
              };
              reader.readAsDataURL(blob);
            }).catch(err => { aiBtn.innerHTML = 'ERR'; console.error(err); });
          };
        } catch (err) {
          if (err.message?.includes('Extension context invalidated')) {
            checkContext();
            aiBtn.innerHTML = 'REFRESH';
          } else {
            console.error('[Reddit] AI processing error:', err);
            aiBtn.innerHTML = 'ERR';
          }
        }
      };

      btnWrapper.appendChild(saveBtn);
      btnWrapper.appendChild(aiBtn);
      container.appendChild(btnWrapper);
    });
  };

  setInterval(injectRedditButtons, 2000);

  // --- Shadow DOM Helper ---
  // Reddit uses Shadow DOM for shreddit-composer, faceplate-text-input, etc.
  // This helper queries through shadow roots recursively
  function deepQueryAll(root, selector) {
    const results = [];
    const find = (node) => {
      if (node.querySelectorAll) {
        try { results.push(...node.querySelectorAll(selector)); } catch (e) { }
      }

      // Search standard children
      if (node.children) {
        for (const child of node.children) {
          find(child);
        }
      }

      // Search shadow roots
      if (node.shadowRoot) {
        find(node.shadowRoot);
      }
    };
    find(root);
    // Remove duplicates
    return Array.from(new Set(results));
  }

  function deepQuery(root, selector) {
    const results = deepQueryAll(root, selector);
    return results.length > 0 ? results[0] : null;
  }

  // --- Reddit Auto-Comment Handler ---
  // When arriving on a comment page with pending autoComment, scroll to composer and setup automation
  let isAutoCommentRunning = false;

  const checkRedditAutoComment = () => {
    if (isAutoCommentRunning) return;
    if (!window.location.pathname.includes('/comments/')) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;

    chrome.storage.local.get('redditAutoComment', (result) => {
      if (!result.redditAutoComment) return;
      const autoData = result.redditAutoComment;

      // Only process if recent (within 60 seconds)
      if (Date.now() - autoData.timestamp > 60000) {
        chrome.storage.local.remove('redditAutoComment');
        return;
      }

      isAutoCommentRunning = true;
      chrome.storage.local.remove('redditAutoComment');
      console.log('[Reddit] Auto-comment: starting...');

      const doAutoComment = async () => {
        // Step 1: Wait for page to load, find the comment composer
        let composerHost = null;
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 500));
          composerHost = document.querySelector('comment-composer-host')
            || document.querySelector('shreddit-composer');
          if (composerHost) break;
        }

        if (!composerHost) {
          console.warn('[Reddit] Auto-comment: composer not found');
          return;
        }

        // Scroll to composer
        composerHost.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await new Promise(r => setTimeout(r, 1000));

        // Step 2: Click the textarea to activate the comment editor
        // The textarea might be inside shadow DOM
        let textarea = deepQuery(composerHost, 'textarea')
          || deepQuery(composerHost, 'div[role="textbox"]')
          || composerHost.querySelector('textarea');

        if (!textarea) {
          // Try clicking the host element itself
          composerHost.click();
          await new Promise(r => setTimeout(r, 500));
          textarea = deepQuery(composerHost, 'textarea')
            || deepQuery(composerHost, 'div[role="textbox"]');
        }

        if (textarea) {
          textarea.click();
          textarea.focus();
        } else {
          composerHost.click();
        }
        await new Promise(r => setTimeout(r, 800));

        showToast('📎 ลากภาพมาวางที่ช่องคอมเมนต์เลยครับ');

        // Step 3: Watch for image drop, then auto-fill Tip link
        // Use native event listeners to detect paste or drop perfectly instead of guessing elements
        let imageDetected = false;

        const onImageAdded = async (e) => {
          if (imageDetected) return;

          // Only trigger if data contains files (to ignore normal text paste/drop)
          const dataTransfer = e.clipboardData || e.dataTransfer;
          if (!dataTransfer || !dataTransfer.files || dataTransfer.files.length === 0) {
            // Wait, sometimes drag from browser doesn't have files but has text/html or image URL
            if (!dataTransfer.items) return;
            let hasImage = false;
            for (let i = 0; i < dataTransfer.items.length; i++) {
              if (dataTransfer.items[i].type.indexOf('image') !== -1) hasImage = true;
            }
            if (!hasImage) return;
          }

          imageDetected = true;
          console.log(`[Reddit] Auto-comment: File ${e.type} detected!`);

          // Cleanup listeners
          document.removeEventListener('drop', onImageAdded, true);
          document.removeEventListener('paste', onImageAdded, true);

          // Wait for upload to complete
          showToast('⏳ กำลังรอรูปอัปโหลดเสร็จ รอสักครู่...');
          await new Promise(r => setTimeout(r, 4500)); // Wait generous amount of time for upload
          await addTipLink();
        };

        // Listen on the document level during the capture phase to ensure we always get it
        document.addEventListener('drop', onImageAdded, true);
        document.addEventListener('paste', onImageAdded, true);

        // Stop waiting after 5 minutes
        setTimeout(() => {
          document.removeEventListener('drop', onImageAdded, true);
          document.removeEventListener('paste', onImageAdded, true);
        }, 300000);

        async function addTipLink() {
          console.log('[Reddit] Auto-comment: adding Tip link...');

          let linkBtn = null;

          // Retry logic: try to expand formatting toolbar up to 3 times
          // Helper to simulate a real user click
          const simulateClick = (el) => {
            if (!el) return;
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            el.click();
          };

          for (let attempt = 0; attempt < 3; attempt++) {
            // Step 4: Click the Aa button (format button)
            let aaBtn = null;
            const allBtns = deepQueryAll(document, 'button');

            aaBtn = allBtns.find(b => {
              // Find by SVG
              if (b.querySelector('svg[icon-name="format"]') || deepQuery(b, 'svg[icon-name="format"]')) return true;
              // Find by text/screen reader as fallback
              const screenReaderText = Array.from(b.querySelectorAll('faceplate-screen-reader-content')).map(el => el.textContent.trim()).join(' ').toLowerCase();
              const text = b.textContent.trim().toLowerCase();
              return text === 'aa' || text.includes('จัดรูปแบบ') || text.includes('format option') || screenReaderText.includes('รูปแบบ');
            });

            if (aaBtn) {
              simulateClick(aaBtn);
              console.log(`[Reddit] Auto-comment: Aa button clicked via simulateClick (attempt ${attempt + 1})`);
              await new Promise(r => setTimeout(r, 800));
            } else {
              console.warn('[Reddit] Auto-comment: Aa button not found completely');
            }

            // Step 5: Find the Link button
            // Reuse outer linkBtn variable (no 'let' here)
            linkBtn = null;

            linkBtn = allBtns.find(b => {
              // Find by explicitly known SVG
              if (b.querySelector('svg[icon-name="link"]') || deepQuery(b, 'svg[icon-name="link"]')) return true;
              // Find by aria-label
              const label = b.getAttribute('aria-label') || '';
              if (label.includes('ลิงก์') || label.toLowerCase().includes('link')) return true;
              return false;
            });

            // Fallback: look for button with link icon by checking SVG details
            if (!linkBtn) {
              const allBtns = deepQueryAll(composerHost, 'button');
              // Format toolbar buttons often have generic SVGs. The link SVG is usually simple.
              for (const btn of allBtns) {
                if (btn.querySelector('svg')
                  && !btn.getAttribute('aria-label')?.includes('GIF')
                  && !btn.getAttribute('aria-label')?.includes('ภาพ')
                  && !btn.getAttribute('aria-label')?.includes('จัดรูปแบบ')
                  && btn.textContent.trim() === '' // Must have no text
                ) {
                  const paths = btn.querySelectorAll('path');
                  if (paths.length >= 1) {
                    const d = Array.from(paths).map(p => p.getAttribute('d')).join('');
                    // Link icons often have multiple arcs/curves in the path but are relatively short
                    if (d.includes('M') && d.length > 50 && d.length < 350) {
                      linkBtn = btn;
                    }
                  }
                }
              }
            }

            if (linkBtn) break; // Found it!
            await new Promise(r => setTimeout(r, 600)); // Wait before next attempt
          }

          if (!linkBtn) {
            console.warn('[Reddit] Auto-comment: Link button not found even after retries');
            showToast('⚠️ หาปุ่มใส่ลิงก์ไม่เจอครับ ลองกดเองดูนะครับ');
            return;
          }

          simulateClick(linkBtn);
          console.log('[Reddit] Auto-comment: Link button clicked via simulateClick');
          await new Promise(r => setTimeout(r, 1200));

          // Step 6: Fill in the "เพิ่มลิงก์" dialog
          // The dialog might be outside the composer, at document level
          // Search both in document and through shadow DOMs
          let textInput = null;
          let linkInput = null;

          // Try specific Reddit selectors first
          const textFaceplate = document.querySelector('faceplate-text-input[label="ข้อความ"]')
            || deepQuery(document, 'faceplate-text-input[label="ข้อความ"]');
          const linkFaceplate = document.querySelector('faceplate-text-input[label="ลิงก์"]')
            || deepQuery(document, 'faceplate-text-input[label="ลิงก์"]');

          if (textFaceplate) {
            textInput = textFaceplate.querySelector('input') || deepQuery(textFaceplate, 'input');
          }
          if (linkFaceplate) {
            linkInput = linkFaceplate.querySelector('input') || deepQuery(linkFaceplate, 'input');
          }

          // Fallback: find all visible inputs
          if (!textInput || !linkInput) {
            const allInputs = deepQueryAll(document, 'input');
            const visibleInputs = allInputs.filter(inp => {
              const rect = inp.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0 && inp.type !== 'hidden';
            });
            if (visibleInputs.length >= 2 && !textInput) {
              textInput = visibleInputs[visibleInputs.length - 2];
              linkInput = visibleInputs[visibleInputs.length - 1];
            }
          }

          if (textInput && linkInput) {
            // Use native setter to bypass React/framework protections
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

            // Fill "ข้อความ" 
            textInput.focus();
            nativeInputValueSetter.call(textInput, 'Tip💘');
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
            textInput.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400));

            // Fill "ลิงก์"
            linkInput.focus();
            nativeInputValueSetter.call(linkInput, 'https://buymeacoffee.com/ready321');
            linkInput.dispatchEvent(new Event('input', { bubbles: true }));
            linkInput.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400));

            // Step 7: Click save button ("บันทึก")
            const allBtns = deepQueryAll(document, 'button');
            const saveBtn = allBtns.find(b => {
              const txt = b.textContent.trim();
              return txt === 'บันทึก' || txt === 'Save' || txt === 'Insert';
            });

            if (saveBtn) {
              saveBtn.click();
              console.log('[Reddit] Auto-comment: Tip link saved!');
              showToast('✅ เพิ่มลิงก์ Tip เรียบร้อย!');
            } else {
              console.warn('[Reddit] Auto-comment: Save button not found');
            }
          } else {
            console.warn('[Reddit] Auto-comment: input fields not found in link dialog', { textInput, linkInput });
          }
        }
      };

      doAutoComment();
    });
  };

  setInterval(checkRedditAutoComment, 1000);
}


// --- Facebook AI Logic ---
if (isFacebook) {
  let lastUsedPostContainer = null;

  const injectFacebookButtons = () => {
    const images = Array.from(document.querySelectorAll('img:not(.fb-gemini-processed)'));

    images.forEach(img => {
      // Skip small UI images
      if (img.width < 250 || img.height < 250) return;
      const rect = img.getBoundingClientRect();
      if (rect.width < 250 || rect.height < 250) return;

      img.classList.add('fb-gemini-processed');

      const postContainer = img.closest('div[role="dialog"]') || img.closest('div[role="article"]');
      if (!postContainer) return;

      // Only 1 button per post container
      if (postContainer.dataset.hasGeminiBtn === 'true') return;
      postContainer.dataset.hasGeminiBtn = 'true';

      // Ensure post container can hold absolute elements
      if (getComputedStyle(postContainer).position === 'static') {
        postContainer.style.position = 'relative';
      }

      const btnWrapper = document.createElement('div');
      btnWrapper.style.cssText = `
        position: absolute; top: 12px; right: 48px;
        display: flex; gap: 8px; z-index: 10000;
        pointer-events: auto;
      `;

      const aiBtn = document.createElement('div');
      aiBtn.innerHTML = 'Gemini';
      aiBtn.style.cssText = `
        background: #fbbc04; color: black; padding: 10px 18px;
        border-radius: 24px; font-size: 14px; font-weight: bold;
        cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.5);
        transition: transform 0.2s, background 0.2s;
        display: flex; align-items: center; justify-content: center;
        border: 2px solid #000;
      `;

      aiBtn.onmouseover = () => { aiBtn.style.background = '#f2a900'; aiBtn.style.transform = 'scale(1.1)'; };
      aiBtn.onmouseout = () => { aiBtn.style.background = '#fbbc04'; aiBtn.style.transform = 'scale(1)'; };

      aiBtn.onclick = async (e) => {
        if (!checkContext()) { aiBtn.innerHTML = 'REFRESH'; return; }
        lastUsedPostContainer = postContainer;
        e.preventDefault();
        e.stopPropagation();
        const originalText = aiBtn.innerHTML;
        aiBtn.textContent = '...';

        try {
          // 1. Extract Post Content First (fingerprint)
          let postContent = '';
          const findText = (root) => {
            const el = root.querySelector('div[data-ad-comet-preview="message"]')
              || root.querySelector('div[data-ad-preview="message"]')
              || root.querySelector('div[dir="auto"][style*="text-align: start"]');
            return el ? (el.innerText || el.textContent || "").trim() : "";
          };

          postContent = findText(postContainer);
          if (!postContent) {
            const candidates = Array.from(postContainer.querySelectorAll('div[dir="auto"], span[dir="auto"]')).filter(el => {
              if (el.closest('a') || el.closest('button') || el.closest('ul') || el.closest('span[role="button"]')) return false;
              return (el.innerText || el.textContent || "").trim().length > 15;
            });
            if (candidates.length > 0) {
              postContent = candidates.reduce((a, b) => (a.innerText || "").length > (b.innerText || "").length ? a : b).innerText.trim();
            }
          }

          // 2. Universal Image Discoverer
          const findFbImages = (container, seedEl) => {
            if (!container) return [];
            let results = [];
            let seenSrcs = new Set();
            const isTheater = !!container.closest('div[role="dialog"]');
            const minSize = isTheater ? 60 : 120;

            const commentRoots = Array.from(container.querySelectorAll(
              'div[aria-label*="Comment"], div[aria-label*="comment"], div[aria-label*="ความคิดเห็น"], div[aria-label*="แสดงความคิดเห็น"]'
            ));

            const isInComments = (el) => {
              for (const r of commentRoots) {
                if (r && r.contains(el)) return true;
              }
              return false;
            };

            const getMediaScopeRoot = () => {
              // Prefer the closest reasonable media container around the clicked/seed image.
              if (seedEl && container.contains(seedEl)) {
                let cur = seedEl;
                for (let i = 0; i < 8 && cur && cur !== container; i++) {
                  const parent = cur.parentElement;
                  if (!parent) break;
                  // Stop expanding if parent is clearly a comment area.
                  if (isInComments(parent) || parent.querySelector('[role="textbox"], textarea')) break;
                  const imgCount = parent.querySelectorAll('img').length;
                  const bgCount = parent.querySelectorAll('[style*="background-image"], div[style*="background-image"]').length;
                  if ((imgCount + bgCount) >= 2) return parent;
                  cur = parent;
                }
                // Fallback: use seed's closest non-comment block.
                const block = seedEl.closest('div') || seedEl;
                if (block && container.contains(block) && !isInComments(block)) return block;
              }
              // Fallback: pick the first large media-ish block above comment roots
              return container;
            };

            const normalizeUrl = (u) => {
              if (!u) return '';
              const s = String(u).trim();
              if (!s || s.startsWith('data:')) return s;
              try {
                const url = new URL(s, location.href);
                return url.toString();
              } catch {
                return s;
              }
            };

            const pickBestFromSrcset = (srcset) => {
              if (!srcset) return '';
              // Prefer the largest width descriptor.
              const parts = String(srcset)
                .split(',')
                .map(p => p.trim())
                .filter(Boolean);
              let best = { url: '', w: -1 };
              for (const part of parts) {
                const m = part.match(/^(.+?)\s+(\d+)w$/);
                if (m) {
                  const w = parseInt(m[2], 10);
                  if (Number.isFinite(w) && w > best.w) best = { url: m[1].trim(), w };
                } else if (!best.url) {
                  // Fallback: just take the first URL-like token
                  const t = part.split(/\s+/)[0];
                  if (t) best = { url: t.trim(), w: best.w };
                }
              }
              return best.url;
            };

            const extractBackgroundUrls = (bg) => {
              if (!bg || bg === 'none') return [];
              // background-image can contain multiple url("...")
              const urls = [];
              const re = /url\(([^)]+)\)/g;
              let m;
              while ((m = re.exec(bg)) !== null) {
                const raw = (m[1] || '').replace(/["']/g, '').trim();
                if (raw) urls.push(raw);
              }
              return urls;
            };

            // ฟังก์ชันกวาดล้างสากล: หาได้ทั้ง <img> และ background-image
            const scanElement = (el) => {
              if (isInComments(el)) return;
              const rect = el.getBoundingClientRect();
              if (rect.width <= minSize || rect.height <= minSize) return;

              const pushSrc = (rawSrc) => {
                const src = normalizeUrl(rawSrc);
                if (!src || seenSrcs.has(src)) return;
                const low = src.toLowerCase();
                if (low.includes('emoji') || low.includes('static.xx.fbcdn')) return;
                results.push({ src, w: rect.width, h: rect.height });
                seenSrcs.add(src);
              };

              if (el.tagName === 'IMG') {
                const bestFromSrcset = pickBestFromSrcset(el.getAttribute('srcset'));
                pushSrc(bestFromSrcset || el.currentSrc || el.src || el.getAttribute('src') || el.getAttribute('data-src'));
                return;
              }

              const directStyle = el.style && el.style.backgroundImage ? el.style.backgroundImage : '';
              if (directStyle && directStyle !== 'none' && directStyle.includes('url(')) {
                const urls = extractBackgroundUrls(directStyle);
                if (urls.length > 0) urls.forEach(pushSrc);
                return;
              }

              const style = window.getComputedStyle(el);
              const bg = style.backgroundImage;
              if (bg && bg !== 'none' && bg.includes('url(')) {
                const urls = extractBackgroundUrls(bg);
                if (urls.length > 0) urls.forEach(pushSrc);
              }
            };

            const scopeRootPrimary = getMediaScopeRoot();

            // 1. กวาดลึกใน Scope (ยึดจาก media แถวรูปที่คลิก) เพื่อกันไปโดนรูปในคอมเมนต์
            const candidates = scopeRootPrimary.querySelectorAll('img, [role="img"], [style*="background-image"], div[style*="background-image"]');
            candidates.forEach(scanElement);
            scanElement(scopeRootPrimary); // รวมตัวมันเองด้วย

            // 2. ถ้ายังได้รูปเดียว (มักเกิดใน Theater ที่มีการถอด DOM) ให้ขยายขอบเขตใน dialog/article เดียวกันเท่านั้น
            if (results.length <= 1) {
              console.log("[Facebook] Expanding scan scope within the same dialog/article...");
              const scopeRoot = container.closest('div[role="dialog"]') || container.closest('div[role="article"]') || container;
              const scopedCandidates = scopeRoot.querySelectorAll('img, [role="img"], [style*="background-image"], div[style*="background-image"]');
              scopedCandidates.forEach(scanElement);
              scanElement(scopeRoot);
            }

            console.log(`[Facebook] ตรวจพบภาพที่เข้าข่ายทั้งหมด: ${results.length} ใบ`);
            return results;
          };

          const deduplicateImages = (imgs) => {
            const unique = [];
            const seen = new Set();
            imgs.forEach(i => {
              if (!seen.has(i.src)) {
                unique.push(i);
                seen.add(i.src);
              }
            });
            return unique;
          };

          let allImages = deduplicateImages(findFbImages(postContainer, img));
          if (allImages.length === 0) allImages.push(img);
          showToast(`🎯 ตรวจพบ ${allImages.length} รูป! กำลังส่งเข้า Gemini...`, 3000);

          // Remove duplicated text patterns if FB repeats content
          if (postContent && postContent.length > 10) {
            const mid = Math.floor(postContent.length / 2);
            const p1 = postContent.substring(0, mid).trim();
            const p2 = postContent.substring(mid).trim();
            if (p1 === p2) postContent = p1;
          }

          // 3. Auto-click Comment button (to open composer)
          const allBtns = Array.from(postContainer.querySelectorAll('div[role="button"], span[role="button"], button, a[role="button"]'));
          let commentBtn = allBtns.find(el => {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase() || (el.title || '').toLowerCase();
            if (aria.includes('แสดงความคิดเห็น') || aria.includes('เขียนความคิดเห็น') || aria.includes('comment')) return true;
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            return text === 'ความคิดเห็น' || text === 'comment';
          });
          if (commentBtn) {
            commentBtn.click();
            console.log('[Facebook] Auto-clicked comment button.');
          }

          // 4. Load & Process Images Separately
          const loadedImgs = await Promise.all(allImages.map(imgNode => {
            return new Promise((resolve) => {
              const tempImg = new Image();
              tempImg.crossOrigin = "Anonymous";
              tempImg.onload = () => resolve(tempImg);
              tempImg.onerror = async () => {
                try {
                  // Enhanced fetch with permissions
                  const resp = await fetch(imgNode.src);
                  const blob = await resp.blob();
                  const reader = new FileReader();
                  reader.onloadend = () => {
                    const i2 = new Image();
                    i2.onload = () => resolve(i2);
                    i2.onerror = () => resolve(null);
                    i2.src = reader.result;
                  };
                  reader.readAsDataURL(blob);
                } catch (e) {
                  console.warn('Failed to load FB image:', imgNode.src);
                  resolve(null);
                }
              };
              tempImg.src = imgNode.src;
            });
          }));

          const validImgs = loadedImgs.filter(i => i !== null);
          const multiDataUrls = [];

          for (const vi of validImgs) {
            const c = document.createElement('canvas');
            c.width = vi.width;
            const padding = Math.max(180, Math.floor(vi.height * 0.12));
            c.height = vi.height + padding;
            const ctx = c.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, c.width, c.height);
            ctx.drawImage(vi, 0, 0);
            multiDataUrls.push(c.toDataURL('image/png'));
          }

          if (multiDataUrls.length > 0) {
            await chrome.storage.local.set({ 'pendingMultipleImages': multiDataUrls });
            await chrome.storage.local.set({ 'pendingClipboardPaste': true });
            // Also save the first image to clipboard so the user has something there if they paste manually
            await copyToClipboard(multiDataUrls[0]);
          }

          showToast('ส่งภาพแบบแยกไฟล์ไปยัง Gemini แล้ว!');
          chrome.runtime.sendMessage({ action: 'OPEN_GEMINI_FOR_PASTE', prompt: postContent });
          aiBtn.innerHTML = originalText;

        } catch (err) {
          if (err.message?.includes('Extension context invalidated')) {
            checkContext();
            aiBtn.innerHTML = 'REFRESH';
          } else {
            console.error('[Facebook] Multi-Image processing error:', err);
            aiBtn.innerHTML = 'ERR';
          }
        }
      };

      btnWrapper.appendChild(aiBtn);
      postContainer.appendChild(btnWrapper);
    });
  };

  setInterval(injectFacebookButtons, 2000);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'PREPARE_FOR_PASTE' && lastUsedPostContainer) {
      console.log('[Facebook] Received PREPARE_FOR_PASTE signal.');
      console.log('[Facebook] lastUsedPostContainer:', lastUsedPostContainer);

      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      const findComposer = () => {
        // 1. ค้นหาใน Post Container ก่อน
        let box = lastUsedPostContainer?.querySelector('div[role="textbox"][contenteditable="true"]')
          || lastUsedPostContainer?.querySelector('div[contenteditable="true"]')
          || lastUsedPostContainer?.querySelector('textarea');
        if (box) return box;

        const fallbackBox = lastUsedPostContainer?.querySelector('div[role="textbox"]');
        if (fallbackBox && fallbackBox.getAttribute('contenteditable') !== 'false') return fallbackBox;
        // 2. ถ้าหาไม่เจอใน Container (Facebook อาจจะแยกส่วน Comment ออกมาเป็น Sibling)
        // ให้ค้นหาทั้ง Document แทน โดยเลือกตัวที่เห็นชัดเจนบนหน้าจอ
        const allTextboxes = Array.from(document.querySelectorAll('div[role="textbox"], div[contenteditable="true"]'));
        console.log('[Facebook] Found', allTextboxes.length, 'textboxes in document');

        for (const tb of allTextboxes) {
          const rect = tb.getBoundingClientRect();
          // เช็คว่าปรากฏบนหน้าจอ และไม่ใช่ช่องแชตเล็กๆ หรือ search (มักจะมีความกว้างมากพอสมควร)
          if (rect.width > 100 && rect.height > 10) {
            const aria = (tb.getAttribute('aria-label') || '').toLowerCase();
            const text = (tb.innerText || '').toLowerCase();
            if (aria.includes('ความคิดเห็น') || aria.includes('comment') || aria.includes('ตอบ') || aria.includes('reply') || text.includes('ตอบ') || text.includes('ความคิดเห็น')) {
              console.log('[Facebook] Found comment composer by aria/text:', aria, text);
              return tb;
            }
          }
        }

        // 3. Last resort: เอา textbox ตัวแรกสุดที่ใหญ่พอจะน่าจะเป็น comment box
        for (const tb of allTextboxes) {
          const rect = tb.getBoundingClientRect();
          if (rect.width > 200 && rect.height > 15 && tb.getAttribute('contenteditable') !== 'false') {
            console.log('[Facebook] Found composer by size fallback:', rect.width, 'x', rect.height);
            return tb;
          }
        }

        console.warn('[Facebook] No composer found!');
        return null;
      };

      // หาจุดที่จะวางภาพ 1 ครั้ง เพื่อทำไฮไลต์ให้ผู้ใช้เห็นว่าเตรียมพร้อมแล้ว
      let pasteDetected = false;
      let originalTitle = document.title;
      const composer = findComposer();

      console.log('[Facebook] composer found:', !!composer);

      if (composer) {
        console.log('[Facebook] Entering composer highlight and handshake block');
        
        // --- ส่วนที่เพิ่ม: คำนวณพิกัดเพื่อส่งให้ Python ---
        // --- ส่วนที่ปรับปรุง: Live Tracking V2 (คำนวณพิกัดใหม่ทุกครั้งที่ส่งสัญญาณ) ---
        const titleUpdateInterval = setInterval(() => {
          if (pasteDetected) {
             clearInterval(titleUpdateInterval);
             return;
          }
          
          const dpr = window.devicePixelRatio || 1;
          const currentRect = composer.getBoundingClientRect();
          
          // คำนวณความสูงของแถบ Address Bar / Tab Bar (Header) แบบแม่นยำ
          // headerHeight (Screen pixels) = outerHeight - (innerHeight * dpr)
          // แต่เราต้องเผื่อขอบล่าง (Status bar) นิดหน่อย ประมาณ 8px ใน Windows
          const headerHeight = Math.max(0, window.outerHeight - (window.innerHeight * dpr) - 8);
          
          const liveX = Math.round(window.screenX + (currentRect.left + (currentRect.width / 2)) * dpr);
          const liveY = Math.round(window.screenY + headerHeight + (currentRect.top + (currentRect.height / 2)) * dpr);
          
          document.title = `${originalTitle} | READY_TO_PASTE|${liveX}|${liveY}`;
        }, 200);

        console.log(`[Handshake] Live Persistent Title tracking started...`);

        // แบนกรอบแดงเบาๆ ให้รู้ แต่อย่าเลื่อนหน้าจอ (scrollIntoView) มั่วซั่วเพื่อไม่ให้ผู้ใช้รำคาญ
        composer.style.outline = '5px solid #ff0000';
        composer.style.borderRadius = '8px';
        composer.style.boxShadow = '0 0 20px rgba(255, 0, 0, 0.8)';
        composer.focus();
        
        console.log('[Facebook] Highlight applied, showing toast');
        showToast('🚀 กำลังส่งพิกัดให้ Python แบบรัวๆ... (คลิกกล่องแดงถ้าเมาส์ไม่ขยับ)');

        // Click handler - paste และแชร์เมื่อคลิก (user gesture required for clipboard permission)
        const clickHandler = async () => {
          if (pasteDetected) return;
          clearInterval(titleUpdateInterval); // หยุดส่งพิกัดทันทีเมื่อเริ่มทำงาน
          pasteDetected = true;
          document.title = originalTitle; // คืนค่าชื่อหน้าต่าง
          const waitForImageUpload = () => {
            return new Promise((resolve) => {
              let stableCount = 0;
              const maxStableCount = 2; 
              const checkInterval = 500;
              let imageDetected = false;

              console.log('[Facebook] Waiting for image upload to complete...');

              const checkIntervalId = setInterval(() => {
                const form = composer.closest('form') || composer.closest('[role="region"]') || composer.parentElement;
                
                // 1. Better thumbnail detection
                let thumbnail = form?.querySelector('img[src*="blob:"], img[src*="http"], canvas') ||
                                composer.parentElement?.querySelector('img') ||
                                form?.querySelector('[role="presentation"] img');

                if (!thumbnail) {
                  const searchScope = composer.closest('[role="article"]') || composer.closest('[role="dialog"]') || document.body;
                  thumbnail = searchScope.querySelector('img[src*="blob:"], img[src*="http"], div[style*="background-image"]');
                }

                if (thumbnail && !imageDetected) {
                  console.log('[Facebook] Image detected in DOM, monitoring upload completion...');
                  imageDetected = true;
                }

                // 2. Check for upload indicators
                const isLoading =
                  form?.querySelector('[role="progressbar"]') ||
                  form?.querySelector('[aria-busy="true"]') ||
                  form?.querySelector('[data-visualcompletion="loading"]') ||
                  form?.innerHTML.includes('กำลัง') ||
                  form?.innerHTML.includes('uploading') ||
                  form?.innerHTML.includes('Loading');

                // 3. Submit button status
                const labels = ['โพสต์ความคิดเห็น', 'Post comment', 'ส่ง', 'Post', 'โพสต์'];
                let submitBtn = null;
                for (const l of labels) {
                  submitBtn = form?.querySelector(`div[aria-label="${l}"], div[role="button"][primary], [aria-label*="${l}"]`);
                  if (submitBtn) break;
                }
                const isBtnDisabled = submitBtn?.getAttribute('aria-disabled') === 'true' || submitBtn?.disabled;

                if (imageDetected && !isBtnDisabled && !isLoading) {
                  stableCount++;
                  console.log('[Facebook] Upload seems ready:', stableCount, '/', maxStableCount);
                } else if (!isBtnDisabled && !isLoading && stableCount >= 4) {
                  console.log('[Facebook] UI ready, proceeding even if image detection is ambiguous');
                  stableCount++;
                } else if (isLoading || isBtnDisabled) {
                  stableCount = 0; 
                } else {
                  stableCount++;
                }

                if (stableCount >= maxStableCount) {
                  clearInterval(checkIntervalId);
                  console.log('[Facebook] Image upload finished/stabilized, proceeding');
                  resolve();
                }
              }, checkInterval);

              // Timeout 15s
              setTimeout(() => {
                clearInterval(checkIntervalId);
                console.warn('[Facebook] Upload wait timeout or UI stuck, proceeding with best effort');
                resolve();
              }, 15000);
            });
          };

          try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
              const types = item.types || [];
              const imageType = types.find(t => typeof t === 'string' && t.startsWith('image/'));
              if (!imageType) continue;
              const blob = await item.getType(imageType);
              if (!blob || blob.size === 0) continue;

              const file = new File([blob], 'image.png', { type: blob.type || 'image/png' });
              const dt = new DataTransfer();
              dt.items.add(file);
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
              });
              composer.dispatchEvent(pasteEvent);
              console.log('[Facebook] Image pasted into composer');

              pasteDetected = true;
              composer.style.outline = '4px solid #22c55e';
              composer.style.borderRadius = '8px';
              showToast('⏳ วางภาพสำเร็จ! กำลังรออัปโหลด...');

              composer.removeEventListener('click', clickHandler);
              
              await waitForImageUpload();
              
              // บอก Python ว่ารูปโหลดเสร็จแล้ว พร้อมกดส่ง (Enter)
              document.title = `${originalTitle} | READY_TO_POST`;

              // Submit comment
              composer.focus();
              await new Promise(r => setTimeout(r, 600));

              // Find and click the real submit button
              const findSubmitBtn = () => {
                const form = composer.closest('form') || composer.closest('[role="article"]');
                const labels = ['โพสต์ความคิดเห็น', 'Post comment', 'ส่ง', 'Post'];
                for (const l of labels) {
                  const btn = form?.querySelector(`div[aria-label="${l}"], div[role="button"][primary]`);
                  if (btn) return btn;
                }
                return Array.from(form?.querySelectorAll('div[role="button"], button')).find(b => {
                   const txt = (b.innerText || '').toLowerCase();
                   const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
                   return labels.some(s => txt.includes(s.toLowerCase()) || lbl.includes(s.toLowerCase()));
                });
              };

              const actualBtn = findSubmitBtn();
              if (actualBtn && actualBtn.getAttribute('aria-disabled') !== 'true') {
                actualBtn.click();
                console.log('[Facebook] Comment submit button clicked');
              } else {
                // Fallback to Enter key
                composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                console.log('[Facebook] Fallback: Enter key pressed');
              }

              // Verification
              await new Promise(r => setTimeout(r, 1500));
              if (!document.body.contains(composer)) {
                showToast('✅ ส่งคอมเมนต์สำเร็จ');
              } else {
                await new Promise(r => setTimeout(r, 2000));
                if (!document.body.contains(composer)) {
                  showToast('✅ ส่งคอมเมนต์สำเร็จ');
                } else {
                  console.warn('[Facebook] Still visible, manual prompt');
                  showToast('⚠️ กรุณากดส่งหรือ Enter ด้วยตัวเอง');
                  composer.style.animation = 'pulse 1s infinite';
                }
              }

              // --- Auto-share process ---
              const startAutoShare = async () => {
                console.log('[Facebook] Starting auto share...');
                const messages = [
                  "ตัดต่อสำเร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "เรียบร้อยครับท่าน (ภาพอยู่ใต้คอมเมนต์)", "รีทัชให้เสร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)",
                  "แก้ไขเสร็จเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "ตัดต่อเสร็จแล้วครับ (ภาพอยู่ใต้คอมเมนต์)", "เรียบร้อยครับ (ภาพอยู่ใต้คอมเมนต์)",
                  "ทำเสร็จแล้วครับ (ภาพอยู่ใต้คอมเมนต์)", "รีทัชเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "แก้ภาพเสร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)",
                  "ตัดต่อรูปเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "แก้ไขภาพเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "ตัดต่อเรียบร้อยแล้ว (ภาพอยู่ใต้คอมเมนต์)",
                  "รีทัชเสร็จแล้วครับ (ภาพอยู่ใต้คอมเมนต์)", "แก้รูปเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "ทำภาพเสร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)",
                  "ตัดต่อเสร็จเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "รีทัชรูปเสร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)", "แก้ไขเสร็จแล้วครับ (ภาพอยู่ใต้คอมเมนต์)",
                  "ตัดต่อภาพเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "เรียบร้อยแล้วครับ (ภาพอยู่ใต้คอมเมนต์)", "รีทัชภาพเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)",
                  "แก้ไขรูปเสร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)", "ตัดต่อเสร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)", "จัดให้ครับ (ภาพอยู่ใต้คอมเมนต์)",
                  "รีทัชเสร็จเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "แก้ภาพเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "ตัดต่อรูปเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)",
                  "เรียบร้อยแล้ว (ภาพอยู่ใต้คอมเมนต์)", "รีทัชเสร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)", "แก้ไขเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)",
                  "ตัดต่อภาพเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "ทำรูปเสร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "รีทัชรูปสำเร็จ (ภาพอยู่ใต้คอมเมนต์)",
                  "แก้รูปเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "ตัดต่อสำเร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)", "ดั่งใจปรารถนา (ภาพอยู่ใต้คอมเมนต์)",
                  "รีทัชภาพเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "แก้ไขภาพเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "ตัดต่อเสร็จสิ้น (ภาพอยู่ใต้คอมเมนต์)",
                  "ทำเสร็จเรียบร้อย (ภาพอยู่ใต้คอมเมนต์)", "รีทัชสำเร็จครับ (ภาพอยู่ใต้คอมเมนต์)", "แก้สำเร็จแล้ว (ภาพอยู่ใต้คอมเมนต์)",
                  "ตัดต่อเสร็จทันใจ (ภาพอยู่ใต้คอมเมนต์)", "เรียบร้อยทันใจครับ (ภาพอยู่ใต้คอมเมนต์)", "รีทัชเสร็จทันใจ (ภาพอยู่ใต้คอมเมนต์)",
                  "แก้เสร็จทันใจครับ (ภาพอยู่ใต้คอมเมนต์)", "ฉันตัดต่อให้เร็วมากครับ (ภาพอยู่ใต้คอมเมนต์)", "เรียบร้อยไหมท่าร (ภาพอยู่ใต้คอมเมนต์)",
                  "รีทัชเร็วมากครับ (ภาพอยู่ใต้คอมเมนต์)", "แก้ให้แบบด่วนจี๋ (ภาพอยู่ใต้คอมเมนต์)"
                ];
                const randomMsg = "✅" + messages[Math.floor(Math.random() * messages.length)];

                const findShareBtn = () => {
                  const labels = ['ส่งลิงก์นี้ให้เพื่อนหรือโพสต์ลงในโปรไฟล์ของคุณ', 'Send this to a friend or post it on your profile', 'แชร์', 'Share'];
                  for (const label of labels) {
                    const btn = lastUsedPostContainer.querySelector(`div[aria-label="${label}"]`);
                    if (btn) return btn;
                  }
                  const svgPath = 'M2.203 21.011a0.5 0.5 0 0 1-0.203-0.411 1.487 1.487 0 0 1 0.322-0.907c1.789-2.31 4.542-5.748 10.707-6.527V8a1 1 0 0 1 1.707-0.707l8.293 8.293a1 1 0 0 1 0 1.414l-8.293 8.293A1 1 0 0 1 13 24.586v-5.167c-5.83 0.613-8.818 3.666-10.703 5.485a0.5 0.5 0 0 1-0.841-0.347 11.231 11.231 0 0 0 0.747-3.546z';
                  const svg = lastUsedPostContainer.querySelector(`path[d*="${svgPath.substring(0, 20)}"]`);
                  return svg?.closest('div[role="button"]');
                };

                const shareBtn = findShareBtn();
                if (!shareBtn) return;
                shareBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await new Promise(r => setTimeout(r, 400));
                shareBtn.click();

                let menuOpt = null;
                const menuLabels = ['แชร์ไปยังฟีด (อ่านเท่านั้น)', 'Share to Feed', 'แชร์เลย', 'Share now', 'แชร์ตอนนี้'];
                for (let i = 0; i < 15; i++) {
                  menuOpt = Array.from(document.querySelectorAll('div[role="button"], div[role="menuitem"], div[role="menu"] div'))
                      .find(el => {
                        const label = (el.getAttribute('aria-label') || '').toLowerCase();
                        const text = (el.innerText || '').toLowerCase();
                        return menuLabels.some(l => label.includes(l.toLowerCase()) || text.includes(l.toLowerCase()));
                      });
                  if (menuOpt) break;
                  await new Promise(r => setTimeout(r, 200));
                }

                if (menuOpt) menuOpt.click();

                let shareModal = null;
                for (let i = 0; i < 20; i++) {
                   const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).reverse();
                   shareModal = dialogs.find(d => {
                     return d.querySelector('[aria-label="แชร์เลย"], [aria-label="Share Now"], [aria-label="Share now"], [aria-label="โพสต์"]') ||
                            (d.innerText || '').includes('แชร์ไปที่ฟีด') || 
                            (d.innerText || '').includes('Share to Feed');
                   });
                   if (shareModal) break;
                   await new Promise(r => setTimeout(r, 350));
                }

                if (shareModal) {
                  let shareInput = null;
                  for (let i = 0; i < 15; i++) {
                    shareInput = shareModal.querySelector('div[role="textbox"]:not([aria-label])') || 
                                 shareModal.querySelector('div[role="textbox"]') || 
                                 shareModal.querySelector('[contenteditable="true"]') ||
                                 shareModal.querySelector('textarea, input[type="text"]');
                    if (shareInput) break;
                    await new Promise(r => setTimeout(r, 300));
                  }

                  if (shareInput) {
                    console.log('[Facebook] Focusing share input...');
                    shareInput.click();
                    await new Promise(r => setTimeout(r, 300));
                    shareInput.focus();
                    await new Promise(r => setTimeout(r, 200));

                    if (shareInput.tagName === 'INPUT' || shareInput.tagName === 'TEXTAREA') {
                      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set || 
                                           Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                      if (nativeSetter) nativeSetter.call(shareInput, randomMsg);
                      shareInput.value = randomMsg;
                      shareInput.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                      document.execCommand('insertText', false, randomMsg);
                      const currentText = shareInput.innerText || shareInput.textContent || '';
                      if (!currentText.includes(randomMsg)) {
                         console.log('[Facebook] Falling back to direct innerText');
                         shareInput.innerText = randomMsg;
                         shareInput.dispatchEvent(new Event('input', { bubbles: true }));
                      }
                    }
                    console.log('[Facebook] Share message entered');
                    await new Promise(r => setTimeout(r, 1000));
                    
                    const labels = ['แชร์เลย', 'Share now', 'โพสต์', 'Post', 'แชร์ตอนนี้', 'Share Now', 'ส่ง', 'Send'];
                    let submitBtn = null;
                    const findTheBtn = () => {
                      for (const label of labels) {
                        const lowerLabel = label.toLowerCase();
                        const btn = Array.from(shareModal.querySelectorAll('[role="button"], button, [aria-label]')).find(el => {
                          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                          const text = (el.innerText || el.textContent || '').toLowerCase();
                          return aria.includes(lowerLabel) || text.includes(lowerLabel);
                        });
                        if (btn && btn.getAttribute('aria-disabled') !== 'true') return btn;
                      }
                      return null;
                    };

                    for (let i = 0; i < 20; i++) {
                      submitBtn = findTheBtn();
                      if (submitBtn) break;
                      await new Promise(r => setTimeout(r, 400));
                    }

                    if (submitBtn) {
                      await new Promise(r => setTimeout(r, 500));
                      submitBtn.click();
                      console.log('[Facebook] Share button clicked successfully');
                      showToast(`🚀 แชร์เรียบร้อย!`);
                      document.title = originalTitle;
                    } else {
                      console.warn('[Facebook] Share button not found, trying Enter key');
                      shareInput.focus();
                      await new Promise(r => setTimeout(r, 100));
                      shareInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, ctrlKey: true, bubbles: true }));
                    }
                  }
                }
              };
              startAutoShare();
              return;
            }
          } catch (e) { console.warn('[Facebook] Error:', e); }
        };
        composer.addEventListener('click', clickHandler);
        console.log('[Facebook] Click handler attached to composer');

      } else {
        console.warn('[Facebook] Cannot highlight composer - not found');
      }

      // Timeout: ลบขอบแดงหลัง 40 วินาทีถ้าไม่มี paste
      setTimeout(() => {
        if (!pasteDetected) {
          const composer = findComposer();
          if (composer) composer.style.outline = '';
          console.log('[Facebook] Paste timeout - no image detected');
        }
      }, 40000);
    }
  });
}


// --- Crop Mode Logic ---
function startCropMode(initX, initY) {
  if (!checkContext()) return;
  if (document.getElementById('gemini-crop-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'gemini-crop-overlay';
  overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 2147483647; cursor: crosshair;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(2px);
    `;

  const cropBox = document.createElement('div');
  cropBox.style.cssText = `
        position: absolute; border: 3px dashed #ff0000;
        background: rgba(255, 0, 0, 0.05);
        box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);
        display: block; pointer-events: none;
        left: ${initX}px; top: ${initY}px; width: 0px; height: 0px;
    `;
  overlay.appendChild(cropBox);
  document.body.appendChild(overlay);

  let isDrawing = true;
  let x1 = initX, y1 = initY;

  const onMouseMove = (e) => {
    if (!isDrawing) return;
    let x2 = e.clientX;
    let y2 = e.clientY;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x1 - x2);
    const height = Math.abs(y1 - y2);
    cropBox.style.left = left + 'px';
    cropBox.style.top = top + 'px';
    cropBox.style.width = width + 'px';
    cropBox.style.height = height + 'px';
  };

  const onMouseUp = async (e) => {
    if (!isDrawing) return;
    isDrawing = false;
    const rect = cropBox.getBoundingClientRect();
    if (rect.width < 5 || rect.height < 5) {
      overlay.remove();
      removeListeners();
      return;
    }
    overlay.style.background = 'transparent';
    cropBox.style.display = 'none';
    await new Promise(r => setTimeout(r, 100));
    chrome.runtime.sendMessage({
      action: 'CAPTURE_SCREEN_FOR_CROP', rect: {
        x: rect.left, y: rect.top, width: rect.width, height: rect.height,
        devicePixelRatio: window.devicePixelRatio
      }
    });
    overlay.remove();
    removeListeners();
  };

  const removeListeners = () => {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      removeListeners();
    }
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: #323232; color: white; padding: 12px 24px;
        border-radius: 24px; z-index: 2147483647; font-family: sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: opacity 0.5s;
    `;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 2000);
}

// --- Gemini Interaction Logic ---
if (isGeminiPage) {

  // --- Gemini Fast Download Logic ---
  const injectGeminiFastButtons = () => {
    // Target images in Gemini results
    const images = document.querySelectorAll('.image-button img:not(.fast-dl-processed), .result-image img:not(.fast-dl-processed), img[src*="googleusercontent.com"]:not(.fast-dl-processed)');
    
    images.forEach(img => {
      if (img.width < 100) return; // Skip small icons
      img.classList.add('fast-dl-processed');

      const container = img.closest('.image-button') || img.parentElement;
      if (!container) return;
      
      if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
      }

      const downloadOverlay = document.createElement('div');
      downloadOverlay.innerHTML = '⚡ Fast Download';
      downloadOverlay.style.cssText = `
        position: absolute; top: 10px; right: 10px;
        background: #22c55e; color: white; padding: 6px 12px;
        border-radius: 20px; font-size: 12px; font-weight: bold;
        cursor: pointer; z-index: 1000; box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        transition: transform 0.2s, background 0.2s;
        border: 1px solid white;
      `;
      
      downloadOverlay.onmouseover = () => { downloadOverlay.style.background = '#16a34a'; downloadOverlay.style.transform = 'scale(1.1)'; };
      downloadOverlay.onmouseout = () => { downloadOverlay.style.background = '#22c55e'; downloadOverlay.style.transform = 'scale(1)'; };

      downloadOverlay.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const originalText = downloadOverlay.innerHTML;
        downloadOverlay.innerHTML = '⏳ ...';
        
        let url = img.src;
        if (url.includes('googleusercontent.com')) {
          url = url.split('=')[0] + '=s0';
        }

        try {
          // Force PNG conversion via canvas to guarantee .png extension and quality
          const tempImg = new Image();
          tempImg.crossOrigin = "Anonymous";
          tempImg.onload = () => {
             const canvas = document.createElement('canvas');
             canvas.width = tempImg.width;
             canvas.height = tempImg.height;
             const ctx = canvas.getContext('2d');
             ctx.drawImage(tempImg, 0, 0);
             
             const pngDataUrl = canvas.toDataURL('image/png');
             showToast('🚀 Saving as complete.png & Continuing...');
             
             chrome.runtime.sendMessage({ 
               action: 'DOWNLOAD_AND_CLOSE', 
               url: pngDataUrl, // Send the PNG data URL instead of the remote URL
               filename: 'complete.png',
               imageContent: pngDataUrl 
             });
          };
          tempImg.onerror = () => {
             // Fallback if canvas fails
             chrome.runtime.sendMessage({ action: 'DOWNLOAD_AND_CLOSE', url: url, filename: 'complete.png' });
             downloadOverlay.innerHTML = originalText;
          };
          tempImg.src = url;
        } catch (err) {
          console.error('[Gemini] Fast download error:', err);
          chrome.runtime.sendMessage({ action: 'DOWNLOAD_AND_CLOSE', url: url, filename: 'complete.png' });
          downloadOverlay.innerHTML = originalText;
        }
      };

      container.appendChild(downloadOverlay);
    });
  };

  // Run automatically if requested via URL or for all images
  setInterval(injectGeminiFastButtons, 2000);

  // Check for auto-download trigger in URL
  if (window.location.search.includes('autoDownload=true')) {
    const autoDlInterval = setInterval(() => {
      const img = document.querySelector('.image-button img, .result-image img');
      if (img) {
        clearInterval(autoDlInterval);
        setTimeout(() => {
           let url = img.src;
           if (url.includes('googleusercontent.com')) url = url.split('=')[0] + '=s0';
           chrome.runtime.sendMessage({ action: 'DOWNLOAD_AND_CLOSE', url: url });
        }, 1500); // Give it a moment to load fully
      }
    }, 1000);
  }

  // Native high-quality download will be used handled by Gemini itself. 
  // We will listen for the download completion in background.js to trigger the original layer download.

  let isInjecting = false;
  const checkAndInjectAll = async () => {
    if (!checkContext()) return;
    if (isInjecting) return;
    const result = await new Promise(r => chrome.storage.local.get([
      'pendingClipboardPaste',
      'pendingGeminiPrompt',
      'pendingCollageData',
      'pendingMultipleImages',
      'lastOriginalImage'
    ], r));
    if (!result.pendingClipboardPaste && !result.pendingGeminiPrompt) return;

    isInjecting = true;
    try {
      // Clear only trigger flags immediately to prevent duplicate injections.
      // Keep payload keys until the end of this run.
      await new Promise(r => chrome.storage.local.remove([
        'pendingClipboardPaste',
        'pendingGeminiPrompt'
      ], r));

      let inputEl = null;
      for (let attempt = 0; attempt < 15; attempt++) {
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
        await new Promise(r => setTimeout(r, 300));
      }
      if (inputEl) {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        const getAttachmentCount = () => {
          // Heuristics: look for common "remove attachment" buttons / attachment chips.
          const selectors = [
            'button[aria-label*="Remove"]',
            'button[aria-label*="remove"]',
            'button[aria-label*="Delete"]',
            'button[aria-label*="delete"]',
            'button[aria-label*="ลบ"]',
            'button[aria-label*="ไฟล์"]',
            'button[aria-label*="รูป"]',
            '[data-testid*="attachment"]',
            '[data-testid*="Attachment"]',
            'img[src^="blob:"]'
          ];
          const set = new Set();
          for (const sel of selectors) {
            document.querySelectorAll(sel).forEach(n => set.add(n));
          }
          return set.size;
        };

        const waitForAttachmentIncrease = async (prevCount, timeoutMs = 8000) => {
          const start = Date.now();
          if (getAttachmentCount() > prevCount) return true;

          return await new Promise(resolve => {
            const timer = setInterval(() => {
              if (getAttachmentCount() > prevCount) {
                clearInterval(timer);
                if (observer) observer.disconnect();
                resolve(true);
              } else if (Date.now() - start > timeoutMs) {
                clearInterval(timer);
                if (observer) observer.disconnect();
                resolve(false);
              }
            }, 250);

            let observer = null;
            try {
              observer = new MutationObserver(() => {
                if (getAttachmentCount() > prevCount) {
                  clearInterval(timer);
                  observer.disconnect();
                  resolve(true);
                }
              });
              observer.observe(document.body, { childList: true, subtree: true });
            } catch {
              // ignore
            }
          });
        };

        const findSendBtn = () => {
          const composer = inputEl.closest('rich-textarea, .input-area, .composer-area') || inputEl.parentElement.parentElement;

          // 1. High-priority specific Gemini selectors
          const primarySelectors = [
            'button.send-button',
            'button[aria-label="Send message"]',
            'button[aria-label="ส่งข้อความ"]',
            'button[mattooltip="Send message"]',
            'button[mattooltip="ส่งข้อความ"]'
          ];

          for (const sel of primarySelectors) {
            const btn = composer.querySelector(sel) || (composer.parentElement && composer.parentElement.querySelector(sel));
            // Ensure we didn't get the toolbar button by mistake
            if (btn && !btn.classList.contains('toolbox-drawer-button')) return btn;
          }

          // 2. Fallback search (carefully filtered)
          const allButtons = Array.from(document.querySelectorAll('button:not([disabled])'));
          const composersButtons = allButtons.filter(b => {
            const rect = b.getBoundingClientRect();
            // Must be visible and in the bottom area
            return rect.width > 0 && rect.top > window.innerHeight / 2;
          });

          return composersButtons.find(b => {
            const label = (b.getAttribute('aria-label') || '').toLowerCase();
            const tooltip = (b.getAttribute('mattooltip') || '').toLowerCase();
            const html = (b.innerHTML || '').toLowerCase();
            const isSubmit = b.classList.contains('send-button') || b.type === 'submit';

            // Inclusion criteria
            const matchKeywords = label.includes('send') || label.includes('ส่ง') ||
              tooltip.includes('send') || tooltip.includes('ส่ง') ||
              html.includes('send-icon') || isSubmit;

            // Exclusion criteria (avoid tools, menus, and file uploads)
            const isWrongButton = label.includes('menu') || label.includes('เครื่องมือ') ||
              label.includes('แชร์') || b.classList.contains('toolbox-drawer-button') ||
              label.includes('upload') || label.includes('แนบ');

            return matchKeywords && !isWrongButton;
          });
        };

        const autoSubmitWhenReady = async (timeoutMs = 90000) => {
          const start = Date.now();
          for (; ;) {
            const btn = findSendBtn();
            // Button must not only exist but be ready
            if (btn && !btn.disabled) {
              console.log('[Gemini] Attempting submit via Enter key and button click.');

              // 1. Try the most natural way first: Enter key on the input
              inputEl.focus();
              const enterEvent = (type) => new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                bubbles: true, cancelable: true, view: window
              });
              inputEl.dispatchEvent(enterEvent('keydown'));
              inputEl.dispatchEvent(enterEvent('keypress'));
              inputEl.dispatchEvent(enterEvent('keyup'));

              // 2. Click the button just in case Keyboard event didn't trigger it
              await sleep(100);
              btn.click();
              return true;
            }
            if (Date.now() - start > timeoutMs) return false;
            await sleep(350);
          }
        };

        const isUploadingNow = () => {
          // Narrow check to the composer area to avoid false positives
          const composer = inputEl.closest('rich-textarea, .input-area, .composer-area') || inputEl.parentElement.parentElement;
          const txt = (composer?.innerText || '').toLowerCase();

          // Gemini specific uploading indicators
          const uploadingTexts = ['uploading', 'กำลังอัปโหลด', 'กำลังโหลด', 'wait', 'processing', 'กำลังเตรียม'];
          for (const t of uploadingTexts) {
            if (txt.includes(t)) return true;
          }

          // Check for progress indicators. Gemini often uses these for image uploads.
          const spinnerSelectors = [
            'mat-progress-spinner',
            'mat-spinner',
            '[role="progressbar"]',
            '.progress-bar',
            '.upload-progress',
            'svg[aria-label*="loading"]',
            'svg[aria-label*="Loading"]',
            '.loading-indicator'
          ];
          for (const sel of spinnerSelectors) {
            if (document.querySelector(sel) && composer.contains(document.querySelector(sel))) return true;
            if (composer.querySelector(sel)) return true;
          }

          // Check if any attached image thumbnails look like they are still loading (e.g. low opacity)
          const thumbnails = composer.querySelectorAll('img[src^="blob:"]');
          for (const thumb of thumbnails) {
            const opacity = window.getComputedStyle(thumb).opacity;
            if (opacity < 0.8) return true; // Gemini often dims images while uploading
          }

          return false;
        };

        const waitForAttachmentsToSettle = async (expectedCount = 0, quietMs = 2000, timeoutMs = 60000) => {
          const start = Date.now();
          let lastCount = getAttachmentCount();
          let lastChange = Date.now();

          console.log(`[Gemini] Waiting for ${expectedCount} attachments. Current: ${lastCount}`);

          for (; ;) {
            const nowCount = getAttachmentCount();
            if (nowCount !== lastCount) {
              console.log(`[Gemini] Count changed: ${lastCount} -> ${nowCount}`);
              lastCount = nowCount;
              lastChange = Date.now();
            }

            const elapsed = Date.now() - lastChange;
            const quietEnough = elapsed >= quietMs;
            const hasExpectedCount = (expectedCount === 0) || (nowCount >= expectedCount);

            const sendBtn = findSendBtn();
            // Important: If we have images, the button MUST be enabled. 
            // If it's disabled, Gemini is definitely still processing something.
            const sendReady = !!(sendBtn && !sendBtn.disabled);
            const uploading = isUploadingNow();

            if (hasExpectedCount && quietEnough && sendReady && !uploading) {
              console.log('[Gemini] Success: Settled and ready.');
              return true;
            }

            if (Date.now() - start > timeoutMs) {
              console.log(`[Gemini] Timeout. count=${nowCount}/${expectedCount}, quiet=${quietEnough}, ready=${sendReady}, uploading=${uploading}`);
              return false;
            }
            await sleep(300);
          }
        };

        const insertTextRobust = (text) => {
          if (!text) return;
          inputEl.focus();
          let ok = false;
          try {
            ok = document.execCommand('insertText', false, text);
          } catch {
            ok = false;
          }
          if (!ok) {
            try {
              inputEl.textContent = (inputEl.textContent || '') + text;
              inputEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
            } catch {
              // ignore
            }
          }
        };

        // Wait for React to fully bind event listeners on Gemini
        await sleep(700);
        inputEl.focus();

        // Phase 1: Paste Images
        const originalTitle = document.title;
        const updateTitle = () => {
          if (!inputEl) return;
          const dpr = window.devicePixelRatio || 1;
          const rect = inputEl.getBoundingClientRect();
          const headerHeight = Math.max(0, window.outerHeight - (window.innerHeight * dpr) - 8);
          const liveX = Math.round(window.screenX + (rect.left + rect.width / 2) * dpr);
          const liveY = Math.round(window.screenY + headerHeight + (rect.top + rect.height / 2) * dpr);
          document.title = `${originalTitle} | READY_TO_PASTE|${liveX}|${liveY}`;
        };
        const titleInterval = setInterval(updateTitle, 200);

        if (result.pendingClipboardPaste) {
          const filesToPaste = [];
          if (result.pendingMultipleImages && result.pendingMultipleImages.length > 0) {
            const blobs = await Promise.all(result.pendingMultipleImages.map(u => fetch(u).then(r => r.blob())));
            for (let i = 0; i < blobs.length; i++) {
              const blob = blobs[i];
              filesToPaste.push(new File([blob], `image_${i}.png`, { type: blob.type }));
            }
          } else if (result.pendingCollageData) {
            const resp = await fetch(result.pendingCollageData);
            const blob = await resp.blob();
            filesToPaste.push(new File([blob], "collage.jpg", { type: blob.type }));
          } else if (result.lastOriginalImage) {
            const resp = await fetch(result.lastOriginalImage);
            const blob = await resp.blob();
            filesToPaste.push(new File([blob], "image.png", { type: blob.type }));
          }

          if (filesToPaste.length > 0) {
            console.log(`[Gemini] Pasting ${filesToPaste.length} images...`);
            const bulkDt = new DataTransfer();
            filesToPaste.forEach(f => bulkDt.items.add(f));
            inputEl.focus();
            inputEl.dispatchEvent(new ClipboardEvent('paste', { clipboardData: bulkDt, bubbles: true, cancelable: true }));

            // Wait for images to appear and settle BEFORE adding text
            const expectedCount = filesToPaste.length;
            await waitForAttachmentsToSettle(expectedCount, 2500, 40000);
          }
        }

        // Phase 2: Insert Text
        if (result.pendingGeminiPrompt && result.pendingGeminiPrompt.text) {
          const textToInsert = ' ' + result.pendingGeminiPrompt.text;
          console.log('[Gemini] Inserting text prompt...');
          insertTextRobust(textToInsert);
          // Wait a bit for React to sync text state
          await sleep(100);
        }

        // Phase 3: Final Settle and Submit
        // Ensure everything (images + text) is absolutely ready
        let expectedCountFinal = 0;
        if (result.pendingMultipleImages) expectedCountFinal = result.pendingMultipleImages.length;
        else if (result.pendingCollageData || result.lastOriginalImage) expectedCountFinal = 1;

        const settled = await waitForAttachmentsToSettle(expectedCountFinal, 50, 20000);
        if (settled) {
          await sleep(50); // Tiny extra pause for UI stability
          const ok = await autoSubmitWhenReady(15000);
          console.log(`[Gemini] Final Submit: ${ok ? 'success' : 'timeout'}`);
          if (!ok) showToast('⚠️ กรุณากดปุ่มส่งเองนะครับ');
        } else {
          showToast('⚠️ รูปโหลดไม่ทัน กรุณากดส่งเองนะครับ');
        }

        clearInterval(titleInterval);
        document.title = originalTitle;

        // Clear storage AFTER we're done reading it (avoid losing multiple images)
        await new Promise(r => chrome.storage.local.remove([
          'pendingCollageData',
          'pendingMultipleImages',
          'lastOriginalImage'
        ], r));
      }
    } catch (err) { console.error('Injection error:', err); }
    finally { isInjecting = false; }
  };
  chrome.storage.onChanged.addListener((changes) => {
    if (!chrome.runtime?.id) return;
    if (changes.pendingClipboardPaste || changes.pendingGeminiPrompt) checkAndInjectAll();
  });
  checkAndInjectAll();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'CLIPBOARD_COPY') {
    copyToClipboard(message.dataUrl).then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'CROP_AND_COPY') {
    cropAndCopy(message.dataUrl, message.rect).then(() => {
      chrome.runtime.sendMessage({ action: 'OPEN_GEMINI_FOR_PASTE' });
      sendResponse({ success: true });
    });
    return true;
  } else if (message.action === 'FORCE_DOWNLOAD') {
    fetch(message.dataUrl)
      .then(res => res.blob())
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = message.filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error('[Gemini] Proxy download failed:', err);
        sendResponse({ success: false });
      });
    return true;
  }
});

async function cropAndCopy(dataUrl, rect) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const dpr = rect.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      const imgHeight = rect.height * dpr;
      const padding = Math.max(180, Math.floor(imgHeight * 0.12));
      canvas.height = imgHeight + padding;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, rect.x * dpr, rect.y * dpr, rect.width * dpr, rect.height * dpr, 0, 0, rect.width * dpr, imgHeight);
      const croppedDataUrl = canvas.toDataURL('image/png');
      await copyToClipboard(croppedDataUrl);
      showToast('Copied to clipboard! Sending to Gemini...');
      resolve();
    };
    img.src = dataUrl;
  });
}

async function copyToClipboard(dataUrl) {
  try {
    chrome.storage.local.set({ 'lastOriginalImage': dataUrl });
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  } catch (err) { console.error('Clipboard error:', err); }
}

// --- External Ad Tasks Automation & SSL Bypassing ---
const handleExternalAdTasks = () => {
  if (window.location.hostname.includes('faucetcrypto.com')) return;
  if (window.location.hostname.includes('google.com')) return;

  // Handle "Your connection is not private" (Advanced -> Proceed)
  if (document.getElementById('details-button') || document.body.textContent.includes('NET::ERR_CERT')) {
    console.log('[ExternalBot] Detected SSL/Privacy warning. Attempting bypass...');
    const advancedBtn = document.getElementById('details-button');
    if (advancedBtn) advancedBtn.click();
    setTimeout(() => {
      const proceedLink = document.getElementById('proceed-link');
      if (proceedLink) proceedLink.click();
    }, 1000);
  }

  // Detect and click "Start View Ad" or similar buttons
  const buttons = Array.from(document.querySelectorAll('button, a, .btn'));
  const startAdBtn = buttons.find(el => {
    const txt = el.textContent.trim().toLowerCase();
    return (txt === 'start view ad' || txt === 'start view' || txt.includes('view ad') || txt === 'start') &&
      el.offsetParent !== null && !el.dataset.autoClicked;
  });

  if (startAdBtn) {
    console.log('[ExternalBot] Found Start Ad button. Clicking in 2s...');
    startAdBtn.dataset.autoClicked = 'true';
    startAdBtn.style.border = '5px solid red';
    setTimeout(() => {
      startAdBtn.click();
    }, 2000);
  }
};
setInterval(handleExternalAdTasks, 5000);
