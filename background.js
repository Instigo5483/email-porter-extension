// Service Worker — email extraction routing, Gmail injection, Discord API bridge.

// ── Programmatic injection (catches tabs already open when extension loads) ───

const GMAIL_HOSTS = ['mail.google.com', 'outlook.live.com'];

function isEmailTab(url) {
  try { return GMAIL_HOSTS.some(h => new URL(url).hostname.includes(h)); }
  catch { return false; }
}

async function ensureInjected(tabId) {
  try {
    const [check] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => !!window.__emailPorterReady,
    });
    if (check?.result === true) return;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['gmail-inject.js'] });
  } catch (_) {}
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isEmailTab(tab.url)) ensureInjected(tabId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab && isEmailTab(tab.url)) ensureInjected(tabId);
});

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (message.type === 'QUICK_SHARE') {
    if (!tabId) { sendResponse({ success: false, error: 'No tab context.' }); return; }
    quickShare(message, tabId)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'LIST_EMAILS') {
    if (!tabId) { sendResponse({ success: false, error: 'No tab context.' }); return; }
    listEmails(tabId)
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'DISCORD_GET_TOKEN') {
    getDiscordToken()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ token: null, error: e.message }));
    return true;
  }

  if (message.type === 'DISCORD_GET_GUILDS') {
    discordFetch('/users/@me/guilds', message.token)
      .then(guilds => sendResponse({ success: true, guilds }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'DISCORD_GET_CHANNELS') {
    discordFetch(`/guilds/${message.guildId}/channels`, message.token)
      .then(channels => sendResponse({ success: true, channels }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  if (message.type === 'DISCORD_SEND_MESSAGE') {
    sendDiscordMessage(message.token, message.channelId, message.text, message.attachments || [])
      .then(r => sendResponse({ success: true, ...r }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }
});

// ── Email extraction helpers ──────────────────────────────────────────────────

async function listEmails(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.__emailPorterMode__ = 'list'; },
  });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.__emailPorterMode__ = 'extract'; },
  });
  const data = res?.result;
  if (!data) throw new Error('Could not read email list.');
  return { success: true, emails: data.emails || [] };
}

async function quickShare({ destination, hideHeaders, emailIndex = -1 }, tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (h, i) => {
      window.__emailPorterHideHeaders__  = h;
      window.__emailPorterEmailIndex__   = i;
      window.__emailPorterMode__         = 'extract';
    },
    args: [!!hideHeaders, emailIndex],
  });

  const [res] = await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  const data = res?.result;
  if (!data)       throw new Error('Extraction failed — no data returned.');
  if (data.error)  throw new Error(data.error);

  if (destination === 'discord') {
    const allAtts = [...(data.attachmentData || [])];
    if (data.printUrl) {
      try {
        const pdfBase64 = await generateGmailPdf(data.printUrl);
        if (pdfBase64) {
          const byteLen = Math.round(pdfBase64.length * 0.75);
          if (byteLen <= MAX_ATTACH_BYTES) {
            const safeName = (data.headers?.subject || 'email')
              .replace(/[<>:"/\\|?*]/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'email';
            allAtts.unshift({ name: `${safeName}.pdf`, type: 'application/pdf', base64: pdfBase64 });
          }
        }
      } catch (e) {
        console.warn('Email PDF generation failed:', e.message);
      }
    }
    return { success: true, plainText: data.plainText, attachmentData: allAtts };
  }

  if (destination === 'whatsapp') {
    const url = `https://web.whatsapp.com/send?text=${encodeURIComponent(data.plainText)}`;
    await chrome.tabs.create({ url });
    return { success: true, message: 'WhatsApp tab opened — select a chat and press Enter.' };
  }

  throw new Error(`Unknown destination: ${destination}`);
}

// ── Gmail print-to-PDF via Chrome Debugger API ───────────────────────────────

const MAX_ATTACH_BYTES = 7 * 1024 * 1024;

async function generateGmailPdf(printUrl) {
  const tab = await chrome.tabs.create({ url: printUrl, active: false });
  try {
    await waitForTabLoad(tab.id, 20000);
    await new Promise(r => setTimeout(r, 2000)); // let Gmail render the print view
    await chrome.debugger.attach({ tabId: tab.id }, '1.3');
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId: tab.id },
        'Page.printToPDF',
        { printBackground: false, paperWidth: 8.5, paperHeight: 11,
          marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.5, marginRight: 0.5 }
      );
      return result?.data || null;
    } finally {
      await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    }
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ── Discord API ───────────────────────────────────────────────────────────────

async function getDiscordToken() {
  const existing = await chrome.tabs.query({ url: 'https://discord.com/*' });
  let tabId;
  let openedNew = false;

  if (existing.length > 0) {
    tabId = existing[0].id;
  } else {
    const tab = await chrome.tabs.create({
      url: 'https://discord.com/channels/@me',
      active: false,
    });
    tabId = tab.id;
    openedNew = true;
    await waitForTabLoad(tabId, 15000);
    await new Promise(r => setTimeout(r, 2500));
  }

  const readToken = async (useMainWorld) => {
    try {
      const opts = {
        target: { tabId },
        func: () => {
          // Strategy 1: localStorage.token — Discord's standard key
          let raw = window.localStorage.getItem('token');
          if (raw) {
            // Discord sometimes JSON-encodes the value (stores with surrounding quotes)
            try { const p = JSON.parse(raw); if (typeof p === 'string') raw = p; } catch {}
            if (raw.length > 20 && !raw.includes(' ')) return raw;
          }

          // Strategy 2: Discord webpack module — most reliable, requires MAIN world
          try {
            const wp = window.webpackChunkdiscord_app;
            if (wp) {
              let found = null;
              wp.push([['__ep__'], {}, (req) => {
                for (const k in req.c) {
                  const d = req.c[k]?.exports?.default;
                  if (d && typeof d.getToken === 'function') {
                    found = d.getToken();
                    break;
                  }
                }
              }]);
              if (found) return found;
            }
          } catch {}

          return null;
        },
      };
      if (useMainWorld) opts.world = 'MAIN';
      const [result] = await chrome.scripting.executeScript(opts);
      return result?.result || null;
    } catch {
      return null;
    }
  };

  // MAIN world first — needed for webpack module access
  let token = await readToken(true);
  // Isolated world fallback — shares localStorage with page
  if (!token) token = await readToken(false);

  if (!token && openedNew) {
    await new Promise(r => setTimeout(r, 3000));
    token = (await readToken(true)) || (await readToken(false));
  }

  return { token: token || null, tabId };
}

function waitForTabLoad(tabId, timeout = 10000) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function discordFetch(path, token) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { 'Authorization': token },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = body.code;
    // 50013 = Missing Permissions, 50001 = Missing Access
    if (code === 50013 || code === 50001)
      throw new Error('No permission to send messages in this channel.');
    throw new Error(body.message || `Discord API error ${res.status}`);
  }
  return res.json();
}

function chunkMessage(text, maxLen = 1900) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  while (text.length > maxLen) {
    let split = text.lastIndexOf('\n', maxLen);
    if (split < maxLen * 0.5) split = text.lastIndexOf(' ', maxLen);
    if (split <= 0) split = maxLen;
    chunks.push(text.slice(0, split));
    text = text.slice(split).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}

async function sendDiscordMessage(token, channelId, text, attachments = []) {
  const chunks = chunkMessage(text);

  async function postChunk(content, files) {
    let body, extraHeaders = {};

    if (files && files.length > 0) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify({ content }));
      files.forEach((f, idx) => {
        const bytes = Uint8Array.from(atob(f.base64), c => c.charCodeAt(0));
        const blob  = new Blob([bytes], { type: f.type });
        form.append(`files[${idx}]`, blob, f.name);
      });
      body = form;
    } else {
      extraHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify({ content });
    }

    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': token, ...extraHeaders },
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const code = data.code;
      if (code === 50013 || code === 50001)
        throw new Error('No permission to send messages in this channel.');
      throw new Error(data.message || `Discord error ${res.status}`);
    }
  }

  for (let i = 0; i < chunks.length; i++) {
    // Attach files only to the first chunk
    await postChunk(chunks[i], i === 0 ? attachments : []);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 700));
  }

  return { chunks: chunks.length };
}
