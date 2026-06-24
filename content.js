(async () => {
  const EMAIL_REGEX = /[\w.+'-]+@[\w.-]+\.[a-zA-Z]{2,}/g;
  const SEP = '----------------------------------------';

  const mode       = window.__emailPorterMode__       || 'extract'; // 'list' | 'extract'
  const emailIndex = window.__emailPorterEmailIndex__ ?? -1;         // -1 = first expanded

  function detectSource() {
    if (location.hostname === 'mail.google.com') return 'gmail';
    if (location.hostname.includes('outlook'))   return 'outlook';
    return null;
  }

  // ── Gmail email containers ────────────────────────────────────────────────

  function getGmailContainers() {
    return [...document.querySelectorAll('.adn.ads')];
  }

  function getGmailContainer(index) {
    const list = getGmailContainers();
    if (!list.length) return null;
    return list[index >= 0 ? Math.min(index, list.length - 1) : 0];
  }

  // ── Header extraction (scoped to one email container) ────────────────────

  function extractGmailHeaders(scope) {
    const subject = document.querySelector('h2.hP')?.textContent?.trim() || '(No Subject)';
    const root = scope || document;

    const fromEl = root.querySelector('.gD');
    const fromName  = fromEl?.getAttribute('name')  || fromEl?.textContent?.trim() || '';
    const fromEmail = fromEl?.getAttribute('email') || '';
    const from = fromName && fromEmail
      ? `${fromName} <${fromEmail}>`
      : fromEmail || fromName || '(Unknown)';

    const toEls = root.querySelectorAll('.g2');
    const to = Array.from(toEls).map(el => {
      const n = el.getAttribute('name')  || el.textContent.trim();
      const e = el.getAttribute('email') || '';
      return n && e ? `${n} <${e}>` : e || n;
    }).filter(Boolean).join(', ') || 'me';

    const dateEl = root.querySelector('.g3');
    const date = dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '';

    return { subject, from, to, date };
  }

  function extractOutlookHeaders() {
    const subject =
      document.querySelector('[data-testid="subject"]')?.textContent?.trim() ||
      document.querySelector('.XbIp4')?.textContent?.trim() ||
      '(No Subject)';
    const fromEl =
      document.querySelector('[data-testid="senderName"]') ||
      document.querySelector('.OZZZK');
    const from = fromEl?.textContent?.trim() || '(Unknown)';
    const dateEl =
      document.querySelector('[data-testid="receivedDateTime"]') ||
      document.querySelector('._16RYR');
    const date = dateEl?.textContent?.trim() || '';
    return { subject, from, to: 'me', date };
  }

  // ── Body extraction ───────────────────────────────────────────────────────

  const NOISE_SELECTORS = [
    '.aQH', '.aZo', '.aZl', '.aQy', '.ata-asE',
    '.gmail_quote', '.gmail_extra', '[data-smartmail]', '.iHOt4', '.bzn',
  ];

  function extractGmailBody(scope) {
    const root = scope || document;
    const bodyNode = root.querySelector('.a3s.aiL') || root.querySelector('.a3s');
    if (!bodyNode) return null;
    const clone = bodyNode.cloneNode(true);
    NOISE_SELECTORS.forEach(sel => clone.querySelectorAll(sel).forEach(el => el.remove()));
    return clone;
  }

  function extractOutlookBody() {
    const nodes = document.querySelectorAll('div[data-unique-id]');
    if (!nodes.length) return null;
    return nodes[nodes.length - 1].cloneNode(true);
  }

  // ── Attachment extraction (scoped) ────────────────────────────────────────

  function extractGmailAttachments(scope) {
    const root = scope || document;
    const results = [];
    const seen = new Set();
    root.querySelectorAll('.aZo, .aij').forEach(container => {
      const name =
        container.querySelector('.aV3')?.textContent?.trim() ||
        container.querySelector('[data-tooltip]')?.getAttribute('data-tooltip') ||
        'attachment';
      const size =
        container.querySelector('.SaH2Ve-Bd-axgRH')?.textContent?.trim() ||
        container.querySelector('.aXo')?.textContent?.trim() || '';
      let downloadUrl = null;
      container.querySelectorAll('a[href]').forEach(a => {
        if (!downloadUrl && a.href &&
            (a.href.includes('&disp=') || a.href.includes('view=att')))
          downloadUrl = a.href;
      });
      if (!downloadUrl) {
        const dlBtn = container.querySelector('[data-tooltip="Download"]')?.closest('a[href]');
        if (dlBtn) downloadUrl = dlBtn.href;
      }
      const key = `${name}|${downloadUrl}`;
      if (!seen.has(key)) { seen.add(key); results.push({ name, size, downloadUrl }); }
    });
    return results;
  }

  // ── Redaction ─────────────────────────────────────────────────────────────

  function redactHeaders(h) {
    return { ...h, from: '[Sender Redacted]', to: '[Recipient Redacted]' };
  }

  function redactBodyNode(clone) {
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(t => { t.nodeValue = t.nodeValue.replace(EMAIL_REGEX, '[Redacted]'); });
  }

  // ── Plain text conversion ─────────────────────────────────────────────────

  function nodeToText(node) {
    const c = node.cloneNode(true);
    c.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      if (!href || href.startsWith('javascript') || href.startsWith('mailto:')) return;
      const label = a.textContent.trim();
      const isRawUrl = label.startsWith('http://') || label.startsWith('https://');
      a.textContent = isRawUrl || !label ? href : `${label} (${href})`;
    });
    c.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    c.querySelectorAll('p, div, tr, li').forEach(el => el.insertAdjacentText('afterend', '\n'));
    return (c.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ── HTML builder ──────────────────────────────────────────────────────────

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildHtml(headers, bodyNode, hideHeaders) {
    const headerBlock = hideHeaders ? '' : `
      <table style="font-family:sans-serif;font-size:13px;color:#333;border-collapse:collapse;margin-bottom:4px">
        <tr><td style="padding:2px 8px 2px 0;color:#888;white-space:nowrap">From</td>
            <td style="padding:2px 0"><strong>${esc(headers.from)}</strong></td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#888;white-space:nowrap">To</td>
            <td style="padding:2px 0">${esc(headers.to)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#888;white-space:nowrap">Date</td>
            <td style="padding:2px 0">${esc(headers.date)}</td></tr>
        <tr><td style="padding:2px 8px 2px 0;color:#888;white-space:nowrap">Subject</td>
            <td style="padding:2px 0"><strong>${esc(headers.subject)}</strong></td></tr>
      </table>
      <hr style="border:none;border-top:1px solid #ddd;margin:10px 0">
    `;
    const body = bodyNode?.innerHTML || '';
    return `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:720px;margin:24px auto">
      ${headerBlock}${body}
    </body></html>`;
  }

  // ── Plain text builder ────────────────────────────────────────────────────

  function buildPlainText(headers, bodyNode, attachments, hideHeaders) {
    const lines = [];
    if (!hideHeaders) {
      lines.push(`From:    ${headers.from}`);
      lines.push(`To:      ${headers.to}`);
      lines.push(`Date:    ${headers.date}`);
      lines.push(`Subject: ${headers.subject}`);
      lines.push(SEP);
    }
    if (bodyNode) lines.push(nodeToText(bodyNode));
    if (attachments.length) {
      lines.push(SEP);
      lines.push(`Attachments (${attachments.length}):`);
      attachments.forEach(a => lines.push(`  • ${a.name}${a.size ? ` (${a.size})` : ''}`));
    }
    return lines.join('\n').trim();
  }

  // ── Gmail print URL (used by background to generate real PDF via debugger) ──

  function getGmailPrintUrl(container) {
    // Method 1: find an existing view=pt link rendered on the page
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.href.includes('view=pt')) return a.href;
    }

    // Method 2: construct from ik key + thread perm ID
    let ik = null;
    for (const a of document.querySelectorAll('a[href*="ik="]')) {
      const m = a.href.match(/[?&]ik=([a-zA-Z0-9]+)/);
      if (m) { ik = m[1]; break; }
    }
    if (!ik) return null;

    // data-thread-perm-id holds the full "thread-f:NUMERIC" string
    const permEl = document.querySelector('[data-thread-perm-id]');
    const threadPerm = permEl?.getAttribute('data-thread-perm-id');
    if (!threadPerm) return null;

    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('ik', ik);
    url.searchParams.set('view', 'pt');
    url.searchParams.set('search', 'all');
    url.searchParams.set('permthid', threadPerm);

    const msgPermEl = container?.querySelector?.('[data-msg-perm-id]');
    if (msgPermEl) url.searchParams.set('simpl', msgPermEl.getAttribute('data-msg-perm-id'));

    return url.toString();
  }

  // ── Fetch attachment blobs (same-origin Gmail fetch, auth cookies present) ─

  const MAX_ATTACH_BYTES = 7 * 1024 * 1024; // Discord free upload limit

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function fetchAttachmentBlobs(atts) {
    const out = [];
    for (const att of atts) {
      if (!att.downloadUrl) continue;
      try {
        const resp = await fetch(att.downloadUrl);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        if (blob.size > MAX_ATTACH_BYTES) continue;
        const base64 = await blobToBase64(blob);
        out.push({ name: att.name, type: blob.type || 'application/octet-stream', base64 });
      } catch { /* skip on error */ }
    }
    return out;
  }

  // ── List mode: enumerate all open emails in thread ────────────────────────

  function listGmailEmails() {
    const containers = getGmailContainers();
    if (!containers.length) return { emails: [] };
    const subject = document.querySelector('h2.hP')?.textContent?.trim() || '(No Subject)';
    const emails = containers.map((container, index) => {
      const fromEl = container.querySelector('.gD');
      const fromName  = fromEl?.getAttribute('name')  || fromEl?.textContent?.trim() || '';
      const fromEmail = fromEl?.getAttribute('email') || '';
      const from = fromName || fromEmail || '(Unknown)';
      const dateEl = container.querySelector('.g3');
      const date = dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '';
      const bodyEl = container.querySelector('.a3s.aiL') || container.querySelector('.a3s');
      const snippet = bodyEl
        ? (bodyEl.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70)
        : '';
      return { index, from, subject, date, snippet };
    });
    return { emails };
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  const source = detectSource();
  if (!source) return { error: 'Unsupported page. Open a Gmail or Outlook email first.' };

  if (mode === 'list' && source === 'gmail') return listGmailEmails();

  let container = null;
  let headers, bodyNode, attachments;

  if (source === 'gmail') {
    container   = getGmailContainer(emailIndex);
    headers     = extractGmailHeaders(container);
    bodyNode    = extractGmailBody(container);
    attachments = extractGmailAttachments(container);
  } else {
    headers     = extractOutlookHeaders();
    bodyNode    = extractOutlookBody();
    attachments = [];
  }

  if (!bodyNode) return { error: 'No open email found. Click on an email to expand it.' };

  const hideHeaders = window.__emailPorterHideHeaders__ === true;
  if (hideHeaders) {
    headers = redactHeaders(headers);
    redactBodyNode(bodyNode);
  }

  const attachmentData = (source === 'gmail') ? await fetchAttachmentBlobs(attachments) : [];
  const printUrl = (source === 'gmail') ? getGmailPrintUrl(container) : null;

  return {
    html:           buildHtml(headers, bodyNode, hideHeaders),
    plainText:      buildPlainText(headers, bodyNode, attachments, hideHeaders),
    headers,
    attachments,
    attachmentData,
    printUrl,
    source,
  };
})();
