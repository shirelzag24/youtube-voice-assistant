/**
 * YouTube Voice Control - Content Script v2.8 (Bulletproof Keep-Alive Version)
 * פתרון סופי לבעיית התעייפות הלולאה באמצעות Keep-Alive Interval, 
 * ניקוי זיכרון אגרסיבי ומערך מילות הפעלה גמיש ברעשי רקע.
 */

(function () {
  'use strict';

  let mainOverlay        = null;
  let floatingBtn        = null;
  let tooltipEl          = null;
  let wakeRecognition    = null;
  let commandRecognition = null;
  let activeListening    = false;
  let dismissTimer       = null;
  let wakeLoopEnabled    = false;
  let videoWasPaused     = false;
  let savedMuted         = false;
  let keepAliveInterval  = null; // שומר הראש שמוודא שהלולאה לעולם לא תירדם

  const COMMAND_TIMEOUT_MS  = 10000;
  const WAKE_RESTART_MS      = 300;
  const COMMAND_DEBOUNCE_MS = 400;
  const TOOLTIP_KEY         = 'ytVoiceTooltipShown_v7';

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  function waitForPlayer() {
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (player) {
      injectButton();
      watchNavigation();

      // מעקף חסימת דפדפן בקליק ראשון
      document.body.addEventListener('click', function initOnFirstClick() {
        console.log("[YTVoice] קליק ראשון זוהה. מתניע מערכת האזנה יציבה...");
        wakeLoopEnabled = true;
        startWakeLoop();
        
        // טריק ה-Keep-Alive: כל 2.5 שניות בודקים באופן אקטיבי שהלולאה לא קפאה
        if (!keepAliveInterval) {
          keepAliveInterval = setInterval(() => {
            if (wakeLoopEnabled && !activeListening && !wakeRecognition) {
              console.log("[Keep-Alive] זיהה שהלולאה נרדמה או נחסמה, מחייה אותה מחדש...");
              startWakeLoop();
            }
          }, 2500);
        }
        
        document.body.removeEventListener('click', initOnFirstClick);
      }, { once: true });

    } else {
      setTimeout(waitForPlayer, 700);
    }
  }

  function watchNavigation() {
    new MutationObserver(() => {
      if (!document.querySelector('.yt-voice-floating-btn')) injectButton();
    }).observe(document.body, { childList: true, subtree: true });
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', waitForPlayer)
    : waitForPlayer();

  // ─── Button ───────────────────────────────────────────────────────────────────
  function injectButton() {
    if (document.querySelector('.yt-voice-floating-btn')) return;
    const player = document.querySelector('#movie_player, .html5-video-player');
    if (!player) return;

    floatingBtn = document.createElement('button');
    floatingBtn.className = 'yt-voice-floating-btn yt-voice-control-btn';
    floatingBtn.title = 'עוזר קולי';
    floatingBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6
                 c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5
                 c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31 6-6.72h-1.7z"/>
      </svg>
      <span>עוזר קולי</span>`;

    floatingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!wakeLoopEnabled) wakeLoopEnabled = true;
      openVoiceOverlay();
    });

    const rc = player.querySelector('.ytp-right-controls');
    if (rc) rc.prepend(floatingBtn);
    else player.appendChild(floatingBtn);

    if (!localStorage.getItem(TOOLTIP_KEY)) showTooltip(player);
  }

  // ─── Tooltip ──────────────────────────────────────────────────────────────────
  function showTooltip(container) {
    if (tooltipEl) return;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'yt-voice-tooltip';
    tooltipEl.innerHTML = `
      <div class="yt-voice-tooltip-arrow"></div>
      <p class="yt-voice-tooltip-text">
        👋 פשוט לחץ איפשהו בעמוד ואז אמור<br>
        <strong>״היי יוטיוב״</strong> או <strong>״עוזר קולי״</strong><br>
        בלי לגעת במסך!
      </p>
      <div class="yt-voice-tooltip-actions">
        <button class="yt-voice-tooltip-dismiss">הבנתי!</button>
      </div>`;
    container.style.position = 'relative';
    container.appendChild(tooltipEl);
    tooltipEl.querySelector('.yt-voice-tooltip-dismiss').addEventListener('click', dismissTooltip);
    setTimeout(dismissTooltip, 8000);
  }

  function dismissTooltip() {
    if (!tooltipEl) return;
    tooltipEl.style.opacity = '0';
    tooltipEl.style.transform = 'translateY(8px)';
    setTimeout(() => { tooltipEl?.remove(); tooltipEl = null; }, 500);
    localStorage.setItem(TOOLTIP_KEY, '1');
  }

  // ─── Overlay DOM ──────────────────────────────────────────────────────────────
  function ensureOverlayDOM() {
    if (mainOverlay) return;
    
    const player = document.querySelector('#movie_player, .html5-video-player');
    
    mainOverlay = document.createElement('div');
    mainOverlay.className = 'yt-voice-overlay';
    mainOverlay.innerHTML = `
      <button class="yt-voice-close-x" title="סגור חלונית">✕</button>
      
      <div class="yt-voice-overlay-content">
        <div class="yt-voice-mic-container">
          <div class="yt-voice-mic-glow"></div>
          <svg class="yt-voice-mic-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6
                     c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7
                     11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.49 6-3.31
                     6-6.72h-1.7z"/>
          </svg>
        </div>
        <div class="yt-voice-waveform">
          ${Array(9).fill('<div class="yt-voice-wave-bar"></div>').join('')}
        </div>
        <div class="yt-voice-status-text">מקשיב לפקודה...</div>
        <div class="yt-voice-feedback-text"></div>
        <div class="yt-voice-overlay-hint">
          נסה: ״תעביר לדקה 20״ · ״תחזיר לתחילת הסרטון״ · ״עצור״
        </div>
      </div>`;
      
    mainOverlay.querySelector('.yt-voice-close-x').addEventListener('click', (e) => {
      e.stopPropagation();
      closeVoiceOverlay(false);
    });

    if (player) {
      player.appendChild(mainOverlay);
    } else {
      document.body.appendChild(mainOverlay);
    }
  }

  function setStatus(t)   { const el = mainOverlay?.querySelector('.yt-voice-status-text'); if (el) el.textContent = t; }
  function setFeedback(t) { const el = mainOverlay?.querySelector('.yt-voice-feedback-text'); if (el) el.textContent = t; }
  function showOverlay()  { ensureOverlayDOM(); void mainOverlay.offsetWidth; mainOverlay.classList.add('active'); setStatus('מקשיב לפקודה...'); setFeedback(''); }
  function hideOverlay()  { mainOverlay?.classList.remove('active'); }

  // ─── Wake Loop (מערכת מאזין קבוע ברקע) ─────────────────────────────────────────
  function startWakeLoop() {
    if (!wakeLoopEnabled || activeListening) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    stopWakeLoop(); // ניקוי שאריות קודמות למניעת כפילויות מיקרופונים

    wakeRecognition = new SR();
    wakeRecognition.continuous     = false; 
    wakeRecognition.interimResults = true;  
    wakeRecognition.lang           = 'he-IL';
    wakeRecognition.maxAlternatives = 3;

    wakeRecognition.onresult = (e) => {
      if (activeListening) return;
      for (let i = 0; i < e.results.length; i++) {
        for (let j = 0; j < e.results[i].length; j++) {
          const text = e.results[i][j].transcript.trim().toLowerCase();
          console.log('[Wake Loop Heard]:', text);

          // שדרוג 2: מערך ביטויים גמיש וסלחני לרעשי רקע (נפתח בשנייה שתגידו משהו קרוב)
          if (text.includes('עוזר קולי') || text.includes('היי יוטיוב') ||
              text.includes('הי יוטיוב') || text.includes('היי עוזר') ||
              text.includes('יי יוטיוב') || text.includes('יוטיוב') || 
              text.includes('עוזר') || text.includes('קולי') ||
              text.includes('hi youtube') || text.includes('hey youtube') || 
              text.includes('youtube') || text.includes('assistant')) {
            console.log('[Wake Loop] מילת הפעלה זוהתה בהצלחה!');
            openVoiceOverlay();
            return;
          }
        }
      }
    };

    // התנעה מחדש נקייה ומיידית בשקט
    wakeRecognition.onend = () => {
      wakeRecognition = null; 
      if (wakeLoopEnabled && !activeListening) {
        setTimeout(startWakeLoop, WAKE_RESTART_MS);
      }
    };

    // התנעה מחדש בשגיאה (מונע את קפיאת המיקרופון ברעשי רקע)
    wakeRecognition.onerror = (e) => {
      console.log("[Wake Loop Error]:", e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wakeLoopEnabled = false;
        return;
      }
      wakeRecognition = null;
      if (wakeLoopEnabled && !activeListening) {
        setTimeout(startWakeLoop, WAKE_RESTART_MS + 200);
      }
    };

    try { wakeRecognition.start(); }
    catch (_) { 
      wakeRecognition = null;
      setTimeout(startWakeLoop, WAKE_RESTART_MS); 
    }
  }

  function stopWakeLoop() {
    if (wakeRecognition) {
      try {
        wakeRecognition.onresult = null;
        wakeRecognition.onend = null;
        wakeRecognition.onerror = null;
        wakeRecognition.abort();
      } catch (_) {}
      wakeRecognition = null;
    }
  }

  // ─── Open / Close Overlay ─────────────────────────────────────────────────────
  function openVoiceOverlay() {
    if (activeListening) return;
    activeListening = true;
    wakeLoopEnabled = false;
    stopWakeLoop(); // עוצר ומנקה לחלוטין את מאזין הרקע

    const video = document.querySelector('video');
    if (video) {
      videoWasPaused = video.paused;
      savedMuted     = video.muted;
      video.muted    = true; // בידוד רעשים מהסרטון
    }

    showOverlay();
    startCommandRecognition();

    clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => {
      if (activeListening) closeVoiceOverlay(false);
    }, COMMAND_TIMEOUT_MS);
  }

  function closeVoiceOverlay(commandExecuted) {
    clearTimeout(dismissTimer);
    activeListening = false;

    // שדרוג 3: ניקוי זיכרון אגרסיבי של מנוע הפקודות מיד בסגירה למניעת חניקת המיקרופון בהמשך
    if (commandRecognition) {
      try {
        commandRecognition.onresult = null;
        commandRecognition.onend = null;
        commandRecognition.onerror = null;
        commandRecognition.abort();
      } catch (_) {}
      commandRecognition = null;
    }

    hideOverlay();

    const video = document.querySelector('video');
    if (video) video.muted = savedMuted;

    wakeLoopEnabled = true;
    stopWakeLoop(); // ניקוי מופע רקע ישן ליתר ביטחון
    setTimeout(startWakeLoop, 450);
  }

  // ─── Command Recognition (מאזין הפקודות בתוך הפופ-אפ) ──────────────────────────
  function startCommandRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    try { commandRecognition?.abort(); } catch (_) {}

    commandRecognition = new SR();
    commandRecognition.continuous      = false;
    commandRecognition.interimResults  = true;  
    commandRecognition.lang            = 'he-IL';
    commandRecognition.maxAlternatives = 5;

    let debounceTimer = null;

    commandRecognition.onresult = (e) => {
      let allText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        let best = '', bestConf = -1;
        for (let j = 0; j < e.results[i].length; j++) {
          if (e.results[i][j].confidence >= bestConf) {
            bestConf = e.results[i][j].confidence;
            best = e.results[i][j].transcript.trim();
          }
        }
        allText += best + ' ';
      }

      const text = allText.trim().toLowerCase();
      if (!text) return;

      setFeedback('🎙 ' + text);

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const result = parseCommand(text);
        if (result) {
          clearTimeout(dismissTimer);
          
          activeListening = false;
          try { commandRecognition?.stop(); } catch(_) {}
          
          setStatus('מבצע...');
          setFeedback('✅ ' + result.label);
          setTimeout(() => {
            result.action();
            setStatus('בוצע! ✓');
            setTimeout(() => closeVoiceOverlay(true), 600);
          }, 600);
        }
      }, COMMAND_DEBOUNCE_MS);
    };

    commandRecognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        setStatus('❌ אין גישה למיקרופון');
        setTimeout(() => closeVoiceOverlay(false), 2000);
      }
    };

    commandRecognition.onend = () => {
      if (activeListening) {
        setTimeout(() => {
          if (activeListening) try { commandRecognition.start(); } catch (_) {}
        }, 100);
      }
    };

    try { commandRecognition.start(); }
    catch (err) { console.warn('[YTVoice] start failed:', err); }
  }

  // ─── Command Parser (מנוע ניתוח הפקודות) ────────────────────────────────────────
  function normalizeTime(text) {
    const nums = {
      'אחת':1,'אחד':1,'שתיים':2,'שתי':2,'שני':2,'שניים':2,
      'שלוש':3,'שלושה':3,'ארבע':4,'ארבעה':4,'חמש':5,'חמישה':5,
      'שש':6,'שישה':6,'שבע':7,'שבעה':7,'שמונה':8,'תשע':9,'תשעה':9,
      'עשר':10,'עשרה':10,'עשרים':20,'שלושים':30,'ארבעים':40,'חמישים':50
    };
    for (const [w, n] of Object.entries(nums)) {
      text = text.replace(new RegExp(w, 'g'), String(n));
    }
    text = text.replace(/דקה וחצי/g, '90 שניות');
    text = text.replace(/חצי דקה/g, '30 שניות');
    text = text.replace(/(\d+)\s*דקות?/g, (_, n) => (parseInt(n) * 60) + ' שניות');
    return text;
  }

  function parseCommand(rawText) {
    const video = document.querySelector('video');
    if (!video) return null;

    const text = normalizeTime(rawText);

    // ── פקודת סגירה קולית ─────────────────────────────────────────────────────
    if (/לסגור|תסגור|תסגרי|ביטול|סגור/.test(text)) {
      return {
        label: 'סוגר את החלונית',
        action: () => { video.muted = savedMuted; }
      };
    }

    // ── ניווט ישיר לדקה ספציפית ("תעביר לדקה 20") ───────────────────────────────
    let minuteMatch = text.match(/(?:דקה|לדקה|עבור לדקה|תעביר לדקה)\s*(\d+)/);
    if (minuteMatch && minuteMatch[1]) {
      const targetMinute = parseInt(minuteMatch[1], 10);
      const targetSeconds = targetMinute * 60;
      
      return {
        label: `עובר לדקה ${targetMinute}`,
        action: () => {
          video.currentTime = Math.min(video.duration, targetSeconds);
          if (!videoWasPaused) { video.muted = savedMuted; video.play().catch(() => {}); }
        }
      };
    }

    // ── חזרה לתחילת הסרטון ("תחזיר לי לתחילת הסרטון") ───────────────────────────
    if (/לתחילת הסרטון|לתחילת סרטון|לתחילת הסרטן|לתחילה|התחלת הסרטון|תחזיר להתחלה/.test(text)) {
      return {
        label: 'חוזר לתחילת הסרטון',
        action: () => { 
          video.currentTime = 0; 
          if (!videoWasPaused) { video.muted = savedMuted; video.play().catch(() => {}); }
        }
      };
    }

    // ── עצור ──────────────────────────────────────────────────────────────────
    if (/עצור|עצרי|תעצור|תעצרי|השהה|פאוז|הפסק|תפסיק|סטופ|תקפיא/.test(text)) {
      return {
        label: 'עוצר את הסרטון',
        action: () => { video.muted = savedMuted; video.pause(); videoWasPaused = true; }
      };
    }

    // ── נגן / תמשיך / תחזיר בחזרה ────────────────────────────────────────────────
    if (/\b(נגן|תנגן|המשך|תמשיך|הפעל|תפעיל|פליי|תמשיכ)\b/.test(text) || /תחזיר בחזרה|תחזיר את הסרטון/.test(text)) {
      return {
        label: 'ממשיך לנגן',
        action: () => { video.muted = savedMuted; video.play().catch(() => {}); videoWasPaused = false; }
      };
    }

    // ── מהתחלה / מחדש ─────────────────────────────────────────────────────────
    if (/מהתחלה|הפעל מחדש/.test(text)) {
      return {
        label: 'מתחיל מחדש',
        action: () => { video.currentTime = 0; video.muted = savedMuted; video.play().catch(() => {}); }
      };
    }

    // ── שניות דינמיות (קפיצות קצרות קדימה/אחורה) ────────────────────────────────
    const secsMatch = text.match(/(\d+)\s*שניות?/);
    if (secsMatch) {
      const secs = parseInt(secsMatch[1], 10);
      const back  = /חזור|תחזיר|תחזור|תחזירי|תחזרו|אחורה|לאחור/.test(text);
      const fwd   = /קדימה|תתקדם|תתקדמי|קדם|דלג|לפנים|קדמה/.test(text);

      if (back) return {
        label: `חוזר ${secs} שניות אחורה`,
        action: () => {
          video.currentTime = Math.max(0, video.currentTime - secs);
          if (!videoWasPaused) { video.muted = savedMuted; video.play().catch(() => {}); }
        }
      };
      if (fwd) return {
        label: `מתקדם ${secs} שניות קדימה`,
        action: () => {
          video.currentTime = Math.min(video.duration, video.currentTime + secs);
          if (!videoWasPaused) { video.muted = savedMuted; video.play().catch(() => {}); }
        }
      };
    }

    // ── חזרה/קדימה ללא מספר (קפיצת ברירת מחדל של 10 שניות) ─────────────────────
    if (/חזור|תחזיר|אחורה|לאחור/.test(text)) {
      return {
        label: 'חוזר 10 שניות אחורה',
        action: () => {
          video.currentTime = Math.max(0, video.currentTime - 10);
          if (!videoWasPaused) { video.muted = savedMuted; video.play().catch(() => {}); }
        }
      };
    }
    if (/קדימה|תתקדם|לפנים/.test(text)) {
      return {
        label: 'מתקדם 10 שניות קדימה',
        action: () => {
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          if (!videoWasPaused) { video.muted = savedMuted; video.play().catch(() => {}); }
        }
      };
    }

    // ── עוצמה ─────────────────────────────────────────────────────────────────
    if (/הגבר|חזק יותר|יותר חזק|תגביר|יותר רם|רם יותר/.test(text)) {
      return { label: 'מגביר עוצמה', action: () => { video.volume = Math.min(1, video.volume + 0.2); video.muted = false; savedMuted = false; } };
    }
    if (/הנמך|שקט יותר|יותר שקט|תנמיך|פחות רם/.test(text)) {
      return { label: 'מנמיך עוצמה', action: () => { video.volume = Math.max(0.1, video.volume - 0.2); } };
    }

    // ── השתק ──────────────────────────────────────────────────────────────────
    if (/השתק|תשתיק|מיוט|בלי שמע/.test(text)) {
      return { label: 'משתיק', action: () => { video.muted = true; savedMuted = true; } };
    }
    if (/בטל השתקה|אנמיוט|תפעיל שמע|החזר שמע/.test(text)) {
      return { label: 'מבטל השתקה', action: () => { video.muted = false; savedMuted = false; } };
    }

    // ── מהירות ────────────────────────────────────────────────────────────────
    if (/האט|לאט יותר|יותר לאט|תאט/.test(text)) {
      return { label: 'מאט', action: () => { video.playbackRate = Math.max(0.25, video.playbackRate - 0.25); } };
    }
    if (/האץ|מהר יותר|יותר מהר|תאיץ/.test(text)) {
      return { label: 'מאיץ', action: () => { video.playbackRate = Math.min(2, video.playbackRate + 0.25); } };
    }
    if (/מהירות רגילה|נורמלי/.test(text)) {
      return { label: 'מהירות רגילה', action: () => { video.playbackRate = 1; } };
    }

    return null;
  }

})();