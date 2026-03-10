(() => {
  const ANCHOR_CLASS = "sitenotes-anchor";
  const TOOLTIP_ID = "sitenotes-anchor-tooltip";
  const STYLE_ID = "sitenotes-anchor-style";
  const TAGS_STORAGE_KEY = "__siteNotesTags__";
  const MARKDOWN = globalThis.SiteNotesMarkdown || {};
  let renderTimerId = null;

  function isYouTubeVideo(url) {
    return (
      url.hostname.includes("youtube.com") &&
      url.pathname === "/watch" &&
      url.searchParams.has("v")
    );
  }

  function getNormalizedPageUrl() {
    try {
      const url = new URL(window.location.href);
      if (isYouTubeVideo(url)) {
        return `${url.origin}${url.pathname}?v=${url.searchParams.get("v")}`;
      }
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return window.location.href;
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${ANCHOR_CLASS} {
        background: rgba(59, 130, 246, 0.16);
        border-bottom: 2px dashed rgba(37, 99, 235, 0.7);
        cursor: help;
        border-radius: 2px;
      }

      .${ANCHOR_CLASS}.has-link {
        cursor: pointer;
      }

      #${TOOLTIP_ID} {
        position: fixed;
        z-index: 2147483647;
        max-width: 320px;
        background: #111827;
        color: #f9fafb;
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.4;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        pointer-events: auto;
        opacity: 0;
        transform: translateY(4px);
        transition: opacity 120ms ease, transform 120ms ease;
        white-space: normal;
      }

      #${TOOLTIP_ID}.visible {
        opacity: 1;
        transform: translateY(0);
      }

      #${TOOLTIP_ID} p {
        margin: 0 0 6px;
      }

      #${TOOLTIP_ID} p:last-child {
        margin-bottom: 0;
      }

      #${TOOLTIP_ID} h1,
      #${TOOLTIP_ID} h2,
      #${TOOLTIP_ID} h3,
      #${TOOLTIP_ID} h4,
      #${TOOLTIP_ID} h5,
      #${TOOLTIP_ID} h6 {
        margin: 0 0 6px;
        line-height: 1.25;
      }

      #${TOOLTIP_ID} h1 {
        font-size: 13px;
      }

      #${TOOLTIP_ID} h2,
      #${TOOLTIP_ID} h3,
      #${TOOLTIP_ID} h4,
      #${TOOLTIP_ID} h5,
      #${TOOLTIP_ID} h6 {
        font-size: 12px;
      }

      #${TOOLTIP_ID} ul {
        margin: 0 0 6px 16px;
        padding: 0;
      }

      #${TOOLTIP_ID} li {
        margin: 0 0 3px;
      }

      #${TOOLTIP_ID} li:last-child {
        margin-bottom: 0;
      }

      #${TOOLTIP_ID} a {
        color: #93c5fd;
        text-decoration: underline;
      }

      #${TOOLTIP_ID} code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
          "Liberation Mono", "Courier New", monospace;
        font-size: 11px;
        background: rgba(255, 255, 255, 0.12);
        border-radius: 4px;
        padding: 1px 4px;
      }

      #${TOOLTIP_ID} strong {
        font-weight: 600;
      }

      #${TOOLTIP_ID} em {
        font-style: italic;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function ensureTooltip() {
    let tooltip = document.getElementById(TOOLTIP_ID);
    if (tooltip) return tooltip;

    tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ID;
    document.documentElement.appendChild(tooltip);

    tooltip.addEventListener("mouseenter", () => {
      if (window.__siteNotesHideTooltipTimeout) {
        clearTimeout(window.__siteNotesHideTooltipTimeout);
      }
    });
    tooltip.addEventListener("mouseleave", () => {
      tooltip.classList.remove("visible");
    });

    return tooltip;
  }

  function moveTooltip(tooltip, event) {
    const offset = 14;
    let left = event.clientX + offset;
    let top = event.clientY + offset;

    const rect = tooltip.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - rect.height - 8;

    left = Math.max(8, Math.min(left, maxLeft));
    top = Math.max(8, Math.min(top, maxTop));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function clearExistingAnchors() {
    const anchors = Array.from(document.querySelectorAll(`.${ANCHOR_CLASS}`));
    anchors.forEach((anchor) => {
      const textNode = document.createTextNode(anchor.textContent || "");
      anchor.replaceWith(textNode);
    });
  }

  function isEligibleTextNode(node) {
    if (!node || !node.nodeValue || !node.nodeValue.trim()) return false;
    const parent = node.parentElement;
    if (!parent) return false;
    if (
      parent.closest("script, style, noscript, textarea, input, select") ||
      parent.closest(`#${TOOLTIP_ID}`) ||
      parent.classList.contains(ANCHOR_CLASS)
    ) {
      return false;
    }
    return true;
  }

  function getBestTextMatch(root, anchor) {
    const exact = anchor.exact;
    if (!exact) return null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let best = null;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!isEligibleTextNode(node)) continue;

      const text = node.nodeValue;
      let searchStart = 0;
      while (searchStart < text.length) {
        const idx = text.indexOf(exact, searchStart);
        if (idx === -1) break;

        const before = text.slice(Math.max(0, idx - 120), idx);
        const after = text.slice(idx + exact.length, idx + exact.length + 120);

        let score = 1;
        if (anchor.prefix && before.endsWith(anchor.prefix)) score += 3;
        if (anchor.suffix && after.startsWith(anchor.suffix)) score += 3;

        if (!best || score > best.score) {
          best = { node, index: idx, score };
        }

        searchStart = idx + exact.length;
      }
    }

    return best;
  }

  function wrapTextRange(node, start, length, tooltipHtml, firstLink, noteKey, anchorId) {
    try {
      const fullText = node.nodeValue || "";
      const beforeText = fullText.slice(0, start);
      const matchText = fullText.slice(start, start + length);
      const afterText = fullText.slice(start + length);

      const beforeNode = beforeText ? document.createTextNode(beforeText) : null;
      const matchNode = document.createTextNode(matchText);
      const afterNode = afterText ? document.createTextNode(afterText) : null;

      const wrapper = document.createElement("span");
      wrapper.className = ANCHOR_CLASS;
      wrapper.dataset.noteTooltipHtml = tooltipHtml;
      wrapper.dataset.noteKey = noteKey || "";
      wrapper.dataset.anchorId = anchorId || "";
      if (firstLink) {
        wrapper.classList.add("has-link");
        wrapper.dataset.noteFirstLink = firstLink;
      }
      wrapper.appendChild(matchNode);

      const fragment = document.createDocumentFragment();
      if (beforeNode) fragment.appendChild(beforeNode);
      fragment.appendChild(wrapper);
      if (afterNode) fragment.appendChild(afterNode);

      node.replaceWith(fragment);
      return wrapper;
    } catch {
      return null;
    }
  }

  function attachTooltipHandlers() {
    const tooltip = ensureTooltip();

    document.querySelectorAll(`.${ANCHOR_CLASS}`).forEach((el) => {
      el.addEventListener("mouseenter", (event) => {
        if (window.__siteNotesHideTooltipTimeout) {
          clearTimeout(window.__siteNotesHideTooltipTimeout);
        }
        tooltip.innerHTML = el.dataset.noteTooltipHtml || "Attached note";
        tooltip.classList.add("visible");
        moveTooltip(tooltip, event);
      });

      el.addEventListener("mousemove", (event) => {
        moveTooltip(tooltip, event);
      });

      el.addEventListener("mouseleave", () => {
        window.__siteNotesHideTooltipTimeout = window.setTimeout(() => {
          tooltip.classList.remove("visible");
        }, 120);
      });

      el.addEventListener("click", (event) => {
        const firstLink = el.dataset.noteFirstLink;
        if (!firstLink) return;

        if (el.closest("a")) return;

        event.preventDefault();
        event.stopPropagation();
        window.open(firstLink, "_blank", "noopener,noreferrer");
      });
    });
  }

  function trimToLength(text, maxLength) {
    if (typeof MARKDOWN.trimToLength === "function") {
      return MARKDOWN.trimToLength(text, maxLength);
    }
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function escapeHtml(text) {
    if (typeof MARKDOWN.escapeHtml === "function") {
      return MARKDOWN.escapeHtml(text);
    }
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function extractFirstLinkFromMarkdown(content) {
    if (typeof MARKDOWN.extractFirstLinkFromMarkdown === "function") {
      return MARKDOWN.extractFirstLinkFromMarkdown(content);
    }
    return "";
  }

  function renderBasicMarkdown(text) {
    if (typeof MARKDOWN.renderBasicMarkdown === "function") {
      return MARKDOWN.renderBasicMarkdown(text);
    }
    return escapeHtml(text || "");
  }

  function buildTooltipHtml(note) {
    const rawContent = String(note.content || "");
    const hasMarkdownLink = /\[[^\]]+\]\([^)]+\)/.test(rawContent);
    const preview = hasMarkdownLink
      ? trimToLength(rawContent, 1200)
      : trimToLength(rawContent, 220);
    const renderedPreview = renderBasicMarkdown(preview || "Attached note");
    const tagsHtml = Array.isArray(note.tags) && note.tags.length
      ? `<p><strong>Tags:</strong> ${note.tags
          .map((t) => `#${escapeHtml(t)}`)
          .join(" ")}</p>`
      : "";

    return `${renderedPreview}${tagsHtml}`;
  }

  function getAnchorsForUrl(note, url) {
    const results = [];

    if (
      note.url === url &&
      note.anchor?.type === "text-quote" &&
      typeof note.anchor?.exact === "string" &&
      note.anchor.exact.length > 0
    ) {
      results.push({ anchor: note.anchor, anchorId: "legacy-primary" });
    }

    if (Array.isArray(note.linkedAnchors)) {
      note.linkedAnchors.forEach((entry, idx) => {
        if (!entry || entry.url !== url) return;
        if (
          entry.anchor?.type !== "text-quote" ||
          typeof entry.anchor?.exact !== "string" ||
          !entry.anchor.exact
        ) {
          return;
        }
        results.push({ anchor: entry.anchor, anchorId: entry.id || `idx-${idx}` });
      });
    }

    return results;
  }

  function noteHasAnchorForUrl(note, url) {
    if (!note || typeof note !== "object") return false;
    return getAnchorsForUrl(note, url).length > 0;
  }

  function bucketHasAnchorForUrl(bucketValue, url) {
    if (!Array.isArray(bucketValue)) return false;
    return bucketValue.some((note) => noteHasAnchorForUrl(note, url));
  }

  function shouldRerenderForStorageChanges(changes) {
    const normalizedUrl = getNormalizedPageUrl();

    return Object.entries(changes || {}).some(([key, delta]) => {
      if (key === TAGS_STORAGE_KEY) return false;
      if (!delta) return false;

      return (
        bucketHasAnchorForUrl(delta.oldValue, normalizedUrl) ||
        bucketHasAnchorForUrl(delta.newValue, normalizedUrl)
      );
    });
  }

  function getNoteKey(note) {
    return `${note.url}::${note.createdAt}`;
  }

  async function loadAnchoredNotesForPage() {
    const normalizedUrl = getNormalizedPageUrl();
    const data = await chrome.storage.local.get(null);

    return Object.entries(data)
      .filter(([key, value]) => key !== "__siteNotesTags__" && Array.isArray(value))
      .flatMap(([, notes]) => notes)
      .flatMap((note) => {
        if (!note) return [];
        return getAnchorsForUrl(note, normalizedUrl).map((entry) => ({
          note,
          anchor: entry.anchor,
          anchorId: entry.anchorId,
          noteKey: getNoteKey(note),
        }));
      })
      .sort((a, b) => new Date(a.note.createdAt) - new Date(b.note.createdAt));
  }

  async function renderAnchors() {
    if (!document.body) return;

    ensureStyles();
    clearExistingAnchors();

    const anchoredNotes = await loadAnchoredNotesForPage();
    if (!anchoredNotes.length) return;

    anchoredNotes.forEach((item) => {
      const match = getBestTextMatch(document.body, item.anchor);
      if (!match) return;

      wrapTextRange(
        match.node,
        match.index,
        item.anchor.exact.length,
        buildTooltipHtml(item.note),
        extractFirstLinkFromMarkdown(item.note.content),
        item.noteKey,
        item.anchorId
      );
    });

    attachTooltipHandlers();
  }

  function scheduleRender(delayMs = 150) {
    if (renderTimerId) {
      window.clearTimeout(renderTimerId);
    }

    renderTimerId = window.setTimeout(() => {
      renderTimerId = null;
      renderAnchors();
    }, delayMs);
  }

  document.addEventListener("DOMContentLoaded", scheduleRender);
  window.addEventListener("load", scheduleRender);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (shouldRerenderForStorageChanges(changes)) {
      scheduleRender();
    }
  });

  scheduleRender();
})();
