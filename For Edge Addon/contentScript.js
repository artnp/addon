{
  let isGeminiPage = window.location.hostname === 'gemini.google.com';
  let isFastworkChat = window.location.hostname === 'chat.fastwork.co';
  let isFacebook = window.location.hostname.includes('facebook.com');
  let isFbBusinessInbox = window.location.hostname === 'business.facebook.com' && window.location.pathname.startsWith('/latest/inbox');

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


  // --- Fastwork Chat AI Button Logic ---
  if (isFastworkChat) {
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

      autoCheckSubmitAgreement();
    }, 2000);
  }









  // --- Facebook Business Inbox Auto-Order Macro ---
  if (window.location.hostname === 'business.facebook.com' || isFbBusinessInbox) {

    // ฟังก์ชันส่งข้อความ "💵 มาชำระเงินกันเลย" แล้วกด Enter ส่ง
    let paymentMessageSent = false; // guard ป้องกันส่งซ้ำ
    const sendPaymentMessage = () => {
      if (paymentMessageSent) {
        console.log('[FB Order] ข้อความแจ้งชำระเงินถูกส่งไปแล้ว ข้ามซ้ำ');
        return;
      }
      paymentMessageSent = true;
      console.log('[FB Order] กำลังส่งข้อความแจ้งชำระเงิน...');
      const msgText = '💵 มาชำระเงินกันเลย';

      let sendAttempts = 0;
      const trySendMessage = setInterval(() => {
        sendAttempts++;

        // หา textbox ในพื้นที่ compose (contenteditable div)
        const textbox = document.querySelector('div[role="textbox"][contenteditable="true"]');
        if (!textbox) {
          if (sendAttempts > 30) { // 15 วินาที
            clearInterval(trySendMessage);
            paymentMessageSent = false; // reset เผื่อครั้งหน้า
            console.warn('[FB Order] หา textbox ไม่เจอ หยุดรอ');
          }
          return;
        }

        clearInterval(trySendMessage);

        // Focus แล้วพิมพ์ข้อความ
        textbox.focus();

        // ล้างเนื้อหาเดิมก่อน (ถ้ามี)
        textbox.innerHTML = '';

        // ใส่ข้อความใหม่ผ่าน insertText (ให้ React/FB รับรู้ event)
        // execCommand('insertText') จะ fire input event เองอยู่แล้ว ห้าม dispatch ซ้ำ!
        document.execCommand('insertText', false, msgText);

        console.log('[FB Order] พิมพ์ข้อความเรียบร้อย กำลังกด Enter ส่ง...');

        // รอให้ FB ประมวลผลข้อความสักครู่ แล้วกด Enter เพื่อส่ง
        setTimeout(() => {
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          textbox.dispatchEvent(enterEvent);
          console.log('[FB Order] ✅ กด Enter ส่งข้อความเรียบร้อย!');
          if (typeof showToast === 'function') showToast('💸 ส่งข้อความแจ้งชำระเงินแล้ว');
          // reset guard หลังส่งสำเร็จ เพื่อให้คำสั่งซื้อถัดไปส่งได้
          setTimeout(() => { paymentMessageSent = false; }, 2000);
        }, 300);
      }, 500);
    };

    const fillAndSubmitOrder = () => {
      console.log('Started FB Auto Order Flow (Triggered by ฿ click)');

      const submitCheckInterval = window.fbOrderSubmitInterval;
      if (submitCheckInterval) clearInterval(submitCheckInterval);
      if (window.fbOrderWaitInterval) clearInterval(window.fbOrderWaitInterval);

      let waitAttempts = 0;
      // วนลูปเช็คทุกๆ 500ms เป็นเวลาสูงสุด 10 วินาที เพื่อรอให้ Modal โหลดเสร็จ (เผื่อเน็ตช้า)
      window.fbOrderWaitInterval = setInterval(() => {
        waitAttempts++;
        let amountInput = null;

        // 1. ค้นหาแบบกวาดกว้าง หาจากกล่อง Dialog ที่เปิดอยู่
        const dialogs = document.querySelectorAll('div[role="dialog"]');
        let activeDialog = dialogs.length > 0 ? dialogs[dialogs.length - 1] : document;

        // 2. พยายามหาจาก Label (คำว่า จำนวน หรือ Amount)
        const possibleLabels = Array.from(activeDialog.querySelectorAll('span, div, label')).filter(el => {
          const t = (el.textContent || '').trim();
          return t === 'จำนวน' || t === 'Amount';
        });

        for (const label of possibleLabels) {
          // ถอยขึ้นไปชั้นบนแล้วค้นหา input
          let parent = label.parentElement;
          for (let i = 0; i < 4; i++) {
            if (!parent) break;
            const input = parent.querySelector('input[type="number"]') || parent.querySelector('input');
            if (input && input.getBoundingClientRect().width > 0) {
              amountInput = input;
              if (waitAttempts === 1) console.log('Found input by label proximity');
              break;
            }
            parent = parent.parentElement;
          }
          if (amountInput) break;
        }

        // 3. Fallback หาจาก input type="number" รวบยอดใน Dialog
        if (!amountInput) {
          amountInput = activeDialog.querySelector('input[type="number"]');
          if (amountInput && waitAttempts === 1) console.log('Found input by type="number"');
        }

        // 4. Fallback ใช้ input ตัวที่ 2 ที่พิมพ์ได้
        if (!amountInput) {
          const modalInputs = Array.from(activeDialog.querySelectorAll('input')).filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && el.type !== 'hidden' && el.type !== 'radio' && el.type !== 'checkbox';
          });
          amountInput = modalInputs.length >= 2 ? modalInputs[1] : modalInputs[0];
          if (amountInput && waitAttempts === 1) console.log('Found input by index fallback');
        }

        if (amountInput) {
          // เจอช่องกรอกแล้ว! หยุดรอ
          clearInterval(window.fbOrderWaitInterval);
          console.log('Target Input HTML:', amountInput.outerHTML);

          amountInput.focus();
          amountInput.click();

          // รอให้ focus ติดก่อนยัดค่า
          setTimeout(() => {
            try {
              // ล้างค่าเก่าและยัดค่าใหม่
              amountInput.value = "";

              // React 16+ Value Tracker Hack
              let lastValue = amountInput.value;
              amountInput.value = "60";
              let tracker = amountInput._valueTracker;
              if (tracker) {
                tracker.setValue(lastValue);
              }

              // Native Setter
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
              if (nativeInputValueSetter) {
                nativeInputValueSetter.call(amountInput, "60");
              }

              // Dispatch Events อย่างรุนแรงเพื่อให้ React รู้ว่ามีการพิมพ์
              const inputEvent = new Event('input', { bubbles: true });
              // จำลอง property บางอย่างของ event เผื่อโค้ดดักจับ
              inputEvent.simulated = true;
              amountInput.dispatchEvent(inputEvent);
              amountInput.dispatchEvent(new Event('change', { bubbles: true }));

            } catch (e) {
              console.error("Error setting React value:", e);
            }

            console.log('Filled amount: 60');

            // ดึง Focus ออกเพื่อให้ OnBlur ทำงาน (บางฟอร์มเซฟค่าตอน Blur)
            amountInput.blur();

            // รอเช็คปุ่มกดยืนยัน (ส่งคำสั่งซื้อ)
            let submitAttempts = 0;
            window.fbOrderSubmitInterval = setInterval(() => {
              submitAttempts++;
              const buttons = Array.from(activeDialog.querySelectorAll('div[role="button"], button'));
              const submitBtn = buttons.find(btn => {
                const txt = (btn.innerText || '').trim();
                // ต้องเป็น "ส่งคำสั่งซื้อ" หรือ "Send Order" แบบตรงๆ ห้ามจับ "ส่ง" เปล่าๆ (ปุ่มส่งข้อความ)
                return txt === 'ส่งคำสั่งซื้อ' || txt === 'Send Order' || txt === 'Create Order' || txt === 'สร้างคำสั่งซื้อ';
              });

              if (submitBtn) {
                const isDisabled = submitBtn.getAttribute('aria-disabled') === 'true' || submitBtn.disabled;
                if (!isDisabled) {
                  clearInterval(window.fbOrderSubmitInterval); // หยุด interval ก่อนทำอะไรอื่น
                  submitBtn.click();
                  console.log("Clicked Submit Order!");
                  if (typeof showToast === 'function') showToast('ส่งคำสั่งซื้อ 60 บาท เรียบร้อยแล้ว (Auto)');

                  // ✅ หลังส่งคำสั่งซื้อแล้ว รอ dialog ปิด แล้วส่งข้อความแจ้งชำระเงิน
                  setTimeout(() => {
                    sendPaymentMessage();
                  }, 100);
                } else {
                  console.log("Submit button found but still disabled...");
                }
              }

              if (submitAttempts > 20) { // รอได้นานสุด 8 วินาที
                clearInterval(window.fbOrderSubmitInterval);
                console.log("Stop waiting for submit button.");
              }
            }, 400);

          }, 300);

        } else {
          // ยังหาไม่เจอ
          if (waitAttempts >= 20) { // รอได้นานสุด 10 วินาที (20 * 500ms)
            clearInterval(window.fbOrderWaitInterval);
            console.warn('หาฟอร์มช่องกรอกราคาสินค้าไม่เจอ หลังจากรอ 10 วินาที');
            if (typeof showToast === 'function') showToast('หาช่องกรอกราคาสินค้าไม่เจอ! หน้าเว็บอาจโหลดช้าไป');
          }
        }
      }, 500); // เช็คทุก 0.5 วินาที
    };

    // ใช้ Event Delegation จับการคลิกบนหน้าเว็บแบบครอบคลุม (Capture Phase)
    // ⚠️ ต้องจำกัดขอบเขตให้เฉพาะปุ่ม ฿ ที่อยู่ใน toolbar ของ compose area เท่านั้น
    //    ห้ามไปจับปุ่ม "ดูคำสั่งซื้อ", "ชำระเงินแล้ว" ที่อยู่ใน bubble ข้อความ
    document.addEventListener('click', (e) => {
      const target = e.target;

      // === ขั้นตอนที่ 1: ตรวจสอบว่าอยู่ในเขต compose toolbar หรือไม่ ===
      // compose toolbar คือบริเวณที่มี textbox อยู่ด้วย
      // ปุ่ม ฿ ของ compose จะมี aria-label = "สร้างคำสั่งซื้อ" หรือ "Create order"

      // หาปุ่มที่ตรงกับ aria-label ของปุ่มสร้างคำสั่งซื้อ (เฉพาะ "สร้าง" / "Create")
      let bahtBtn = target.closest(
        '[aria-label="สร้างคำสั่งซื้อ"], [aria-label="Create order"], [aria-label="Create Order"]'
      );

      // Fallback: ถอยขึ้นไปสูงสุด 4 ชั้น เพื่อจับกรณี icon/svg ข้างใน
      if (!bahtBtn) {
        let cur = target;
        for (let i = 0; i < 4 && cur && cur.tagName; i++) {
          const ariaLabel = (cur.getAttribute('aria-label') || '').trim();
          if (ariaLabel === 'สร้างคำสั่งซื้อ' || ariaLabel === 'Create order' || ariaLabel === 'Create Order') {
            bahtBtn = cur;
            break;
          }
          cur = cur.parentElement;
        }
      }

      // === ขั้นตอนที่ 2: ยืนยันว่าปุ่มนี้อยู่ใกล้ textbox (compose area) จริงๆ ===
      if (bahtBtn) {
        // ตรวจว่าใน parent container เดียวกันมี textbox อยู่ (ป้องกันการจับปุ่มผิดที่)
        const composeParent = bahtBtn.closest('form') || bahtBtn.parentElement?.parentElement?.parentElement?.parentElement;
        const hasTextbox = composeParent ? !!composeParent.querySelector('div[role="textbox"]') : false;

        // ถ้าหา textbox ไม่เจอในบริเวณใกล้ ให้ลองตรวจสอบอีกทีว่าปุ่มนี้ไม่ได้อยู่ใน bubble ข้อความ
        const isInsideChatBubble = !!bahtBtn.closest('div[class*="message"]') && !hasTextbox;

        if (isInsideChatBubble) {
          console.log('[FB Order] ข้ามปุ่มนี้: อยู่ใน chat bubble ไม่ใช่ปุ่มสร้างคำสั่งซื้อ');
          return;
        }

        console.log('✅ ตรวจพบการกดปุ่ม ฿ (สร้างคำสั่งซื้อ)! จะเริ่มขั้นตอนหลังจากกล่องเปิด...');
        // ให้ลบโค้ดเดิมที่อาจค้างอยู่ออกก่อน เพื่อป้องกันการรันซ้ำ
        if (window.fbOrderSubmitInterval) clearInterval(window.fbOrderSubmitInterval);
        fillAndSubmitOrder();
      }
    }, true);
  }

  // --- Facebook AI Logic ---
  if (isFacebook) {
    let lastUsedPostContainer = null;

    // --- Hide posts with comments disabled (Highly Optimized) ---
    const checkAndHideArticle = (article) => {
      // Prevent repeated checks
      if (article.dataset.fbCommentChecked === 'true') return;

      // 1. Auto-click 'ดูเพิ่มเติม' (See more) before scanning text
      const seeMoreBtns = Array.from(article.querySelectorAll('div[role="button"]')).filter(b => {
        const t = (b.innerText || '').trim();
        return t === 'ดูเพิ่มเติม' || t === 'See more';
      });

      if (seeMoreBtns.length > 0) {
        let clickedAny = false;
        seeMoreBtns.forEach(b => {
          if (!b.dataset.autoExpanded) {
            b.dataset.autoExpanded = 'true';
            b.click();
            clickedAny = true;
          }
        });
        // If we just clicked to expand, delay the final check so DOM can update.
        // The MutationObserver will likely re-trigger this anyway, but we return to avoid premature marking.
        if (clickedAny) return;
      }

      const text = article.innerText || '';
      let shouldHide = false;
      let hideReason = '';

      const spamKeywords = [
        'คิวว่าง', 'รับตัดต่อ', 'ราคาเพียง', 'สอบถามได้', 'เริ่มต้นแค่',
        'ฝากร้าน', 'เปิดรับ', 'สนใจสอบถาม', 'รับประกัน', 'สร้างรายได้',
        'สอบถามเพิ่มเติม', 'รับทำ', 'รีวิว', 'บริการ', 'เน็ตบ้าน',
        'อินเตอร์เน็ตบ้าน', 'สนใจทักแชท'
      ];
      const foundSpam = spamKeywords.find(kw => text.includes(kw));

      const hasVideo = !!article.querySelector('video');

      if (text.includes('ปิดการแสดงความคิดเห็น')) {
        shouldHide = true;
        hideReason = 'Found "ปิดการแสดงความคิดเห็น" text';
      } else if (foundSpam) {
        shouldHide = true;
        hideReason = `Found spam/selling keyword: "${foundSpam}"`;
      } else if (hasVideo) {
        shouldHide = true;
        hideReason = 'Post is a video';
      } else if (text.length > 50) {
        // Evaluate buttons if there is enough text to assume the DOM is reasonably populated
        const allBtns = Array.from(article.querySelectorAll('div[role="button"], span[role="button"], button, a[role="button"]'));

        if (allBtns.length > 0) {
          let hasCommentBtn = false;
          let hasShareCount = false;

          // 1. Check for Comment button presence
          for (const el of allBtns) {
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const elText = (el.innerText || '').toLowerCase();

            if (aria.includes('แสดงความคิดเห็น') || aria.includes('เขียนความคิดเห็น') || aria.includes('comment') || elText.includes('แสดงความคิดเห็น') || elText.includes('comment')) {
              hasCommentBtn = true;
              break;
            }
          }

          // 2. Check for Share count >= 1
          const pText = text.replace(/,/g, '');

          // Text based match: "2 แชร์", "แชร์ 1 ครั้ง", "1 share"
          if (pText.match(/\d+[KkMmพันหมื่นแสนล้าน]*\s*(?:แชร์|shares?|รายการแชร์)/i) ||
            pText.match(/(?:แชร์|share)\s*\d+[KkMmพันหมื่นแสนล้าน]*/i)) {
            hasShareCount = true;
          }

          // Aria based match + Action button innerText check
          if (!hasShareCount) {
            const ariaEls = article.querySelectorAll('[aria-label]');
            for (const el of Array.from(ariaEls)) {
              const aria = (el.getAttribute('aria-label') || '').toLowerCase();

              // Identify if this element is related to sharing
              if (aria.includes('แชร์') || aria.includes('share') || aria.includes('ส่งลิงก์นี้ให้เพื่อน')) {
                // Check if the aria-label itself has a number (e.g. "แชร์ 1 ครั้ง")
                if (/\d+/.test(aria)) {
                  hasShareCount = true;
                  break;
                }

                // Check if the button itself or its container has a number
                const currentText = el.innerText.trim();
                const parentText = el.parentElement ? el.parentElement.innerText.trim() : '';

                if (/\d/.test(currentText) || /\d/.test(parentText)) {
                  hasShareCount = true;
                  break;
                }
              }
            }
          }

          // SVG-based match (fallback)
          if (!hasShareCount) {
            const svgs = article.querySelectorAll('svg');
            for (const svg of Array.from(svgs)) {
              if (svg.innerHTML.includes('M2.203 21.011a0.5')) {
                const btn = svg.closest('div[role="button"]');
                if (btn && /\d/.test(btn.innerText.trim())) {
                  hasShareCount = true;
                  break;
                } else {
                  const parent = svg.parentElement?.parentElement;
                  if (parent && /\d/.test(parent.innerText.trim())) {
                    hasShareCount = true;
                    break;
                  }
                }
              }
            }
          }

          if (!hasCommentBtn) {
            shouldHide = true;
            hideReason = 'No Comment button found (Comments disabled)';
          }

          if (hasShareCount) {
            shouldHide = true;
            hideReason = 'Post has shares (>= 1)';
          }
        } else {
          // Not enough buttons loaded -> FB is still rendering
          return;
        }
      }

      if (shouldHide) {
        article.style.display = 'none';
        console.log(`[Facebook] Hidden post. Reason: ${hideReason}`);
        article.dataset.fbCommentChecked = 'true';
      } else if (text.length > 50) {
        article.dataset.fbCommentChecked = 'true';
      }
    };

    // Use a lightweight delayed check so it doesn't block the main thread while scrolling
    let fbScrollTimeout;
    const scanArticlesLightweight = () => {
      // Run on:
      //  1. https://www.facebook.com/  (หน้า Feed หลัก)
      //  2. https://www.facebook.com/?filter=groups&sk=h_chr  (Feed กลุ่ม)
      const isMainFeed = window.location.hostname === 'www.facebook.com' && window.location.pathname === '/';
      const isGroupsFeed = window.location.search.includes('filter=groups') && window.location.search.includes('sk=h_chr');
      if (!isMainFeed && !isGroupsFeed) {
        return;
      }

      const articles = document.querySelectorAll('div[role="article"]:not([data-fb-comment-checked="true"])');
      articles.forEach(checkAndHideArticle);
    };

    // 1. Observe when large chunks of DOM are injected
    const hideDisabledObserver = new MutationObserver((mutations) => {
      let shouldScan = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) {
        clearTimeout(fbScrollTimeout);
        fbScrollTimeout = setTimeout(scanArticlesLightweight, 400); // 400ms debounce
      }
    });

    hideDisabledObserver.observe(document.body, { childList: true, subtree: true });
    scanArticlesLightweight();

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

        let hoverTimer = null;
        let hasAutoClicked = false;

        aiBtn.onmouseover = () => {
          aiBtn.style.background = '#f2a900';
          aiBtn.style.transform = 'scale(1.1)';

          if (!hasAutoClicked) {
            hoverTimer = setTimeout(() => {
              if (!hasAutoClicked) {
                hasAutoClicked = true;
                aiBtn.click();
              }
            }, 2000);
          }
        };

        aiBtn.onmouseout = () => {
          aiBtn.style.background = '#fbbc04';
          aiBtn.style.transform = 'scale(1)';
          if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
          hasAutoClicked = false;
        };

        aiBtn.onclick = async (e) => {
          if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
            hasAutoClicked = true; // Mark as clicked to prevent auto-click if manual click happened
          }

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

              // สร้าง fingerprint จาก URL เพื่อเทียบรูปซ้ำ (ตัด query params ของ FB CDN ออก)
              const getFbUrlFingerprint = (src) => {
                if (!src) return '';
                try {
                  const url = new URL(src);
                  // FB CDN URLs: ใช้ pathname เป็นตัวระบุเพราะ query params จะเปลี่ยนตาม size/token
                  if (url.hostname.includes('fbcdn.net') || url.hostname.includes('facebook.com')) {
                    return url.pathname;
                  }
                  return src;
                } catch {
                  return src;
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
                  const fp = getFbUrlFingerprint(src);
                  if (seenSrcs.has(fp)) return; // รูปเดียวกันแต่ URL ต่าง size → ข้าม
                  const low = src.toLowerCase();
                  if (low.includes('emoji') || low.includes('static.xx.fbcdn')) return;
                  results.push({ src, w: rect.width, h: rect.height });
                  seenSrcs.add(src);
                  seenSrcs.add(fp);
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
                // เทียบทั้ง exact URL และ fingerprint (pathname without query params)
                let fp = i.src;
                try {
                  const url = new URL(i.src);
                  if (url.hostname.includes('fbcdn.net') || url.hostname.includes('facebook.com')) {
                    fp = url.pathname;
                  }
                } catch { }
                if (!seen.has(i.src) && !seen.has(fp)) {
                  unique.push(i);
                  seen.add(i.src);
                  seen.add(fp);
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
              multiDataUrls.push(c.toDataURL('image/jpeg', 0.92));
            }

            if (multiDataUrls.length > 0) {
              await chrome.storage.local.set({ 'pendingMultipleImages': multiDataUrls, 'pendingClipboardPaste': true });
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
          // --- ฟังก์ชันสร้างข้อความโปรโมทร้านแบบ หลบฟิลเตอร์สแปม FB (ลดความฮาร์ดเซลล์) ---
          const generatePromoText = () => {
            const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

            // ========== POOL 1: เปิดประโยคแบบดูเป็นมิตร ==========
            const prefix1Pool = [
              'อันนี้งานกุศลทำให้ฟรี',
              'อันนี้ช่วยทำให้ฟรีเลยนะ',
              'รูปนี้ฉันแต่งให้ฟรี',
              'ภาพนี้เสกให้ฟรีเลย',
              'ฉันจัดการให้ฟรีนะคะ',
              'ทำให้ฟรีๆ เลยจ้าโพสต์นี้',
              'รูปนี้ฉันจัดให้ฟรี',
              'อันนี้ไม่คิดตังค์เลย',
              'ฟรีๆ ช่วยๆ กันจ้า',
              'ทำให้ฟรีไม่มีค่าใช้จ่ายนะ',
              'งานนี้ทำให้ฟรีๆ เน้อ',
              'ภาพนี้จัดให้ฟรีจ้า',
              'ไม่คิดตังนะ อันนี้',
              'งานนี้ฉันทำการกุศล',
              'จัดไปฟรีๆเลยจ้า',
              'งานนี้ฉันทำให้เธอฟรี',
              'อันนี้ช่วยฟรี',
            ];

            // ========== POOL 2: ชวนคุยแบบเนียนๆ (หลีกเลี่ยง "สั่งงาน" / "รับทำ") ==========
            const prefix2Pool = [
              'แต่ถ้ามีภาพยากๆอยากให้ช่วย',
              'แต่ถ้าอยากได้แบบเนียนๆเพิ่ม',
              'ถ้ามีงานไหนอยากให้ช่วยอีก',
              'ถ้าชอบและอยากให้ช่วยอีก',
              'สนใจอยากได้แบบไหนเพิ่มเติม',
              'ใครอยากได้แบบเป๊ะๆทักได้',
              'ถ้าต้องการงานเนียนๆ',
              'ใครอยากแก้ไขจุดไหนเพิ่มอีก',
              'ถ้าชอบแนวนี้และมีรูปอื่นอีก',
              'มีรูปไหนแก้ยากๆโยนมาได้นะ',
              'ถ้ามีรูปสำคัญๆอยากให้ช่วยดู',
              'ถ้าอยากปรับแต่งแบบเต็มสตรีม',
              'สนใจให้ช่วยดูแลรูปอื่น',
              'ถ้าถูกใจและอยากส่งมาอีก',
              'งานละเอียดๆก็แวะมาได้',
              'ต้องการให้อัพเกรดรูปไหนอีก',
            ];

            // ========== POOL 3: บริการ (ใช้คำที่เป็นธรรมชาติผสมคีย์เวิร์ด) ==========
            const servicePool = [
              'ตัดต่อรูป',
              'ตัดต่อภาพ',
              'รีทัชรูป',
              'รีทัชภาพ',
              'แก้ไขภาพด่วน',
              'ลบคนแปลกหน้าออก',
              'เปลี่ยนฉากหลังเนียนๆ',
              'ซ่อมรูปภาพเก่า',
              'ปรับหน้าชัดหลังเบลอ',
              'ทำภาพคมชัด',
              'แก้ไขรูปให้เป๊ะ',
              'ซ่อมรูปพัง',
              'ปรับแสงแต่งสี',
              'ตกแต่งรูปโปรไฟล์',
              'แก้ภาพแตก',
              'แก้รูปเบลอเบลอให้ใส',
              'ลบริ้วรอย',
              'ลบสิวหน้าใส',
              'เปลี่ยนสีผมแบบเนียนๆ',
              'แก้ไขจุดบกพร่องในรูป',
              'เนรมิตภาพให้สวยปัง',
              'ปรับสีภาพให้ละมุน',
              'แต่งรูปคุมโทน',
              'ย้ายคนไปฉากอื่น',
              'ต่อเติมภาพที่ขาดหาย',
              'ลบถังขยะหรือสายไฟ',
              'แก้ตาพริบให้ลืมตา',
              'ซ่อมรูปฉีกขาดรอยพับ',
              'แต่งหน้าเติมปาก',
              'ไดคัทตัดขอบภาพ',
              'เปลี่ยนท้องฟ้าใสๆ',
              'ลบเงาสะท้อนกระจก',
              'เพิ่มแสงสว่างรูปมืด',
              'รวมสองรูปเข้าด้วยกัน',
              'ทำภาพแต่งสวยๆ',
              'ลบรอยสักเนียนๆ',
              'ทำภาพขาวดำเป็นสี',
              'ไดคัทเปลี่ยนพื้นหลัง',
              'บีบรูปให้ดูผอมเพรียว',
              'แต่งผิวให้ดูเนียนกริบ',
              'ปรับเปลี่ยนชุดเสื้อผ้า',
              'ดึงรูปที่เบลอให้ชัดขึ้น',
              'เปลี่ยนฉากเป็นวิวสวยๆ',
            ];

            // ========== POOL 4: ราคาแบบซอฟต์เซลล์ (หลบคำว่า ราคา, บาท) ==========
            // ใช้เทคนิค: ค่าขนม, ค่ากาแฟ, 6O (O ตัวโอ), ฿, บ.
            const suffix1Pool = [
              'ค่าขนมหนูแค่ 6O บ.',
              'เลี้ยงค่ากาแฟหน่อย 60บ.',
              'รบกวนค่ากาแฟ 6O.- เท่านั้น',
              'แค่ 60 บ.',
              'เพียง 6O.-',
              'สนับสนุนกันแค่ 6O฿',
              'เบาๆ หกสิบ บ.',
              'ช่วยค่าไฟแค่ 6O',
              'แค่หกสิบเองงับ',
              'เพียงหกสิบบ.',
              'เริ่มแค่ 6O บ.',
              'งบแค่หกสิบ',
              'เบาๆ แค่ 60.-',
              'ช่วยค่าน้ำใจแค่ 6O฿',
              'ขอค่าเหนื่อย 6O.-',
              'ซับพอร์ตกันแค่หกสิบ',
            ];

            // ========== POOL 5: CTA แบบไม่ใช้ "ติดต่อหน้าร้าน" ==========
            const suffix2Pool = [
              'จิ้มโปรไฟล์ทักแชทมาเลยจร้า',
              'ทัก inbox มาคุยกันนะ',
              'ส่งข้อความมาหาฉันได้เลย',
              'inbox มาคุยกันได้ตลอด',
              'ทักแชตมาหาเราได้จ้า',
              'แวะมาทักข้อความได้นะ',
              'จิ้มแชทมาเลยจ้า',
              'ส่งดีเอ็มมาหาได้เลย',
              'ทักมาบอกส่วนตัวได้เลยงับ',
              'ทักข้อความมาหาได้เลย',
              'อินบอกซ์มาโลด',
              'สะกิดแชทมาได้เลย',
              'เคาะแชทมาเลยจ้า',
              'ยินดีตอบใน inbox จ้า',
              'พิมพ์ในแชทมาได้เลยนะ',
              'แวะมาคุยกันหลังไมค์ได้',
            ];

            // ========== POOL 6: Emoji ==========
            const emojiPool = [
              '😊', '🥰', '😍', '💖', '✨', '🌟', '💫', '🎨', '🖌️', '🎯',
              '✌️', '🤟', '🤩', '😘', '💕', '🙏', '❤️', '🔥', '⭐', '💎',
              '🎁', '🌈', '🎉', '🎊', '👏', '💐', '🌸', '🌺', '💗', '🥳'
            ];

            // ========== POOL 7: Connectors ==========
            const connectorPool = [
              ', ', ' ~ ', '!! ', ' — ', ' ', '.. ', ' จ้า ',
            ];

            // ========== BUILD THE SENTENCE ==========
            const p1 = pick(prefix1Pool);
            const conn1 = pick(connectorPool);
            const p2 = pick(prefix2Pool);

            // เลือก service 1-2 ตัวเพื่อความธรรมชาติ
            const shuffled = [...servicePool].sort(() => Math.random() - 0.5);
            const numServices = Math.random() < 0.6 ? 1 : 2;
            const services = shuffled.slice(0, numServices).join(', ');

            const conn2 = pick(connectorPool);
            const s1 = pick(suffix1Pool);
            const conn3 = pick(connectorPool);
            const s2 = pick(suffix2Pool);

            // เลือก Emoji 1-3 ตัว
            const numEmoji = Math.floor(Math.random() * 3) + 1;
            const emojis = [...emojiPool].sort(() => Math.random() - 0.5).slice(0, numEmoji).join('');

            // จัดเรียงเป็นประโยคสมบูรณ์
            const sentence = `${p1}${conn1}${p2}${services} ${s1}${conn2}${s2} ${emojis}`;

            console.log('[Facebook] Generated promo text:', sentence);
            return sentence;
          };

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

                // === ใส่ข้อความโปรโมทร้านก่อนวางภาพ (ทำงานเร็วขึ้น) ===
                const promoText = generatePromoText();
                composer.focus();
                document.execCommand('insertText', false, promoText);
                console.log('[Facebook] Promo text inserted:', promoText);

                // เว้นระยะนิดนึงให้ React อัปเดต DOM ก่อนวางรูป
                await new Promise(r => setTimeout(r, 200));

                composer.dispatchEvent(pasteEvent);
                console.log('[Facebook] Image pasted into composer');

                pasteDetected = true;
                composer.style.outline = '4px solid #22c55e';
                composer.style.borderRadius = '8px';
                showToast('⏳ พิมพ์ข้อความและวางภาพสำเร็จ! กำลังรออัปโหลด...');

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
                    "แก้เสร็จทันใจครับ (ภาพอยู่ใต้คอมเมนต์)", "ฉันตัดต่อให้เร็วมากครับ (ภาพอยู่ใต้คอมเมนต์)", "เรียบร้อยไหมท่าน (ภาพอยู่ใต้คอมเมนต์)",
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
    const injectGeminiFastButtons = async () => {
      if (!checkContext()) return;
      const { lastSource } = await new Promise(r => chrome.storage.local.get('lastSource', r));

      // 1. หาภาพที่ควรเพิ่มปุ่ม (ต้องอยู่ในพื้นที่หลัก ไม่ใช่ sidebar)
      const chatArea = document.querySelector('main, .chat-content, .conversation-container, #chat-window') || document.body;
      const images = chatArea.querySelectorAll('.image-button img, .result-image img, img[src*="googleusercontent.com"]');

      let autoClickTriggered = false;

      images.forEach(img => {
        // ถ้าเคย process แล้ว ให้เช็คก่อนว่าปุ่มยังอยู่ไหม (กรณี React ลบ DOM ทิ้งแต่ reuse img element)
        const container = img.closest('.image-button') || img.parentElement;
        if (!container) return;

        const hasButton = container.querySelector('.fast-dl-button');
        if (img.classList.contains('fast-dl-processed') && hasButton) return;

        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;

        // ★ จุดแก้สำคัญ: ถ้ากว้างเป็น 0 แสดงว่ารูปยังโหลดไม่เสร็จ ห้ามมาร์ค processed ห้ามข้าม
        // ให้กลับมาเช็คใหม่ในรอบถัดไป (Interval 2s)
        if (w === 0 || h === 0) return;

        // ข้ามรูปขนาดเล็ก (icons/history thumbs)
        if (w < 150 || h < 150) {
          img.classList.add('fast-dl-processed');
          return;
        }

        // ข้ามถ้ารูปอยู่ใน Sidebar
        if (img.closest('nav, .side-nav, #side-nav-container, [role="navigation"]')) {
          img.classList.add('fast-dl-processed');
          return;
        }

        // ถ้ามีปุ่มอยู่แล้ว แต่มันไม่มี class (เช่น พึ่งเรนเดอร์ใหม่) ให้เพิ่ม class แล้วจบ
        if (hasButton) {
          img.classList.add('fast-dl-processed');
          return;
        }

        img.classList.add('fast-dl-processed');
        if (getComputedStyle(container).position === 'static') {
          container.style.position = 'relative';
        }

        const downloadOverlay = document.createElement('div');
        downloadOverlay.className = 'fast-dl-button';
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
          if (e) { e.preventDefault(); e.stopPropagation(); }
          const originalText = downloadOverlay.innerHTML;
          downloadOverlay.innerHTML = '⏳ ...';

          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const pngDataUrl = canvas.toDataURL('image/png');
            if (pngDataUrl.length > 100) {
              showToast('🚀 Saving as complete.png...');
              chrome.runtime.sendMessage({ action: 'DOWNLOAD_AND_CLOSE', url: pngDataUrl, filename: 'complete.png' });
              downloadOverlay.innerHTML = originalText;
              return;
            }
          } catch (canvasErr) { }

          let url = img.src;
          if (url.includes('googleusercontent.com')) url = url.split('=')[0] + '=s0';
          chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_BLOB', url: url }, (response) => {
            if (response && response.dataUrl) {
              showToast('🚀 Saving via Proxy...');
              chrome.runtime.sendMessage({ action: 'DOWNLOAD_AND_CLOSE', url: response.dataUrl, filename: 'complete.png' });
            } else {
              chrome.runtime.sendMessage({ action: 'DOWNLOAD_AND_CLOSE', url: url, filename: 'complete.png' });
            }
            downloadOverlay.innerHTML = originalText;
          });
        };

        container.appendChild(downloadOverlay);

        // ★ AUTO-CLICK: เฉพาะโหมด Facebook และ เฉพาะรูปแรกที่เจอในรอบนี้
        if (lastSource === 'fb' && !autoClickTriggered) {
          console.log('[Gemini] Auto-downloading first detected image...');
          autoClickTriggered = true;
          setTimeout(() => downloadOverlay.click(), 1500);
        }
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
        'lastOriginalImage',
        'recoveryGeminiData'
      ], r));
      if (!result.pendingClipboardPaste && !result.pendingGeminiPrompt) return;

      isInjecting = true;
      try {
        // Clear ALL trigger flags immediately to prevent duplicate injections.
        // We already saved the prompt text to savedPromptText, so it's safe to clear storage now.
        await new Promise(r => chrome.storage.local.remove([
          'pendingClipboardPaste',
          'pendingGeminiPrompt'
        ], r));

        // Save prompt data locally before anything else (so we have it even if storage changes)
        const savedPromptText = (result.pendingGeminiPrompt && result.pendingGeminiPrompt.text) ? result.pendingGeminiPrompt.text : null;

        // Helper: find the actual editable element inside Gemini's Quill-based rich-textarea
        const findGeminiInput = () => {
          // Strategy 1: Direct .ql-editor (Quill editor - most reliable for Gemini)
          const qlEditor = document.querySelector('div.ql-editor[role="textbox"], div.ql-editor.textarea');
          if (qlEditor) return qlEditor;

          // Strategy 2: rich-textarea with Shadow DOM
          const richTextareas = document.querySelectorAll('rich-textarea');
          for (const rt of richTextareas) {
            if (rt.shadowRoot) {
              const inner = rt.shadowRoot.querySelector('div.ql-editor, div[contenteditable="true"], [role="textbox"]');
              if (inner) return inner;
            }
            // Also try without shadow root
            const inner = rt.querySelector('div.ql-editor, div[contenteditable="true"]');
            if (inner) return inner;
          }

          // Strategy 3: Generic contenteditable / textbox (fallback)
          const editables = Array.from(document.querySelectorAll('div[contenteditable="true"], [role="textbox"]'));
          const candidates = editables.filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && el.offsetParent !== null;
          }).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
          if (candidates.length > 0) return candidates[0];

          return null;
        };

        let inputEl = null;
        for (let attempt = 0; attempt < 15; attempt++) {
          inputEl = findGeminiInput();
          if (inputEl) break;
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
                console.log('[Gemini] Attempting submit via Enter key.');

                // 1. Try the most natural way first: Enter key on the input
                inputEl.focus();
                const enterEvent = (type) => new KeyboardEvent(type, {
                  key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                  bubbles: true, cancelable: true, view: window
                });
                inputEl.dispatchEvent(enterEvent('keydown'));
                inputEl.dispatchEvent(enterEvent('keypress'));
                inputEl.dispatchEvent(enterEvent('keyup'));
                return true;
              }
              if (Date.now() - start > timeoutMs) return false;
              await sleep(150);
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
              await sleep(150);
            }
          };

          const reFindInputEl = () => findGeminiInput() || inputEl;

          const insertTextRobust = async (text, targetEl) => {
            if (!text) return false;
            let el = targetEl || inputEl;

            // Click + focus to ensure element is interactive
            el.click();
            await sleep(80);
            el.focus();
            await sleep(80);

            // Re-find after click (React may swap elements)
            const fresh = findGeminiInput();
            if (fresh && fresh !== el) {
              console.log('[Gemini] Element changed after click, using fresh reference');
              el = fresh;
              el.focus();
              await sleep(50);
            }

            const checkInserted = () => (el.innerText || el.textContent || '').includes(text.trim().substring(0, 20));

            // Strategy 1: DataTransfer Paste (simulates Ctrl+V)
            try {
              const dt = new DataTransfer();
              dt.setData('text/plain', text);
              const pasteEvent = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: dt
              });
              el.dispatchEvent(pasteEvent);
              await sleep(100);
              if (checkInserted()) { console.log('[Gemini] Text via DataTransfer paste ✓'); return true; }
            } catch (e) { console.warn('[Gemini] DataTransfer paste failed:', e); }

            // Strategy 2: execCommand insertText (works with Quill)
            try {
              el.focus();
              await sleep(50);
              // Place cursor at end
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false); // collapse to end
              selection.removeAllRanges();
              selection.addRange(range);
              document.execCommand('insertText', false, text);
              await sleep(100);
              if (checkInserted()) { console.log('[Gemini] Text via execCommand ✓'); return true; }
            } catch (e) { console.warn('[Gemini] execCommand failed:', e); }

            // Strategy 3: InputEvent (beforeinput + input)
            try {
              el.focus();
              el.dispatchEvent(new InputEvent('beforeinput', {
                inputType: 'insertText',
                data: text,
                bubbles: true,
                cancelable: true
              }));
              el.dispatchEvent(new InputEvent('input', {
                inputType: 'insertText',
                data: text,
                bubbles: true
              }));
              await sleep(100);
              if (checkInserted()) { console.log('[Gemini] Text via InputEvent ✓'); return true; }
            } catch (e) { console.warn('[Gemini] InputEvent failed:', e); }

            // Strategy 4: Clipboard API + execCommand paste
            try {
              await navigator.clipboard.writeText(text);
              el.focus();
              await sleep(50);
              document.execCommand('paste');
              await sleep(100);
              if (checkInserted()) { console.log('[Gemini] Text via Clipboard paste ✓'); return true; }
            } catch (e) { console.warn('[Gemini] Clipboard paste failed:', e); }

            // Strategy 5: Direct innerHTML append for Quill (use <p> tag)
            try {
              // Quill uses <p> tags internally
              const p = document.createElement('p');
              p.textContent = text;
              el.appendChild(p);
              // Remove ql-blank class to show content
              el.classList.remove('ql-blank');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              await sleep(100);
              if (checkInserted()) { console.log('[Gemini] Text via Quill DOM append ✓'); return true; }
            } catch (e) { console.warn('[Gemini] Quill DOM append failed:', e); }

            // Strategy 6: textContent last resort
            try {
              el.textContent = (el.textContent || '') + text;
              el.classList.remove('ql-blank');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              await sleep(80);
            } catch (e) { }

            const finalResult = checkInserted();
            console.log('[Gemini] Final text insertion result:', finalResult);
            return finalResult;
          };

          // Wait for React to fully bind event listeners on Gemini
          await sleep(300);
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
              console.log(`[Gemini] Attempting to paste ${filesToPaste.length} images...`);
              const expectedCount = filesToPaste.length;

              for (let retry = 0; retry < 3; retry++) {
                inputEl.focus();
                inputEl.click(); // Force interaction
                await sleep(100);

                const bulkDt = new DataTransfer();
                filesToPaste.forEach(f => bulkDt.items.add(f));
                inputEl.dispatchEvent(new ClipboardEvent('paste', { clipboardData: bulkDt, bubbles: true, cancelable: true }));

                const success = await waitForAttachmentsToSettle(expectedCount, 800, 5000); // Short wait for each attempt
                if (success) {
                  console.log('[Gemini] Paste confirmed!');
                  break;
                }
                console.warn(`[Gemini] Paste retry ${retry + 1}/3...`);
              }

              // Final longer wait to ensure everything is absolutely ready
              await waitForAttachmentsToSettle(expectedCount, 500, 20000);
            }
          }

          // Phase 2: Insert Text
          // Use saved prompt data (from initial read) OR re-fetch as fallback
          let promptTextToUse = savedPromptText;
          if (!promptTextToUse) {
            const latestDataEdge = await new Promise(r => chrome.storage.local.get('pendingGeminiPrompt', r));
            if (latestDataEdge.pendingGeminiPrompt && latestDataEdge.pendingGeminiPrompt.text) {
              promptTextToUse = latestDataEdge.pendingGeminiPrompt.text;
            }
          }
          if (promptTextToUse) {
            const textToInsert = ' ' + promptTextToUse;
            console.log('[Gemini] Inserting text prompt:', textToInsert.substring(0, 50) + '...');

            // Re-find input element (React may have re-rendered after image paste)
            const freshInputEl = reFindInputEl();
            if (freshInputEl !== inputEl) {
              console.log('[Gemini] Input element refreshed after image paste');
              inputEl = freshInputEl;
            }

            // Check if text is ALREADY present (e.g. from a previous injection attempt)
            const alreadyPresent = (inputEl.innerText || inputEl.textContent || '').includes(promptTextToUse.trim().substring(0, 20));

            // Try insertion with retries (only if not already present)
            let textInserted = alreadyPresent;
            if (alreadyPresent) {
              console.log('[Gemini] Text already present in input, skipping insertion');
            }
            for (let textRetry = 0; textRetry < 3 && !textInserted; textRetry++) {
              if (textRetry > 0) {
                console.log(`[Gemini] Text insertion retry ${textRetry + 1}/3...`);
                inputEl = reFindInputEl();
                await sleep(200);
              }
              textInserted = await insertTextRobust(textToInsert, inputEl);
            }

            if (!textInserted) {
              console.warn('[Gemini] All text insertion strategies failed!');
            }

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
            const initialResponseCount = document.querySelectorAll('message-content, .model-response, [data-author="model"], ui-markdown').length;
            const ok = await autoSubmitWhenReady(15000);
            console.log(`[Gemini] Final Submit: ${ok ? 'success' : 'timeout'}`);
            if (!ok) {
              showToast('⚠️ กรุณากดปุ่มส่งเองนะครับ');
            } else {
              // Successfully sent. Record recovery data and monitor
              const recoData = {
                prompt: { text: promptTextToUse, timestamp: Date.now() },
                images: result.pendingMultipleImages || (result.lastOriginalImage ? [result.lastOriginalImage] : []),
                retries: (result.recoveryGeminiData ? result.recoveryGeminiData.retries : 0) + 1
              };
              await new Promise(r => chrome.storage.local.set({ 'recoveryGeminiData': recoData }, r));

              let monitorTimer;
              const checkFail = () => {
                let isRefusal = false;
                let isFalsePositive = false;

                // 1. Check for floating modals or generic page text updates indicating a quota limit
                const bodyText = (document.body.innerText || '').toLowerCase();
                const hasLimitModal = [
                  'คุณสร้างรูปภาพถึงขีดจำกัดแล้ว',
                  'ขีดจำกัดจะรีเซ็ต',
                  'reached your image generation limit'
                ].some(kw => bodyText.includes(kw.toLowerCase()));

                if (hasLimitModal) {
                  isRefusal = true;
                } else {
                  // 2. Check standard AI chat responses
                  const responses = document.querySelectorAll('message-content, .model-response, [data-author="model"], ui-markdown');
                  if (responses.length > initialResponseCount) {
                    const lastResp = responses[responses.length - 1];
                    const text = (lastResp.innerText || '').toLowerCase();
                    if (text.length > 10) {
                      isRefusal = [
                        'โควต้า', 'quota', 'ขีดจำกัด', 'limit',
                        'สร้างรูปภาพไม่ได้', 'สร้างรูปภาพไม่ได้แล้ว', 'ไม่สามารถสร้าง',
                        "can't generate images", "cannot generate", "unable to generate",
                        "can't create", 'ตอนนี่ฉันสร้างรูปภาพไม่ได้', 'ตอนนี้ฉันสร้างรูปภาพไม่ได้',
                        'คุณสร้างรูปภาพถึงขีดจำกัดแล้ว'
                      ].some(kw => text.includes(kw));

                      isFalsePositive = ['นโยบาย', 'บุคคล', 'people', 'policy', 'safety', 'หน้าคน'].some(kw => text.includes(kw));

                      if (!isRefusal && text.length > 50) {
                        clearInterval(monitorTimer);
                        chrome.storage.local.remove(['recoveryGeminiData']);
                        return;
                      }
                    }
                  } else {
                    return; // Wait for either modal or new response
                  }
                }

                if (isRefusal && !isFalsePositive) {
                  clearInterval(monitorTimer);
                  if (recoData.retries >= 4) {
                    showToast('❌ หมดโควต้าครบทุกบัญชีแล้ว! แนะนำให้พักการใช้งานบัญชีเหล่านี้');
                    chrome.storage.local.remove(['recoveryGeminiData']);
                    return;
                  }
                  showToast('⚠️ ระบบแจ้งว่าสร้างภาพไม่ได้ กำลังสลับบัญชีใหม่ให้และส่งซ้ำ ทันที...');
                  setTimeout(() => {
                    chrome.runtime.sendMessage({ action: 'RETRY_NEXT_ACCOUNT', payload: recoData });
                  }, 2000);
                }
              };
              monitorTimer = setInterval(checkFail, 1000);
              setTimeout(() => { clearInterval(monitorTimer); chrome.storage.local.remove(['recoveryGeminiData']); }, 45000);
            }
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


  async function copyToClipboard(dataUrl) {
    try {
      chrome.storage.local.set({ 'lastOriginalImage': dataUrl });
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch (err) { console.error('Clipboard error:', err); }
  }
}

// --- Bridge for AI Hub (Local File via DOM Events for Security) ---
document.addEventListener('HUB_TO_EXTENSION', (event) => {
  const { action, requestId, ...payload } = event.detail;
  chrome.runtime.sendMessage({ action, origin: window.location.origin, ...payload }, (response) => {
    const responseEvent = new CustomEvent('EXTENSION_TO_HUB', {
      detail: { requestId, payload: response }
    });
    document.dispatchEvent(responseEvent);
  });
});


