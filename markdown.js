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
      .replace(/([`*_\[\]()#+.!-])/g, "\\$1");
  }

  function normalizeWhitespace(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ");
  }

  function renderInlineNodesToMarkdown(nodes) {
    return Array.from(nodes || [])
      .map((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          return escapeMarkdownText(normalizeWhitespace(node.nodeValue));
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
          return "";
        }

        const tag = node.tagName.toLowerCase();
        const inner = renderInlineNodesToMarkdown(node.childNodes).trim();

        if (tag === "br") return "\n";
        if (tag === "strong" || tag === "b") return inner ? `**${inner}**` : "";
        if (tag === "em" || tag === "i") return inner ? `*${inner}*` : "";
        if (tag === "code") return inner ? `\`${inner}\`` : "";
        if (tag === "a") {
          const href = (node.getAttribute("href") || "").trim();
          const safeHref = sanitizeUrl(href);
          if (!inner) return safeHref !== "#" ? safeHref : "";
          return safeHref !== "#" ? `[${inner}](${safeHref})` : inner;
        }
        if (tag === "img") {
          const alt = escapeMarkdownText((node.getAttribute("alt") || "image").trim());
          const src = (node.getAttribute("src") || "").trim();
          return src ? `![${alt}](${src})` : "";
        }

        return inner;
      })
      .join("")
      .replace(/\s+\n/g, "\n")
      .replace(/\n\s+/g, "\n");
  }

  function renderBlockNodeToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMarkdownText(normalizeWhitespace(node.nodeValue));
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();

    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
      const level = Number(tag[1]) || 1;
      const text = renderInlineNodesToMarkdown(node.childNodes).trim();
      return text ? `${"#".repeat(level)} ${text}\n\n` : "";
    }

    if (tag === "p") {
      const text = renderInlineNodesToMarkdown(node.childNodes).trim();
      return text ? `${text}\n\n` : "";
    }

    if (tag === "blockquote") {
      const inner = renderBlockChildrenToMarkdown(node, depth)
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
          const text = renderInlineNodesToMarkdown(li.childNodes).trim();
          const indent = "  ".repeat(depth);
          return text ? `${indent}${marker} ${text}` : "";
        })
        .filter(Boolean);
      return lines.length ? `${lines.join("\n")}\n\n` : "";
    }

    if (tag === "br") return "\n";

    if (tag === "div" || tag === "section" || tag === "article" || tag === "main") {
      const content = renderBlockChildrenToMarkdown(node, depth).trim();
      return content ? `${content}\n\n` : "";
    }

    return renderInlineNodesToMarkdown(node.childNodes);
  }

  function renderBlockChildrenToMarkdown(root, depth = 0) {
    return Array.from(root.childNodes || [])
      .map((child) => renderBlockNodeToMarkdown(child, depth + 1))
      .join("");
  }

  function convertHtmlToMarkdown(html) {
    const source = String(html || "").trim();
    if (!source) return "";

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div id="sitenotes-clipboard-root">${source}</div>`, "text/html");
    const root = doc.getElementById("sitenotes-clipboard-root") || doc.body;
    const markdown = renderBlockChildrenToMarkdown(root)
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
