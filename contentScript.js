(() => {
  const ANCHOR_CLASS = "sitenotes-anchor";
  const TOOLTIP_ID = "sitenotes-anchor-tooltip";
  const STYLE_ID = "sitenotes-anchor-style";

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

    // Keep tooltip visible while hovered so links can be clicked.
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

  function wrapTextRange(node, start, length, tooltipHtml, firstLink) {
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

        // If the underlying page text is already part of a native link, don't intercept.
        if (el.closest("a")) return;

        event.preventDefault();
        event.stopPropagation();
        window.open(firstLink, "_blank", "noopener,noreferrer");
      });
    });
  }

  function trimToLength(text, maxLength) {
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeUrl(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) return "#";
    if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
    return "#";
  }

  function extractFirstLinkFromMarkdown(content) {
    const text = String(content || "");

    const mdMatch = text.match(/\[[^\]]+\]\(([^)]+)\)/);
    if (mdMatch && mdMatch[1]) {
      const safe = sanitizeUrl(mdMatch[1]);
      if (safe !== "#") return safe;
    }

    const plainMatch = text.match(/https?:\/\/[^\s)]+/);
    if (plainMatch && plainMatch[0]) {
      const safe = sanitizeUrl(plainMatch[0]);
      if (safe !== "#") return safe;
    }

    const wwwMatch = text.match(/\bwww\.[^\s)]+/i);
    if (wwwMatch && wwwMatch[0]) {
      const safe = sanitizeUrl(wwwMatch[0]);
      if (safe !== "#") return safe;
    }

    return "";
  }

  function renderInlineMarkdown(text) {
    let html = escapeHtml(text || "");

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safe = sanitizeUrl(url);
      if (safe === "#") return label;
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (m, prefix, url) => {
      const safe = sanitizeUrl(url);
      return `${prefix}<a href="${safe}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });

    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    return html;
  }

  function renderBasicMarkdown(text) {
    const normalized = String(text || "").replace(/\r\n/g, "\n");
    if (!normalized.trim()) return "";

    return normalized
      .split(/\n{2,}/)
      .map((block) => `<p>${renderInlineMarkdown(block).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function buildTooltipHtml(note) {
    const preview = trimToLength(note.content || "", 220);
    const renderedPreview = renderBasicMarkdown(preview || "Attached note");
    const tagsHtml = Array.isArray(note.tags) && note.tags.length
      ? `<p><strong>Tags:</strong> ${note.tags
          .map((t) => `#${escapeHtml(t)}`)
          .join(" ")}</p>`
      : "";

    return `${renderedPreview}${tagsHtml}`;
  }

  async function loadAnchoredNotesForPage() {
    const normalizedUrl = getNormalizedPageUrl();
    const data = await chrome.storage.local.get(null);

    return Object.entries(data)
      .filter(([key, value]) => key !== "__siteNotesTags__" && Array.isArray(value))
      .flatMap(([, notes]) => notes)
      .filter(
        (note) =>
          note &&
          note.url === normalizedUrl &&
          note.anchor &&
          note.anchor.type === "text-quote" &&
          typeof note.anchor.exact === "string" &&
          note.anchor.exact.length > 0
      )
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  async function renderAnchors() {
    if (!document.body) return;

    ensureStyles();
    clearExistingAnchors();

    const anchoredNotes = await loadAnchoredNotesForPage();
    if (!anchoredNotes.length) return;

    anchoredNotes.forEach((note) => {
      const match = getBestTextMatch(document.body, note.anchor);
      if (!match) return;

      wrapTextRange(
        match.node,
        match.index,
        note.anchor.exact.length,
        buildTooltipHtml(note),
        extractFirstLinkFromMarkdown(note.content)
      );
    });

    attachTooltipHandlers();
  }

  function scheduleRender() {
    // Wait a tick to allow dynamic page text to settle after navigation/updates.
    window.setTimeout(() => {
      renderAnchors();
    }, 250);
  }

  document.addEventListener("DOMContentLoaded", scheduleRender);
  window.addEventListener("load", scheduleRender);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    // Re-render for any local notes/tag update since anchors may have changed.
    if (changes) scheduleRender();
  });

  // Initial render for already-loaded documents.
  scheduleRender();
})();
