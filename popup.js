// ── DOM refs ──────────────────────────────────────────────────────────────────

const toggleEl    = document.getElementById('hideHeadersToggle');
const discordBtn  = document.getElementById('discordBtn');
const whatsappBtn = document.getElementById('whatsappBtn');
const statusEl    = document.getElementById('status');

// ── View management ───────────────────────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showDcScreen(id) {
  document.querySelectorAll('.dc-screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Persist toggle ────────────────────────────────────────────────────────────

toggleEl.addEventListener('change', () => {
  chrome.storage.local.set({ hideHeaders: toggleEl.checked });
});

chrome.storage.local.get('hideHeaders', ({ hideHeaders }) => {
  toggleEl.checked = hideHeaders === true;
});

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(text, type = 'info') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function setBusy(busy) {
  discordBtn.disabled  = busy;
  whatsappBtn.disabled = busy;
}

// ── Get active Gmail/Outlook tab ──────────────────────────────────────────────

async function getEmailTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  const hostname = new URL(tab.url).hostname;
  if (!['mail.google.com', 'outlook.live.com'].some(h => hostname.includes(h)))
    throw new Error('Navigate to Gmail or Outlook Web first.');
  return tab;
}

// ── Extract a specific email from the active tab ──────────────────────────────

async function extractEmail(tabId, emailIndex, hideHeaders) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (h, i) => {
      window.__emailPorterHideHeaders__ = h;
      window.__emailPorterEmailIndex__  = i;
      window.__emailPorterMode__        = 'extract';
    },
    args: [hideHeaders, emailIndex],
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  const result = results?.[0]?.result;
  if (!result)      throw new Error('Content script returned no data.');
  if (result.error) throw new Error(result.error);
  return result;
}

// ── List all expanded emails in the active tab ────────────────────────────────

async function listEmails(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.__emailPorterMode__ = 'list'; },
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { window.__emailPorterMode__ = 'extract'; },
  });
  return results?.[0]?.result?.emails || [];
}

// ── Clipboard helper ──────────────────────────────────────────────────────────

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = Object.assign(document.createElement('textarea'), {
      value: text, style: 'position:fixed;opacity:0',
    });
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

// ── Email chooser UI ──────────────────────────────────────────────────────────

function renderEmailChooser(emails, onPick) {
  const list = document.getElementById('emailList');
  list.innerHTML = '';
  emails.forEach(email => {
    const btn = document.createElement('button');
    btn.className = 'picker-item';
    btn.innerHTML = `
      <div class="picker-info">
        <div class="picker-name">${escHtml(email.from)}</div>
        <div class="picker-meta">${escHtml(email.date)} — ${escHtml(email.snippet)}</div>
      </div>`;
    btn.addEventListener('click', () => onPick(email.index));
    list.appendChild(btn);
  });
  showView('emailChooserView');
}

document.getElementById('chooserBack').addEventListener('click', () => {
  showView('mainView');
  setBusy(false);
});

// ── Discord picker state ──────────────────────────────────────────────────────

let dcToken       = null;
let dcText        = null;
let dcTabId       = null;
let dcAttachments = [];

// ── Discord server list ───────────────────────────────────────────────────────

function renderServers(guilds) {
  const list = document.getElementById('serverList');
  list.innerHTML = '';
  if (!guilds.length) {
    dcStatus('dcServerStatus', 'No servers found.', 'error');
    return;
  }
  guilds.forEach(guild => {
    const btn = document.createElement('button');
    btn.className = 'picker-item';
    const iconChar = guild.name.charAt(0).toUpperCase();
    btn.innerHTML = `
      <div class="picker-icon">
        ${guild.icon
          ? `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32" alt="" />`
          : iconChar}
      </div>
      <div class="picker-info">
        <div class="picker-name">${escHtml(guild.name)}</div>
      </div>`;
    btn.addEventListener('click', () => loadChannels(guild));
    list.appendChild(btn);
  });
  showDcScreen('dcServerScreen');
}

// ── Discord channel list ──────────────────────────────────────────────────────

function loadChannels(guild) {
  document.getElementById('dcChannelTitle').textContent = guild.name;
  showDcScreen('dcChannelScreen');
  dcStatus('dcChannelStatus', 'Loading channels…', 'info');

  chrome.runtime.sendMessage(
    { type: 'DISCORD_GET_CHANNELS', token: dcToken, guildId: guild.id },
    res => {
      if (!res?.success) {
        dcStatus('dcChannelStatus', res?.error || 'Could not load channels.', 'error');
        return;
      }
      const textChannels = (res.channels || [])
        .filter(c => c.type === 0)
        .sort((a, b) => a.position - b.position);
      renderChannels(textChannels);
    }
  );
}

function renderChannels(channels) {
  const list = document.getElementById('channelList');
  list.innerHTML = '';
  dcStatus('dcChannelStatus', '', 'info');

  if (!channels.length) {
    dcStatus('dcChannelStatus', 'No text channels found.', 'error');
    return;
  }
  channels.forEach(channel => {
    const btn = document.createElement('button');
    btn.className = 'picker-item';
    btn.innerHTML = `
      <span class="channel-hash">#</span>
      <div class="picker-info">
        <div class="picker-name">${escHtml(channel.name)}</div>
        ${channel.topic
          ? `<div class="picker-meta">${escHtml(channel.topic.slice(0, 45))}</div>`
          : ''}
      </div>`;
    btn.addEventListener('click', () => sendToChannel(channel, btn));
    list.appendChild(btn);
  });
}

// ── Send to selected Discord channel ─────────────────────────────────────────

function sendToChannel(channel, btn) {
  document.querySelectorAll('#channelList .picker-item').forEach(el => el.disabled = true);
  dcStatus('dcChannelStatus', 'Sending…', 'info');

  chrome.runtime.sendMessage(
    { type: 'DISCORD_SEND_MESSAGE', token: dcToken, channelId: channel.id, text: dcText, attachments: dcAttachments },
    res => {
      document.querySelectorAll('#channelList .picker-item').forEach(el => el.disabled = false);
      if (res?.success) {
        const suffix = res.chunks > 1 ? ` (${res.chunks} messages)` : '';
        dcStatus('dcChannelStatus', `✓ Sent to #${channel.name}${suffix}`, 'ok');
        setTimeout(window.close, 1800);
      } else {
        dcStatus('dcChannelStatus', res?.error || 'Failed to send.', 'error');
      }
    }
  );
}

function dcStatus(id, text, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = `status ${type}`;
}

// ── Discord back buttons ──────────────────────────────────────────────────────

document.getElementById('dcLoginBack').addEventListener('click', () => {
  showView('mainView');
  setBusy(false);
});

document.getElementById('dcServerBack').addEventListener('click', () => {
  showView('mainView');
  setBusy(false);
});

document.getElementById('dcChannelBack').addEventListener('click', () => {
  showDcScreen('dcServerScreen');
});

document.getElementById('dcRetryBtn').addEventListener('click', () => {
  startDiscordPicker(dcTabId, dcText);
});

// ── Start Discord picker flow ─────────────────────────────────────────────────

async function startDiscordPicker(tabId, plainText, attachments = []) {
  dcTabId       = tabId;
  dcText        = plainText;
  dcAttachments = attachments;
  showView('discordPickerView');
  showDcScreen('dcServerScreen');
  dcStatus('dcServerStatus', 'Checking Discord login…', 'info');

  chrome.runtime.sendMessage({ type: 'DISCORD_GET_TOKEN' }, res => {
    if (!res?.token) {
      showDcScreen('dcLoginScreen');
      return;
    }
    dcToken = res.token;
    dcStatus('dcServerStatus', 'Loading servers…', 'info');

    chrome.runtime.sendMessage(
      { type: 'DISCORD_GET_GUILDS', token: dcToken },
      guildsRes => {
        if (!guildsRes?.success) {
          dcStatus('dcServerStatus', guildsRes?.error || 'Could not load servers.', 'error');
          return;
        }
        renderServers(guildsRes.guilds);
      }
    );
  });
}

// ── Main flow: handle multi-email then route to destination ──────────────────

async function handleShare(destination) {
  setBusy(true);
  setStatus('Working…', 'info');

  try {
    const tab = await getEmailTab();
    const hideHeaders = toggleEl.checked;

    // List all expanded emails first
    const emails = await listEmails(tab.id);

    if (emails.length === 0) {
      throw new Error('No open email found. Click on an email to expand it.');
    }

    if (emails.length === 1) {
      await doShare(tab.id, 0, hideHeaders, destination);
    } else {
      // Multiple emails — let user pick
      setStatus('', 'info');
      renderEmailChooser(emails, async (idx) => {
        showView('mainView');
        setBusy(true);
        setStatus('Working…', 'info');
        try {
          await doShare(tab.id, idx, hideHeaders, destination);
        } catch (err) {
          setStatus(err.message, 'error');
          setBusy(false);
        }
      });
    }
  } catch (err) {
    setStatus(err.message, 'error');
    setBusy(false);
  }
}

async function doShare(tabId, emailIndex, hideHeaders, destination) {
  const data = await extractEmail(tabId, emailIndex, hideHeaders);

  if (destination === 'discord') {
    setBusy(false);
    await startDiscordPicker(tabId, data.plainText, data.attachmentData || []);
    return;
  }

  if (destination === 'whatsapp') {
    const url = `https://web.whatsapp.com/send?text=${encodeURIComponent(data.plainText)}`;
    await chrome.tabs.create({ url });
    setStatus('WhatsApp opened — select a chat and press Enter.', 'ok');
    setBusy(false);
    return;
  }
}

// ── Button wiring ─────────────────────────────────────────────────────────────

discordBtn.addEventListener('click',  () => handleShare('discord'));
whatsappBtn.addEventListener('click', () => handleShare('whatsapp'));

// ── Util ──────────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
