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

    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      const safe = sanitizeUrl(url);
      if (safe === "#") return alt || "";
      return `<img src="${safe}" alt="${alt}" loading="lazy" />`;
    });

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (full, label, url, offset, source) => {
      const previousChar = offset > 0 ? source[offset - 1] : "";
      if (previousChar === "!") return full;
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

  function splitTableRow(line) {
    const raw = String(line || "").trim();
    if (!raw) return [];

    let content = raw;
    if (content.startsWith("|")) content = content.slice(1);
    if (content.endsWith("|")) content = content.slice(0, -1);

    const cells = [];
    let current = "";
    let escaped = false;

    for (const char of content) {
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        current += char;
        escaped = true;
        continue;
      }
      if (char === "|") {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }

    cells.push(current.trim());
    return cells.map((cell) => cell.replace(/\\\|/g, "|"));
  }

  function getTableAlignment(delimiterCell) {
    const marker = String(delimiterCell || "").trim();
    if (marker.startsWith(":") && marker.endsWith(":")) return "center";
    if (marker.startsWith(":")) return "left";
    if (marker.endsWith(":")) return "right";
    return "";
  }

  function isTableDelimiterCell(cell) {
    return /^:?-{3,}:?$/.test(String(cell || "").trim());
  }

  function parseGfmTable(lines, startIndex) {
    if (startIndex + 1 >= lines.length) return null;

    const headerLine = String(lines[startIndex] || "").trim();
    const delimiterLine = String(lines[startIndex + 1] || "").trim();
    if (!headerLine || !delimiterLine) return null;
    if (!headerLine.includes("|") || !delimiterLine.includes("|")) return null;

    const headerCells = splitTableRow(headerLine);
    const delimiterCells = splitTableRow(delimiterLine);

    if (!headerCells.length || headerCells.length !== delimiterCells.length) return null;
    if (!delimiterCells.every(isTableDelimiterCell)) return null;

    const alignments = delimiterCells.map(getTableAlignment);
    const rows = [];
    let index = startIndex + 2;

    while (index < lines.length) {
      const rowLine = String(lines[index] || "");
      if (!rowLine.trim()) break;
      if (!rowLine.includes("|")) break;

      const rowCells = splitTableRow(rowLine);
      if (!rowCells.length) break;

      while (rowCells.length < headerCells.length) rowCells.push("");
      if (rowCells.length > headerCells.length) rowCells.length = headerCells.length;
      rows.push(rowCells);
      index += 1;
    }

    const renderCell = (tag, content, alignment) => {
      const rendered = renderInlineMarkdown(content || "");
      const alignAttr = alignment ? ` style="text-align:${alignment}"` : "";
      return `<${tag}${alignAttr}>${rendered}</${tag}>`;
    };

    const headerHtml = `<thead><tr>${headerCells
      .map((cell, i) => renderCell("th", cell, alignments[i]))
      .join("")}</tr></thead>`;
    const bodyHtml = rows.length
      ? `<tbody>${rows
          .map((row) => `<tr>${row.map((cell, i) => renderCell("td", cell, alignments[i])).join("")}</tr>`)
          .join("")}</tbody>`
      : "";

    return {
      html: `<table>${headerHtml}${bodyHtml}</table>`,
      nextIndex: index,
    };
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

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index];
      const line = rawLine.trimEnd();

      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }

      const tableMatch = parseGfmTable(lines, index);
      if (tableMatch) {
        flushParagraph();
        flushList();
        htmlParts.push(tableMatch.html);
        index = tableMatch.nextIndex - 1;
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

    const mdRegex = /\[[^\]]+\]\(([^)]+)\)/g;
    let mdMatch = mdRegex.exec(text);
    while (mdMatch) {
      const previousChar = mdMatch.index > 0 ? text[mdMatch.index - 1] : "";
      if (previousChar !== "!") {
        const safe = sanitizeUrl(mdMatch[1]);
        if (safe !== "#") return safe;
      }
      mdMatch = mdRegex.exec(text);
    }

    // Ignore URLs already embedded in markdown image/link syntax.
    const textWithoutMarkdownConstructs = text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[[^\]]+\]\([^)]*\)/g, " ");

    const plainMatch = textWithoutMarkdownConstructs.match(/https?:\/\/[^\s)]+/);
    if (plainMatch && plainMatch[0]) {
      const safe = sanitizeUrl(plainMatch[0]);
      if (safe !== "#") return safe;
    }

    const wwwMatch = textWithoutMarkdownConstructs.match(/\bwww\.[^\s)]+/i);
    if (wwwMatch && wwwMatch[0]) {
      const safe = sanitizeUrl(wwwMatch[0]);
      if (safe !== "#") return safe;
    }

    return "";
  }

  function escapeMarkdownText(text) {
    return String(text || "")
      .replace(/\\/g, "\\\\")
      .replace(/([`*_\[\]])/g, "\\$1");
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

  function escapeMarkdownTableCell(text) {
    return String(text || "")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, "<br>");
  }

  function renderTableNodeToMarkdown(tableNode, baseUrl = "") {
    const allRows = Array.from(tableNode.querySelectorAll("tr"));
    if (!allRows.length) return "";

    const headRows = Array.from(tableNode.querySelectorAll("thead tr"));
    const bodyRows = Array.from(tableNode.querySelectorAll("tbody tr"));

    const headerRow = headRows[0] || allRows[0];
    if (!headerRow) return "";

    const dataRows = headRows.length
      ? (bodyRows.length ? bodyRows : allRows.filter((row) => row !== headerRow))
      : allRows.slice(1);

    const extractCells = (row) =>
      Array.from(row.children || [])
        .filter((cell) => {
          if (!cell.tagName) return false;
          const t = cell.tagName.toLowerCase();
          return t === "th" || t === "td";
        })
        .map((cell) => {
          const content = renderInlineNodesToMarkdown(cell.childNodes, baseUrl).trim();
          return escapeMarkdownTableCell(content);
        });

    const headerCells = extractCells(headerRow);
    if (!headerCells.length) return "";

    const columnCount = headerCells.length;
    const tableLines = [
      `| ${headerCells.join(" | ")} |`,
      `| ${new Array(columnCount).fill("---").join(" | ")} |`,
    ];

    for (const row of dataRows) {
      const cells = extractCells(row);
      while (cells.length < columnCount) cells.push("");
      if (cells.length > columnCount) cells.length = columnCount;
      tableLines.push(`| ${cells.join(" | ")} |`);
    }

    return `${tableLines.join("\n")}\n\n`;
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

    if (tag === "table") {
      return renderTableNodeToMarkdown(node, baseUrl);
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
