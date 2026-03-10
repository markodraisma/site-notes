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

  globalThis.SiteNotesMarkdown = {
    escapeHtml,
    trimToLength,
    sanitizeUrl,
    renderInlineMarkdown,
    renderBasicMarkdown,
    extractFirstLinkFromMarkdown,
  };
})();
