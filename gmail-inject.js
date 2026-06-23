(function () {
  'use strict';

  if (window.__emailPorterReady) return;
  window.__emailPorterReady = true;

  console.log('[Email Porter] injected on', location.hostname);

  let overlayHost = null;

  // ── Menu detection ────────────────────────────────────────────────────────

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          setTimeout(() => scanForMenu(node), 80);
        }
      } else if (mutation.type === 'attributes') {
        scanForMenu(mutation.target);
      }
    }
  });

  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['aria-hidden', 'style', 'class'],
  });

  function scanForMenu(root) {
    if (!root || root.nodeType !== 1) return;
    const candidates = [];
    if (isMenuElement(root)) candidates.push(root);
    try {
      candidates.push(...root.querySelectorAll('[role="menu"], .J-M, ul[class][jsaction]'));
    } catch (_) {}

    for (const menu of candidates) {
      if (menu.dataset.emailPorterInjected) continue;
      if (!isVisible(menu))                continue;
      if (!isMessageOptionsMenu(menu))     continue;
      menu.dataset.emailPorterInjected = '1';
      injectShareItem(menu);
    }
  }

  function isMenuElement(el) {
    return (
      el.getAttribute?.('role') === 'menu' ||
      el.classList?.contains('J-M') ||
      (el.tagName === 'UL' && el.hasAttribute('jsaction'))
    );
  }

  function isVisible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const s = window.getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  function isMessageOptionsMenu(menu) {
    const text = menu.textContent || '';
    if (text.includes('Show original'))    return true;
    if (text.includes('Download message')) return true;
    const items = menu.querySelectorAll('[role="menuitem"], li[jsaction], .J-N');
    if (items.length >= 5 && text.includes('Forward') && text.includes('Delete')) return true;
    return false;
  }

  // ── Find which email container owns this menu (by Y-position proximity) ───

  function findEmailIndex(menu) {
    const containers = [...document.querySelectorAll('.adn.ads')];
    if (containers.length <= 1) return 0;
    const menuTop = menu.getBoundingClientRect().top;
    let bestIdx = 0, bestDist = Infinity;
    containers.forEach((c, i) => {
      const dist = Math.abs(c.getBoundingClientRect().top - menuTop);
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    return bestIdx;
  }

  // ── Item injection ────────────────────────────────────────────────────────

  function injectShareItem(menu) {
    const emailIndex = findEmailIndex(menu);

    const refItem =
      menu.querySelector('[role="menuitem"]') ||
      menu.querySelector('.J-N') ||
      menu.querySelector('li') ||
      menu.firstElementChild;

    const tag = refItem?.tagName?.toLowerCase() || 'div';
    const ref = refItem ? window.getComputedStyle(refItem) : null;

    const item = document.createElement(tag);
    item.dataset.emailPorter = 'share-btn';
    if (refItem?.getAttribute('role') === 'menuitem') item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '0');

    item.style.cssText = `
      display:         flex        !important;
      align-items:     center     !important;
      gap:             10px       !important;
      padding:         ${ref?.padding || '8px 20px'} !important;
      cursor:          pointer    !important;
      font-family:     ${ref?.fontFamily || "'Google Sans',Roboto,sans-serif"} !important;
      font-size:       ${ref?.fontSize   || '14px'}   !important;
      color:           #1a73e8   !important;
      font-weight:     500       !important;
      border-bottom:   1px solid rgba(0,0,0,0.10) !important;
      margin-bottom:   2px       !important;
      white-space:     nowrap    !important;
      user-select:     none      !important;
      outline:         none      !important;
      box-sizing:      border-box !important;
      min-height:      0         !important;
      background:      transparent !important;
    `;

    item.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#1a73e8"
           style="flex-shrink:0;display:block" aria-hidden="true">
        <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7
                 s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34
                 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31
                 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31
                 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92
                 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/>
      </svg>
      <span style="color:#1a73e8;font-weight:500">Share Email</span>
    `;

    item.addEventListener('mouseenter', () => item.style.setProperty('background', 'rgba(26,115,232,0.08)', 'important'));
    item.addEventListener('mouseleave', () => item.style.setProperty('background', 'transparent', 'important'));
    item.addEventListener('focus',      () => item.style.setProperty('background', 'rgba(26,115,232,0.08)', 'important'));
    item.addEventListener('blur',       () => item.style.setProperty('background', 'transparent', 'important'));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); item.click(); }
    });
    item.addEventListener('click', e => {
      e.stopPropagation();
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', keyCode: 27, bubbles: true, cancelable: true,
      }));
      setTimeout(() => showShareOverlay(emailIndex), 60);
    });

    menu.insertBefore(item, menu.firstChild);
  }

  // ── Share overlay (Shadow DOM) ────────────────────────────────────────────

  function showShareOverlay(emailIndex) {
    removeOverlay();

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        .backdrop {
          position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(0,0,0,0.48);
          display: flex; align-items: center; justify-content: center;
        }
        .card {
          background: #1a1b1e; border: 1px solid #373a40; border-radius: 8px;
          padding: 18px; width: 300px; position: relative;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          max-height: 80vh; overflow-y: auto;
        }
        .title { font-size:14px; font-weight:600; color:#fff; margin-bottom:2px; }
        .sub   { font-size:12px; color:#6c7086; margin-bottom:16px; }
        .btn {
          display:flex; align-items:center; gap:9px;
          width:100%; padding:10px 14px; border:none; border-radius:8px;
          font-size:13px; font-weight:600; cursor:pointer; color:#fff;
          margin-bottom:8px; transition:opacity .15s; text-align:left;
        }
        .btn:last-of-type { margin-bottom:0; }
        .btn:hover:not(:disabled) { opacity:.82; }
        .btn:disabled { opacity:.38; cursor:not-allowed; }
        .discord  { background:#5865f2; }
        .whatsapp { background:#25d366; }
        .close {
          position:absolute; top:10px; right:12px;
          background:none; border:none; color:#6c7086;
          font-size:17px; cursor:pointer; line-height:1;
          padding:4px 7px; border-radius:5px;
        }
        .close:hover { color:#c1c2c5; background:rgba(255,255,255,0.07); }
        .status { margin-top:12px; font-size:12px; min-height:14px; text-align:center; }
        .info  { color:#74c0fc; }
        .ok    { color:#69db7c; }
        .error { color:#ff6b6b; }

        /* Picker screens */
        .screen { display:none; }
        .screen.active { display:block; }
        .back-row {
          display:flex; align-items:center; gap:8px; margin-bottom:12px; cursor:pointer;
          color:#74c0fc; font-size:13px; font-weight:500; background:none; border:none;
          padding:0;
        }
        .back-row:hover { color:#a5d8ff; }
        .picker-title { font-size:13px; font-weight:600; color:#c1c2c5; margin-bottom:10px; }
        .picker-list { display:flex; flex-direction:column; gap:6px; }
        .picker-item {
          display:flex; align-items:center; gap:10px;
          padding:9px 12px; border-radius:8px; cursor:pointer;
          background:#25262b; border:1px solid #373a40;
          font-size:13px; color:#c1c2c5; text-align:left;
          transition:background .12s;
        }
        .picker-item:hover { background:#2c2d32; color:#fff; }
        .picker-item .icon {
          width:32px; height:32px; border-radius:50%; object-fit:cover;
          background:#373a40; flex-shrink:0;
          display:flex; align-items:center; justify-content:center;
          font-size:14px; font-weight:700; color:#aaa;
        }
        .picker-item .info { flex:1; overflow:hidden; }
        .picker-item .name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .picker-item .meta { font-size:11px; color:#6c7086; margin-top:1px; }
        .login-box { text-align:center; padding:8px 0; }
        .login-box p { color:#c1c2c5; font-size:13px; margin-bottom:12px; }
        .login-link {
          display:inline-block; padding:9px 20px; background:#5865f2;
          border-radius:8px; color:#fff; font-size:13px; font-weight:600;
          text-decoration:none;
        }
        .login-link:hover { background:#4752c4; }
        .hdr-toggle {
          display:flex; align-items:center; gap:8px;
          font-size:12px; color:#6c7086; cursor:pointer;
          margin-bottom:14px; user-select:none;
        }
        .hdr-toggle input { cursor:pointer; accent-color:#5865f2; }
      </style>

      <div class="backdrop" id="backdrop">
        <div class="card">
          <button class="close" id="closeBtn" title="Close">✕</button>

          <!-- Screen: choose destination -->
          <div class="screen active" id="screenMain">
            <div class="title">↗ Share Email</div>
            <div class="sub">Choose a destination</div>
            <label class="hdr-toggle">
              <input type="checkbox" id="hideHeadersCheck" />
              Hide sender &amp; recipient
            </label>
            <button class="btn discord"   id="discordBtn">
              <svg width="18" height="18" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0a105.89 105.89 0 0 0-26.25 8.09C2.79 32.65-1.71 56.6.54 80.21a105.73 105.73 0 0 0 32.17 16.15 77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1 105.25 105.25 0 0 0 32.19-16.14c2.64-27.38-4.51-51.11-18.9-72.15zM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53s-5.05 12.69-11.44 12.69zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.44-12.74S96.23 46 96.12 53s-5.04 12.69-11.43 12.69z"/></svg>
              Discord
            </button>
            <button class="btn whatsapp" id="whatsappBtn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
              WhatsApp
            </button>
            <div class="status" id="statusMain"></div>
          </div>

          <!-- Screen: Discord not logged in -->
          <div class="screen" id="screenLogin">
            <button class="back-row" id="backFromLogin">← Back</button>
            <div class="login-box">
              <p>Open Discord in this browser and log in, then click Retry.</p>
              <a class="login-link" href="https://discord.com/login" target="_blank"
                 id="loginLink">Open Discord Web</a>
              <button class="btn discord" id="retryLoginBtn"
                      style="margin-top:10px;justify-content:center">Retry</button>
            </div>
          </div>

          <!-- Screen: server list -->
          <div class="screen" id="screenServers">
            <button class="back-row" id="backFromServers">← Back</button>
            <div class="picker-title">Choose a Server</div>
            <div class="picker-list" id="serverList"></div>
            <div class="status" id="statusServers"></div>
          </div>

          <!-- Screen: channel list -->
          <div class="screen" id="screenChannels">
            <button class="back-row" id="backFromChannels">← Servers</button>
            <div class="picker-title" id="channelTitle">Choose a Channel</div>
            <div class="picker-list" id="channelList"></div>
            <div class="status" id="statusChannels"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(host);
    overlayHost = host;

    const $ = id => shadow.getElementById(id);

    // ── Sync redact toggle with stored setting ───────────────────────────────
    chrome.storage.local.get('hideHeaders', ({ hideHeaders }) => {
      $('hideHeadersCheck').checked = !!hideHeaders;
    });
    $('hideHeadersCheck').onchange = () => {
      chrome.storage.local.set({ hideHeaders: $('hideHeadersCheck').checked });
    };

    // ── Helpers ──────────────────────────────────────────────────────────────

    function showScreen(id) {
      shadow.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      $(id).classList.add('active');
    }

    function setStatus(elId, text, type = 'info') {
      const el = $(elId);
      if (!el) return;
      el.textContent = text;
      el.className = `status ${type}`;
    }

    function setBusy(btns, busy) {
      btns.forEach(id => { const el = $(id); if (el) el.disabled = busy; });
    }

    // ── Close / backdrop ─────────────────────────────────────────────────────

    $('closeBtn').onclick    = removeOverlay;
    $('backdrop').onclick    = e => { if (e.target === $('backdrop')) removeOverlay(); };
    $('backFromLogin').onclick    = () => showScreen('screenMain');
    $('backFromServers').onclick  = () => showScreen('screenMain');
    $('backFromChannels').onclick = () => showScreen('screenServers');

    $('retryLoginBtn').onclick = () => {
      if (!extractedText) {
        showScreen('screenMain');
        return;
      }
      showScreen('screenServers');
      setStatus('statusServers', 'Checking Discord login…', 'info');
      chrome.runtime.sendMessage({ type: 'DISCORD_GET_TOKEN' }, tokenRes => {
        if (!tokenRes?.token) {
          showScreen('screenLogin');
          setStatus('statusServers', '', 'info');
          return;
        }
        discordToken = tokenRes.token;
        setStatus('statusServers', 'Loading servers…', 'info');
        chrome.runtime.sendMessage({ type: 'DISCORD_GET_GUILDS', token: discordToken }, guildsRes => {
          if (!guildsRes?.success) {
            setStatus('statusServers', guildsRes?.error || 'Could not load servers.', 'error');
            return;
          }
          setStatus('statusServers', '', 'info');
          renderServers(guildsRes.guilds);
        });
      });
    };

    // ── Stored state across screens ──────────────────────────────────────────

    let discordToken       = null;
    let extractedText      = null;
    let extractedAttachments = [];

    // ── WhatsApp ─────────────────────────────────────────────────────────────

    $('whatsappBtn').onclick = () => {
      const hideHeaders = $('hideHeadersCheck').checked;
      setBusy(['discordBtn', 'whatsappBtn'], true);
      setStatus('statusMain', 'Extracting email…', 'info');

      chrome.runtime.sendMessage(
        { type: 'QUICK_SHARE', destination: 'whatsapp', hideHeaders: !!hideHeaders, emailIndex },
        res => {
          setBusy(['discordBtn', 'whatsappBtn'], false);
          if (chrome.runtime.lastError || !res?.success) {
            setStatus('statusMain', chrome.runtime.lastError?.message || res?.error || 'Failed.', 'error');
          } else {
            setStatus('statusMain', res.message || 'WhatsApp tab opened!', 'ok');
            setTimeout(removeOverlay, 2200);
          }
        }
      );
    };

    // ── Discord: extract → check token → server list ─────────────────────────

    $('discordBtn').onclick = () => {
      const hideHeaders = $('hideHeadersCheck').checked;
      setBusy(['discordBtn', 'whatsappBtn'], true);
      setStatus('statusMain', 'Extracting email…', 'info');

      // Step 1: extract email text
      chrome.runtime.sendMessage(
        { type: 'QUICK_SHARE', destination: 'discord', hideHeaders: !!hideHeaders, emailIndex },
        async res => {
          if (chrome.runtime.lastError || !res?.success) {
            setStatus('statusMain', chrome.runtime.lastError?.message || res?.error || 'Failed.', 'error');
            setBusy(['discordBtn', 'whatsappBtn'], false);
            return;
          }
          extractedText        = res.plainText;
          extractedAttachments = res.attachmentData || [];

          // Step 2: get Discord token
          setStatus('statusMain', 'Checking Discord login…', 'info');
          chrome.runtime.sendMessage({ type: 'DISCORD_GET_TOKEN' }, async tokenRes => {
            setBusy(['discordBtn', 'whatsappBtn'], false);
            if (!tokenRes?.token) {
              showScreen('screenLogin');
              return;
            }
            discordToken = tokenRes.token;

            // Step 3: load server list
            showScreen('screenServers');
            setStatus('statusServers', 'Loading servers…', 'info');

            chrome.runtime.sendMessage(
              { type: 'DISCORD_GET_GUILDS', token: discordToken },
              guildsRes => {
                if (!guildsRes?.success) {
                  setStatus('statusServers', guildsRes?.error || 'Could not load servers.', 'error');
                  return;
                }
                setStatus('statusServers', '', 'info');
                renderServers(guildsRes.guilds);
              }
            );
          });
        }
      );
    };

    // After login link clicked, allow retry
    $('loginLink').onclick = () => {
      setTimeout(() => {
        $('backFromLogin').textContent = '← Back (click after login)';
      }, 500);
    };

    // ── Render server list ────────────────────────────────────────────────────

    function renderServers(guilds) {
      const list = $('serverList');
      list.innerHTML = '';
      if (!guilds.length) {
        setStatus('statusServers', 'No servers found.', 'error');
        return;
      }
      guilds.forEach(guild => {
        const item = document.createElement('button');
        item.className = 'picker-item';
        const iconChar = guild.name.charAt(0).toUpperCase();
        const iconHtml = guild.icon
          ? `<img class="icon" src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32" alt="" />`
          : `<div class="icon">${iconChar}</div>`;
        item.innerHTML = `${iconHtml}<div class="info"><div class="name">${escHtml(guild.name)}</div></div>`;
        item.onclick = () => loadChannels(guild);
        list.appendChild(item);
      });
    }

    // ── Load and render channel list ──────────────────────────────────────────

    function loadChannels(guild) {
      showScreen('screenChannels');
      $('channelTitle').textContent = `# ${guild.name}`;
      setStatus('statusChannels', 'Loading channels…', 'info');

      chrome.runtime.sendMessage(
        { type: 'DISCORD_GET_CHANNELS', token: discordToken, guildId: guild.id },
        chanRes => {
          if (!chanRes?.success) {
            setStatus('statusChannels', chanRes?.error || 'Could not load channels.', 'error');
            return;
          }
          // Text channels only (type 0), sorted by position
          const textChannels = (chanRes.channels || [])
            .filter(c => c.type === 0)
            .sort((a, b) => a.position - b.position);

          setStatus('statusChannels', '', 'info');
          renderChannels(textChannels);
        }
      );
    }

    function renderChannels(channels) {
      const list = $('channelList');
      list.innerHTML = '';
      if (!channels.length) {
        setStatus('statusChannels', 'No text channels found.', 'error');
        return;
      }
      channels.forEach(channel => {
        const item = document.createElement('button');
        item.className = 'picker-item';
        item.innerHTML = `
          <div class="icon" style="font-size:16px;background:none">#</div>
          <div class="info">
            <div class="name">${escHtml(channel.name)}</div>
            ${channel.topic ? `<div class="meta">${escHtml(channel.topic.slice(0, 40))}</div>` : ''}
          </div>`;
        item.onclick = () => sendToChannel(channel);
        list.appendChild(item);
      });
    }

    // ── Send to selected channel ──────────────────────────────────────────────

    function sendToChannel(channel) {
      setStatus('statusChannels', 'Sending…', 'info');
      shadow.querySelectorAll('.picker-item').forEach(el => el.disabled = true);

      chrome.runtime.sendMessage(
        { type: 'DISCORD_SEND_MESSAGE', token: discordToken, channelId: channel.id, text: extractedText, attachments: extractedAttachments },
        res => {
          shadow.querySelectorAll('.picker-item').forEach(el => el.disabled = false);
          if (res?.success) {
            const parts = res.chunks > 1 ? ` (${res.chunks} messages)` : '';
            setStatus('statusChannels', `✓ Sent to #${channel.name}${parts}`, 'ok');
            setTimeout(removeOverlay, 2000);
          } else {
            setStatus('statusChannels', res?.error || 'Failed to send.', 'error');
          }
        }
      );
    }

    // ── Tiny HTML escaper ─────────────────────────────────────────────────────

    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
  }

  function removeOverlay() {
    overlayHost?.remove();
    overlayHost = null;
  }
})();
