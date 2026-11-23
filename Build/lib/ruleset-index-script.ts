/**
 * Progressive-enhancement client script inlined into public/index.html.
 * Adds per-file copy buttons and a coss ui style command dialog (Cmd/Ctrl+K or /).
 * When JavaScript is disabled, the search trigger stays hidden and every file link
 * remains directly navigable as static HTML.
 */
export const RULESET_INDEX_SCRIPT = String.raw`(() => {
  const copyStatus = document.querySelector('#copy-status');
  const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  darkMedia.addEventListener('change', () => {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.append(style);
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  });

  const svgNs = 'http://www.w3.org/2000/svg';
  function createUseSvg(id) {
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('class', 'ico-sm');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(svgNs, 'use');
    use.setAttribute('href', '#' + id);
    svg.append(use);
    return svg;
  }

  const copyTemplate = document.createElement('button');
  copyTemplate.type = 'button';
  copyTemplate.className = "copy-url coss-btn coss-btn-outline coss-btn-xs";
  copyTemplate.dataset.copyUrl = '';
  const swapSpan = document.createElement('span');
  swapSpan.className = 'icon-swap';
  swapSpan.setAttribute('aria-hidden', 'true');
  const copyLayer = document.createElement('span');
  copyLayer.className = 'icon-layer icon-copy';
  copyLayer.append(createUseSvg('ico-copy'));
  const checkLayer = document.createElement('span');
  checkLayer.className = 'icon-layer icon-check';
  checkLayer.append(createUseSvg('ico-check'));
  swapSpan.append(copyLayer, checkLayer);
  const labelSpan = document.createElement('span');
  labelSpan.className = 'copy-label';
  labelSpan.textContent = 'Copy';
  copyTemplate.append(swapSpan, labelSpan);

  const fileRows = [...document.querySelectorAll('li.file[data-leaf]')];
  for (const row of fileRows) {
    const anchor = row.querySelector('a.file-link');
    if (!anchor) continue;
    const btn = copyTemplate.cloneNode(true);
    btn.setAttribute('aria-label', 'Copy URL for ' + (anchor.textContent?.trim() || 'file'));
    row.append(btn);
  }

  const copyTimers = new WeakMap();
  const canonical = document.querySelector('link[rel="canonical"]')?.href || 'https://nrrule.pages.dev/';
  const useCanonical = location.protocol === 'file:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  const baseOrigin = useCanonical ? new URL(canonical).origin : location.origin;

  async function writeClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  async function triggerCopy(btn, href, name) {
    const fullUrl = new URL(href, baseOrigin).href;
    try {
      await writeClipboard(fullUrl);
      const prev = copyTimers.get(btn);
      if (prev) clearTimeout(prev);
      btn.dataset.copied = 'true';
      const label = btn.querySelector('.copy-label');
      if (label) label.textContent = 'Copied';
      if (copyStatus) {
        copyStatus.textContent = '';
        requestAnimationFrame(() => {
          copyStatus.textContent = 'Copied URL for ' + name;
        });
      }
      copyTimers.set(btn, setTimeout(() => {
        delete btn.dataset.copied;
        if (label) label.textContent = 'Copy';
      }, 1600));
    } catch {
      if (copyStatus) {
        copyStatus.textContent = 'Unable to copy URL. Open the link directly to copy from the address bar.';
      }
    }
  }

  document.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-copy-url]') : null;
    if (!btn) return;
    const directHref = btn.dataset.href;
    if (directHref) {
      triggerCopy(btn, directHref, btn.dataset.name || directHref);
      return;
    }
    const anchor = btn.closest('li.file')?.querySelector('a.file-link');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    triggerCopy(btn, href, anchor.textContent?.trim() || href);
  });

  const slotAliases = new Map([
    ['nonip', 'non_ip'], ['non_ip', 'non_ip'], ['non-ip', 'non_ip'],
    ['ip', 'ip'], ['domainset', 'domainset'], ['domain-set', 'domainset'], ['merged', 'merged'],
  ]);
  const termAliases = new Map([['mihomo', 'clash'], ['list', 'surge'], ['singbox', 'sing-box']]);
  function normalizeText(value) { return value.normalize('NFKC').toLowerCase(); }

  const entries = fileRows.map((node) => {
    const data = node.dataset;
    const parents = [];
    for (let p = node.closest('details[data-branch]'); p; p = p.parentElement?.closest('details[data-branch]')) {
      parents.push(p);
    }
    const anchor = node.querySelector('a.file-link');
    const href = anchor?.getAttribute('href') || '';
    const name = anchor?.textContent?.trim() || href;
    let decoded = href;
    try { decoded = decodeURIComponent(href); } catch {}
    const pathLower = normalizeText(decoded);
    const fields = [data.region, data.slot, data.slotLabel, data.format, data.rule, pathLower.split('/').pop(), pathLower, href]
      .filter(Boolean).map(normalizeText);
    const words = fields.flatMap((part) => [part, ...part.split(/[^\p{L}\p{N}]+/u).filter(Boolean)]);
    const topFolder = parents.length ? (parents[parents.length - 1].dataset.folder || 'Root') : 'Root';
    return { node, parents, href, name, decoded, pathLower, hrefLower: normalizeText(href), words, slot: data.slot || 'resource', region: data.region || topFolder, format: data.format || '' };
  });

  function matchEntries(queryRaw) {
    const cleaned = normalizeText(queryRaw)
      .trim()
      .replace(/\bnon\s+ip\b/g, 'non_ip')
      .replace(/\bdestination\s+ip\b/g, 'ip')
      .replace(/\bdomain\s+set\b/g, 'domainset');
    const tokens = cleaned
      ? cleaned.split(/\s+/u).map((raw) => {
          try { return { raw, decoded: normalizeText(decodeURIComponent(raw)) }; }
          catch { return { raw, decoded: raw }; }
        })
      : [];
    return { tokens, matches: entries.filter((entry) => tokens.every(({ raw, decoded }) => {
      if (slotAliases.has(decoded)) return slotAliases.get(decoded) === entry.slot;
      if (decoded.includes('/') || decoded.startsWith('.')) {
        return entry.pathLower.includes(decoded) || entry.hrefLower.includes(raw);
      }
      const term = termAliases.get(decoded) ?? decoded;
      return entry.words.some((w) => w.startsWith(term) || (/\p{Script=Han}/u.test(term) && w.includes(term)));
    })) };
  }

  const trigger = document.querySelector('#cmd-trigger');
  const dialog = document.querySelector('#cmd-dialog');
  const cmdInput = document.querySelector('#cmd-query');
  const cmdResults = document.querySelector('#cmd-results');
  const cmdStatus = document.querySelector('#cmd-status');
  const cmdClose = document.querySelector('#cmd-close');
  if (!trigger || !dialog || !cmdInput || !cmdResults || !cmdStatus) return;

  let highlightedIdx = 0;
  let renderedItems = [];

  function renderResults() {
    const { matches } = matchEntries(cmdInput.value);
    cmdResults.textContent = '';
    renderedItems = [];
    highlightedIdx = 0;

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'cmd-empty';
      empty.textContent = 'No matching files found.';
      cmdResults.append(empty);
      cmdStatus.textContent = '0 matches';
      return;
    }

    const groups = new Map();
    for (const item of matches) {
      const g = item.region || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(item);
    }

    const fragment = document.createDocumentFragment();
    for (const [groupName, items] of groups) {
      const grp = document.createElement('section');
      grp.className = 'cmd-group';
      const lbl = document.createElement('h3');
      lbl.className = 'cmd-group-label';
      lbl.textContent = groupName;
      const ul = document.createElement('ul');
      ul.className = 'cmd-items';

      for (const item of items) {
        const idx = renderedItems.length;
        const li = document.createElement('li');
        li.className = 'cmd-item';
        li.dataset.highlighted = idx === 0 ? 'true' : 'false';

        const a = document.createElement('a');
        a.className = 'cmd-item-link';
        a.href = item.href;
        a.append(createUseSvg('ico-file'));
        const spanPath = document.createElement('span');
        spanPath.className = 'cmd-item-path';
        spanPath.textContent = item.decoded.replace(/^\//, '');
        a.append(spanPath);

        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = "cmd-item-copy coss-btn coss-btn-outline coss-btn-xs";
        copyBtn.dataset.copyUrl = '';
        copyBtn.dataset.href = item.href;
        copyBtn.dataset.name = item.name;
        copyBtn.setAttribute('aria-label', 'Copy URL for ' + item.decoded.replace(/^\//, ''));
        const lblCopy = document.createElement('span');
        lblCopy.className = 'copy-label';
        lblCopy.textContent = 'Copy';
        copyBtn.append(lblCopy);

        li.addEventListener('mouseenter', () => setHighlight(idx));
        li.append(a, copyBtn);
        ul.append(li);
        renderedItems.push({ li, a, copyBtn, item });
      }
      grp.append(lbl, ul);
      fragment.append(grp);
    }
    cmdResults.append(fragment);

    cmdStatus.textContent = matches.length + (matches.length === 1 ? ' match' : ' matches');
  }

  function setHighlight(nextIdx) {
    if (!renderedItems.length) return;
    renderedItems[highlightedIdx]?.li.setAttribute('data-highlighted', 'false');
    highlightedIdx = (nextIdx + renderedItems.length) % renderedItems.length;
    renderedItems[highlightedIdx].li.dataset.highlighted = 'true';
    renderedItems[highlightedIdx].li.scrollIntoView({ block: 'nearest' });
  }

  function openDialog() {
    if (dialog.open) return;
    renderResults();
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      cmdInput.focus();
      cmdInput.select();
    });
  }

  function closeDialog() {
    if (!dialog.open) return;
    dialog.close();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus();
  }

  trigger.addEventListener('click', openDialog);
  if (cmdClose) cmdClose.addEventListener('click', closeDialog);
  dialog.addEventListener('close', () => trigger.setAttribute('aria-expanded', 'false'));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  cmdInput.addEventListener('input', renderResults);
  cmdInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight(highlightedIdx + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight(highlightedIdx - 1);
    } else if (event.key === 'Enter' && renderedItems[highlightedIdx]) {
      event.preventDefault();
      renderedItems[highlightedIdx].a.click();
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && !window.getSelection()?.toString()) {
      const cur = renderedItems[highlightedIdx];
      if (cur) {
        event.preventDefault();
        triggerCopy(cur.copyBtn, cur.item.href, cur.item.name);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    }
  });

  document.addEventListener('keydown', (event) => {
    const isMetaK = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
    const isSlash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
    if ((isMetaK || isSlash) && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      event.preventDefault();
      if (dialog.open && isMetaK) closeDialog();
      else openDialog();
    }
  });

  trigger.hidden = false;
})();`;
