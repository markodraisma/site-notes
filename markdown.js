(() => {
  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function trimToLength(text, maxLength) {
    if (!text) return "";
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
  }

  function sanitizeUrl(url) {
    const trimmed = String(url || "").trim();
    if (!trimmed) return "#";
    if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
    return "#";
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

    const lines = normalized.split("\n");
    const htmlParts = [];
    let paragraphLines = [];
    let listItems = [];

    const flushParagraph = () => {
      if (!paragraphLines.length) return;
      htmlParts.push(
        `<p>${renderInlineMarkdown(paragraphLines.join("\n")).replace(/\n/g, "<br>")}</p>`
      );
      paragraphLines = [];
    };

    const flushList = () => {
      if (!listItems.length) return;
      htmlParts.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
      listItems = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();

      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }

      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        const level = headingMatch[1].length;
        const headingText = renderInlineMarkdown(headingMatch[2].trim());
        htmlParts.push(`<h${level}>${headingText}</h${level}>`);
        continue;
      }

      const listMatch = line.match(/^[-*]\s+(.+)$/);
      if (listMatch) {
        flushParagraph();
        listItems.push(renderInlineMarkdown(listMatch[1].trim()));
        continue;
      }

      flushList();
      paragraphLines.push(line);
    }

    flushParagraph();
    flushList();
    return htmlParts.join("");
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

  function escapeMarkdownText(text) {
    return String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/([`*_\[\]()])/g, "\\$1");
  }

  function normalizeWhitespace(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ");
  }

  function resolveUrlForMarkdown(rawUrl, baseUrl) {
    const raw = String(rawUrl || "").trim();
    if (!raw) return "";

    const safe = sanitizeUrl(raw);
    if (safe !== "#") return safe;

    if (!baseUrl) return "";

    try {
      const resolved = new URL(raw, baseUrl).href;
      const resolvedSafe = sanitizeUrl(resolved);
      return resolvedSafe === "#" ? "" : resolvedSafe;
    } catch {
      return "";
    }
  }

  function needsInlineSpacing(left, right) {
    if (!left || !right) return false;
    const leftChar = left[left.length - 1];
    const rightChar = right[0];
    if (/\s/.test(leftChar) || /\s/.test(rightChar)) return false;
    return /[A-Za-z0-9_*`\]\)]/.test(leftChar) && /[A-Za-z0-9_*`\[(]/.test(rightChar);
  }

  function joinInlineSegments(segments) {
    return segments.reduce((acc, segment) => {
      if (!segment) return acc;
      if (needsInlineSpacing(acc, segment)) {
        return `${acc} ${segment}`;
      }
      return `${acc}${segment}`;
    }, "");
  }

  function getAnchorUrlFromAttributes(node, baseUrl) {
    if (!node || typeof node.getAttribute !== "function") return "";

    const directCandidates = [
      node.getAttribute("href"),
      node.getAttribute("data-href"),
      node.getAttribute("xlink:href"),
      node.getAttribute("data-url"),
      node.getAttribute("data-link"),
    ];

    for (const candidate of directCandidates) {
      const resolved = resolveUrlForMarkdown(candidate, baseUrl);
      if (resolved) return resolved;
    }

    if (node.attributes && node.attributes.length) {
      for (const attr of Array.from(node.attributes)) {
        if (!attr?.name || !attr?.value) continue;
        if (!/href|url|link/i.test(attr.name)) continue;
        const resolved = resolveUrlForMarkdown(attr.value, baseUrl);
        if (resolved) return resolved;
      }
    }

    return "";
  }

  function renderInlineNodesToMarkdown(nodes, baseUrl = "") {
    const segments = Array.from(nodes || [])
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return escapeMarkdownText(normalizeWhitespace(node.nodeValue));
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
          return "";
        }

        const tag = node.tagName.toLowerCase();
        const innerRaw = renderInlineNodesToMarkdown(node.childNodes, baseUrl);
        const inner = innerRaw.trim();

        if (tag === "br") return "\n";
        if (tag === "strong" || tag === "b") return inner ? `**${inner}**` : "";
        if (tag === "em" || tag === "i") return inner ? `*${inner}*` : "";
        if (tag === "code") return inner ? `\`${inner}\`` : "";
        if (tag === "a") {
          const resolvedHref = getAnchorUrlFromAttributes(node, baseUrl);
          if (!inner) return resolvedHref || "";
          return resolvedHref ? `[${inner}](${resolvedHref})` : inner;
        }
        if (tag === "img") {
          const alt = escapeMarkdownText((node.getAttribute("alt") || "image").trim());
          const src = (node.getAttribute("src") || "").trim();
          const resolvedSrc = resolveUrlForMarkdown(src, baseUrl);
          return resolvedSrc ? `![${alt}](${resolvedSrc})` : "";
        }

        return innerRaw;
      })
      .filter(Boolean);

    return joinInlineSegments(segments)
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n");
  }

  function renderBlockNodeToMarkdown(node, depth = 0, baseUrl = "") {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMarkdownText(normalizeWhitespace(node.nodeValue));
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
      const level = Number(tag[1]) || 1;
      const text = renderInlineNodesToMarkdown(node.childNodes, baseUrl).trim();
      return text ? `${"#".repeat(level)} ${text}\n\n` : "";
    }

    if (tag === "p") {
      const text = renderInlineNodesToMarkdown(node.childNodes, baseUrl).trim();
      return text ? `${text}\n\n` : "";
    }

    if (tag === "blockquote") {
      const inner = renderBlockChildrenToMarkdown(node, depth, baseUrl)
        .trim()
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
      return inner ? `${inner}\n\n` : "";
    }

    if (tag === "pre") {
      const code = node.textContent ? node.textContent.replace(/\s+$/g, "") : "";
      return code ? `\`\`\`\n${code}\n\`\`\`\n\n` : "";
    }

    if (tag === "ul" || tag === "ol") {
      let itemIndex = 1;
      const lines = Array.from(node.children)
        .filter((child) => child.tagName && child.tagName.toLowerCase() === "li")
        .map((li) => {
          const marker = tag === "ol" ? `${itemIndex++}.` : "-";
          const text = renderInlineNodesToMarkdown(li.childNodes, baseUrl).trim();
          const indent = "  ".repeat(depth);
          return text ? `${indent}${marker} ${text}` : "";
        })
        .filter(Boolean);
      return lines.length ? `${lines.join("\n")}\n\n` : "";
    }

    if (tag === "br") return "\n";

    if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
      const content = renderBlockChildrenToMarkdown(node, depth, baseUrl).trim();
      return content ? `${content}\n\n` : "";
    }

    return renderInlineNodesToMarkdown(node.childNodes, baseUrl);
  }

  function renderBlockChildrenToMarkdown(root, depth = 0, baseUrl = "") {
    return Array.from(root.childNodes || [])
      .map((child) => renderBlockNodeToMarkdown(child, depth + 1, baseUrl))
      .join("");
  }

  function convertHtmlToMarkdown(html, baseUrl = "") {
    const source = String(html || "").trim();
    if (!source) return "";

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div id="sitenotes-clipboard-root">${source}</div>`, "text/html");
    const root = doc.getElementById("sitenotes-clipboard-root") || doc.body;
    const markdown = renderBlockChildrenToMarkdown(root, 0, baseUrl)
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return markdown;
  }

  globalThis.SiteNotesMarkdown = {
    escapeHtml,
    trimToLength,
    sanitizeUrl,
    renderInlineMarkdown,
    renderBasicMarkdown,
    extractFirstLinkFromMarkdown,
    convertHtmlToMarkdown,
  };
})();
