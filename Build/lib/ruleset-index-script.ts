/**
 * Progressive-enhancement client script inlined into public/index.html.
 * When JavaScript is disabled, all search controls remain hidden and every
 * file link remains directly navigable as static HTML.
 */
export const RULESET_INDEX_SCRIPT = String.raw`(() => {
  const controls = document.querySelector('#tree-filter');
  const input = document.querySelector('#tree-query');
  const clear = document.querySelector('#tree-clear');
  const status = document.querySelector('#tree-status');
  const copyStatus = document.querySelector('#copy-status');

  // Suppress transitions on OS theme flips so colors snap cleanly without smearing.
  const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  darkMedia.addEventListener('change', () => {
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none !important}';
    document.head.append(style);
    void document.body.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  });

  // Inject quiet Copy URL buttons dynamically so static HTML stays compact and no-JS stays clean.
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
  copyTemplate.className = 'copy-url';
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

  // Copy full subscription URL with contextual icon cross-fade and polite announcement.
  const copyTimers = new WeakMap();
  const canonical = document.querySelector('link[rel="canonical"]')?.href || 'https://nrrule.pages.dev/';
  const useCanonical =
    location.protocol === 'file:' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === 'localhost';
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

  document.addEventListener('click', async (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-copy-url]') : null;
    if (!btn) return;
    const anchor = btn.closest('li.file')?.querySelector('a.file-link');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    const name = anchor.textContent?.trim() || href;
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
  });

  if (!controls || !input || !clear || !status) return;

  // Live directory tree filter
  const branches = [...document.querySelectorAll('details[data-branch]')];
  const counters = new Map();
  for (const branch of branches) {
    const node = branch.querySelector(':scope > summary [data-branch-count]');
    if (node) counters.set(branch, { node, total: node.textContent || '' });
  }

  const slotAliases = new Map([
    ['nonip', 'non_ip'],
    ['non_ip', 'non_ip'],
    ['non-ip', 'non_ip'],
    ['ip', 'ip'],
    ['domainset', 'domainset'],
    ['domain-set', 'domainset'],
    ['merged', 'merged'],
  ]);
  const termAliases = new Map([
    ['mihomo', 'clash'],
    ['list', 'surge'],
    ['singbox', 'sing-box'],
  ]);

  function normalizeText(value) {
    return value.normalize('NFKC').toLowerCase();
  }

  function formatMatches(count) {
    return count + (count === 1 ? ' matching file' : ' matching files');
  }

  const entries = fileRows.map((node) => {
    const data = node.dataset;
    const parents = [];
    for (let p = node.closest('details[data-branch]'); p; p = p.parentElement?.closest('details[data-branch]')) {
      parents.push(p);
    }
    const anchor = node.querySelector('a.file-link');
    const href = anchor?.getAttribute('href') || '';
    let decoded = href;
    try { decoded = decodeURIComponent(href); } catch {}
    const pathLower = normalizeText(decoded);
    const fields = [
      data.region,
      data.slot,
      data.slotLabel,
      data.format,
      data.rule,
      pathLower.split('/').pop(),
      pathLower,
      href,
    ].filter(Boolean).map(normalizeText);
    const words = fields.flatMap((part) => [part, ...part.split(/[^\p{L}\p{N}]+/u).filter(Boolean)]);
    return { node, parents, pathLower, hrefLower: normalizeText(href), words, slot: data.slot || 'resource' };
  });

  let openedBeforeSearch = null;

  function applyFilter() {
    const cleaned = normalizeText(input.value)
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

    if (tokens.length && !openedBeforeSearch) {
      openedBeforeSearch = new Set(branches.filter((b) => b.open));
    }

    const matches = new Map();
    let totalMatches = 0;

    for (const entry of entries) {
      const show = tokens.every(({ raw, decoded }) => {
        if (slotAliases.has(decoded)) return slotAliases.get(decoded) === entry.slot;
        if (decoded.includes('/') || decoded.startsWith('.')) {
          return entry.pathLower.includes(decoded) || entry.hrefLower.includes(raw);
        }
        const term = termAliases.get(decoded) ?? decoded;
        return entry.words.some((w) => w.startsWith(term) || (/\p{Script=Han}/u.test(term) && w.includes(term)));
      });
      entry.node.hidden = !show;
      if (show) {
        totalMatches++;
        if (tokens.length) {
          for (const parent of entry.parents) {
            matches.set(parent, (matches.get(parent) ?? 0) + 1);
          }
        }
      }
    }

    for (const branch of branches) {
      const counter = counters.get(branch);
      if (counter) {
        counter.node.textContent = tokens.length ? formatMatches(matches.get(branch) ?? 0) : counter.total;
      }
      branch.hidden = tokens.length > 0 && !matches.has(branch);
      if (branch.parentElement?.tagName === 'LI') {
        branch.parentElement.hidden = branch.hidden;
      }
      if (tokens.length) branch.open = matches.has(branch);
      else if (openedBeforeSearch) branch.open = openedBeforeSearch.has(branch);
    }

    if (!tokens.length) openedBeforeSearch = null;
    clear.disabled = !input.value;
    if (!tokens.length) status.textContent = '';
    else status.textContent = totalMatches ? formatMatches(totalMatches) : 'No matching files. Try a shorter search.';
  }

  function resetFilter() {
    input.value = '';
    applyFilter();
    input.focus();
  }

  input.addEventListener('input', applyFilter);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (input.value) {
        event.preventDefault();
        resetFilter();
      } else {
        input.blur();
      }
    }
  });
  clear.addEventListener('click', resetFilter);

  document.addEventListener('keydown', (event) => {
    if (
      event.key === '/' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      document.activeElement !== input &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')
    ) {
      event.preventDefault();
      input.focus();
      input.select();
    }
  });

  controls.hidden = false;
  applyFilter();
})();`;
