let currentUrl = "";
let currentHostname = "";
let viewMode = "page"; // "page", "domain", or "all"
let currentSearchMode = "all"; // "all", "text", or "tags"
let currentNotes = [];
let availableTags = [];
let pendingSelectionAnchor = null;
let anchorStateByNoteId = {};
let pendingAttachContext = null;
let deleteUndoState = null;
let pasteContextState = null;
let pendingNoteModalContext = null;
let helpMarkdownCache = "";
const COPY_CONTEXT_STORAGE_KEY = "__siteNotesLastCopyContext__";
const COPY_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000;
const EXPORT_META_KEY = "__siteNotesExportMeta__";

const MARKDOWN = globalThis.SiteNotesMarkdown || {};
const STORAGE = globalThis.SiteNotesStorage || {};

const TAGS_STORAGE_KEY = "__siteNotesTags__";
const SETTINGS_STORAGE_KEY = "__siteNotesSettings__";

const DEFAULT_SETTINGS = {
  privacyMode: false,
  copyContextEnabled: false,
  hostScopeMode: "all",
  hostScopeEntries: [],
  sourceLinkMode: "smart",
};

const DEFAULT_FAVICON_DATA_URI =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23e5e7eb'/%3E%3Cpath d='M8 6h12l4 4v16H8z' fill='%23ffffff' stroke='%239ca3af'/%3E%3Cpath d='M20 6v4h4' fill='%23e5e7eb'/%3E%3C/svg%3E";

let appSettings = { ...DEFAULT_SETTINGS };

function normalizeHostEntry(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";

  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return parsed.hostname || "";
  } catch {
    return raw
      .replace(/^\.+|\.+$/g, "")
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9.-]/g, "");
  }
}

function parseHostScopeEntries(rawValue) {
  if (Array.isArray(rawValue)) {
    return Array.from(new Set(rawValue.map((entry) => normalizeHostEntry(entry)).filter(Boolean)));
  }

  return Array.from(
    new Set(
      String(rawValue || "")
        .split(/\r?\n/)
        .map((entry) => normalizeHostEntry(entry))
        .filter(Boolean)
    )
  );
}

function normalizeNoteContent(content) {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  return String(content);
}

function normalizeNoteTags(tags) {
  if (Array.isArray(tags)) {
    return Array.from(
      new Set(tags.map((tag) => normalizeTag(String(tag || ""))).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }

  if (typeof tags === "string") {
    // Backward-compatible parsing for legacy comma/newline separated tag strings.
    return Array.from(
      new Set(
        tags
          .split(/[\n,]/)
          .map((tag) => normalizeTag(tag))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }

  return [];
}

function normalizeNoteForUi(note) {
  if (!note || typeof note !== "object") return null;
  if (!note.url) return null;

  return {
    ...note,
    content: normalizeNoteContent(note.content),
    tags: normalizeNoteTags(note.tags),
  };
}

function normalizeSettings(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const hostScopeMode = ["all", "allowlist", "denylist"].includes(source.hostScopeMode)
    ? source.hostScopeMode
    : DEFAULT_SETTINGS.hostScopeMode;
  const sourceLinkMode = ["always", "smart", "never"].includes(source.sourceLinkMode)
    ? source.sourceLinkMode
    : DEFAULT_SETTINGS.sourceLinkMode;

  return {
    privacyMode:
      typeof source.privacyMode === "boolean"
        ? source.privacyMode
        : DEFAULT_SETTINGS.privacyMode,
    copyContextEnabled:
      typeof source.copyContextEnabled === "boolean"
        ? source.copyContextEnabled
        : DEFAULT_SETTINGS.copyContextEnabled,
    hostScopeMode,
    hostScopeEntries: parseHostScopeEntries(source.hostScopeEntries),
    sourceLinkMode,
  };
}

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    appSettings = normalizeSettings(data?.[SETTINGS_STORAGE_KEY]);
  } catch {
    appSettings = { ...DEFAULT_SETTINGS };
  }

  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: appSettings });
  return appSettings;
}

async function saveSettings(patch = {}) {
  appSettings = normalizeSettings({ ...appSettings, ...patch });
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: appSettings });
  return appSettings;
}

function applySettingsToUi() {
  const privacyToggle = document.getElementById("privacyModeToggle");
  const copyToggle = document.getElementById("copyContextToggle");
  const hostMode = document.getElementById("hostScopeMode");
  const hostEntries = document.getElementById("hostScopeEntries");

  if (privacyToggle) privacyToggle.checked = Boolean(appSettings.privacyMode);
  if (copyToggle) {
    copyToggle.checked = Boolean(appSettings.copyContextEnabled);
    copyToggle.disabled = Boolean(appSettings.privacyMode);
  }
  if (hostMode) hostMode.value = appSettings.hostScopeMode;
  if (hostEntries) hostEntries.value = appSettings.hostScopeEntries.join("\n");
  const sourceLinkModeSelect = document.getElementById("sourceLinkMode");
  if (sourceLinkModeSelect) sourceLinkModeSelect.value = appSettings.sourceLinkMode;
}

function hostIsAllowed(hostname) {
  const normalized = normalizeHostEntry(hostname);
  if (!normalized) return true;

  const entries = new Set(parseHostScopeEntries(appSettings.hostScopeEntries));
  if (appSettings.hostScopeMode === "all") return true;
  if (appSettings.hostScopeMode === "allowlist") return entries.has(normalized);
  return !entries.has(normalized);
}

function sanitizeFaviconUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return "";
  if (/^(https?:|data:|chrome:|chrome-extension:)/i.test(trimmed)) return trimmed;
  return "";
}

function bindTagInputListener(input) {
  if (!input || input.dataset.tagInputBound === "1") return;
  input.addEventListener("keydown", handleTagInput);
  input.addEventListener("input", handleTagInputValueChange);
  input.addEventListener("focus", handleTagInputFocus);
  input.addEventListener("blur", handleTagInputBlur);
  input.dataset.tagInputBound = "1";
}

function getTagEditorFromInput(input) {
  if (!(input instanceof HTMLElement)) return null;
  const editor = input.closest(".tags-input");
  return editor instanceof HTMLElement ? editor : null;
}

function ensureTagSuggestionsDropdown(tagsEditor) {
  if (!tagsEditor) return null;
  let dropdown = tagsEditor.querySelector(".tag-suggestions");
  if (!dropdown) {
    dropdown = document.createElement("div");
    dropdown.className = "tag-suggestions";
    dropdown.style.display = "none";
    tagsEditor.appendChild(dropdown);
  }
  return dropdown;
}

function getSelectedTagSet(tagsEditor) {
  return new Set(getTagsFromEditor(tagsEditor));
}

function buildTagSuggestions(tagsEditor, query) {
  const selected = getSelectedTagSet(tagsEditor);
  const normalizedQuery = normalizeTag(query || "").toLowerCase();

  const matches = availableTags
    .filter((tag) => !selected.has(tag))
    .filter((tag) => {
      if (!normalizedQuery) return true;
      return tag.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, 8);

  const normalizedNewTag = normalizeTag(query || "");
  const showCreateOption =
    Boolean(normalizedNewTag) &&
    !selected.has(normalizedNewTag) &&
    !availableTags.includes(normalizedNewTag);

  return {
    matches,
    showCreateOption,
    normalizedNewTag,
  };
}

function setTagSuggestionActiveState(dropdown, activeIndex) {
  if (!dropdown) return;
  const options = Array.from(dropdown.querySelectorAll(".tag-suggestion-item"));
  options.forEach((option, idx) => {
    if (idx === activeIndex) {
      option.classList.add("active");
    } else {
      option.classList.remove("active");
    }
  });
  dropdown.dataset.activeIndex = String(activeIndex);
}

function showTagSuggestions(tagsEditor) {
  const input = tagsEditor?.querySelector("input");
  if (!input) return;

  const dropdown = ensureTagSuggestionsDropdown(tagsEditor);
  if (!dropdown) return;

  const { matches, showCreateOption, normalizedNewTag } = buildTagSuggestions(
    tagsEditor,
    input.value
  );

  if (!matches.length && !showCreateOption) {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    dropdown.dataset.activeIndex = "-1";
    return;
  }

  const items = [
    ...matches.map(
      (tag) =>
        `<button type="button" class="tag-suggestion-item" data-value="${escapeHtml(tag)}">#${escapeHtml(
          tag
        )}</button>`
    ),
  ];

  if (showCreateOption) {
    items.push(
      `<button type="button" class="tag-suggestion-item create" data-value="${escapeHtml(
        normalizedNewTag
      )}">Create #${escapeHtml(normalizedNewTag)}</button>`
    );
  }

  dropdown.innerHTML = items.join("");
  dropdown.style.display = "block";
  setTagSuggestionActiveState(dropdown, 0);

  dropdown.querySelectorAll(".tag-suggestion-item").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      // Prevent blur before click selection is processed.
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      const value = normalizeTag(button.dataset.value || "");
      if (!value) return;
      addTagChip(tagsEditor, value);
      const editorInput = tagsEditor.querySelector("input");
      if (editorInput) {
        editorInput.value = "";
        editorInput.focus();
      }
      showTagSuggestions(tagsEditor);
    });
  });
}

function hideTagSuggestions(tagsEditor) {
  const dropdown = tagsEditor?.querySelector(".tag-suggestions");
  if (!dropdown) return;
  dropdown.style.display = "none";
  dropdown.innerHTML = "";
  dropdown.dataset.activeIndex = "-1";
}

function selectActiveTagSuggestion(tagsEditor) {
  const dropdown = tagsEditor?.querySelector(".tag-suggestions");
  if (!dropdown || dropdown.style.display === "none") return false;
  const activeIndex = Number(dropdown.dataset.activeIndex || "0");
  const options = Array.from(dropdown.querySelectorAll(".tag-suggestion-item"));
  const target = options[activeIndex] || options[0];
  if (!target) return false;

  const value = normalizeTag(target.dataset.value || "");
  if (!value) return false;

  addTagChip(tagsEditor, value);
  const input = tagsEditor.querySelector("input");
  if (input) {
    input.value = "";
    input.focus();
  }
  showTagSuggestions(tagsEditor);
  return true;
}

function moveTagSuggestion(tagsEditor, delta) {
  const dropdown = tagsEditor?.querySelector(".tag-suggestions");
  if (!dropdown || dropdown.style.display === "none") return;
  const options = Array.from(dropdown.querySelectorAll(".tag-suggestion-item"));
  if (!options.length) return;

  const current = Number(dropdown.dataset.activeIndex || "0");
  const next = (current + delta + options.length) % options.length;
  setTagSuggestionActiveState(dropdown, next);
}

function addTagFromInput(tagsEditor) {
  const input = tagsEditor?.querySelector("input");
  if (!input) return false;
  const tag = normalizeTag(input.value || "");
  if (!tag) return false;
  addTagChip(tagsEditor, tag);
  input.value = "";
  showTagSuggestions(tagsEditor);
  return true;
}

function handleTagInputValueChange(e) {
  const tagsEditor = getTagEditorFromInput(e.target);
  if (!tagsEditor) return;
  showTagSuggestions(tagsEditor);
}

function handleTagInputFocus(e) {
  const tagsEditor = getTagEditorFromInput(e.target);
  if (!tagsEditor) return;
  showTagSuggestions(tagsEditor);
}

function handleTagInputBlur(e) {
  const tagsEditor = getTagEditorFromInput(e.target);
  if (!tagsEditor) return;
  window.setTimeout(() => {
    const active = document.activeElement;
    if (active instanceof Node && tagsEditor.contains(active)) return;
    hideTagSuggestions(tagsEditor);
  }, 0);
}

function bindMarkdownPasteListener(textarea) {
  if (!textarea || textarea.dataset.markdownPasteBound === "1") return;
  textarea.addEventListener("paste", handleMarkdownPaste);
  textarea.addEventListener("contextmenu", handleTextareaContextMenu);
  textarea.dataset.markdownPasteBound = "1";
}

function insertTextAtCursor(textarea, text) {
  if (!textarea) return;

  const start = typeof textarea.selectionStart === "number" ? textarea.selectionStart : 0;
  const end = typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : start;
  textarea.focus();

  // Use native insertion first so Ctrl/Cmd+Z works reliably in textarea editing.
  try {
    textarea.setSelectionRange(start, end);
  } catch {
    // Some environments may throw if selection can't be updated.
  }

  const usedNativeInsert =
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, text);

  if (usedNativeInsert) {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  // Fallback if native insertText is unavailable.
  textarea.setRangeText(text, start, end, "end");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function closePasteContextMenu() {
  const menu = document.getElementById("pasteContextMenu");
  if (menu) menu.classList.remove("visible");
  pasteContextState = null;
}

function openPasteContextMenu(x, y, target, selectionStart, selectionEnd) {
  const menu = document.getElementById("pasteContextMenu");
  if (!menu) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const estimatedWidth = 240;
  const estimatedHeight = 88;
  const left = Math.max(8, Math.min(x, viewportWidth - estimatedWidth - 8));
  const top = Math.max(8, Math.min(y, viewportHeight - estimatedHeight - 8));

  pasteContextState = {
    target,
    selectionStart,
    selectionEnd,
  };

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.classList.add("visible");
}

function handleTextareaContextMenu(e) {
  const textarea = e.currentTarget;
  if (!(textarea instanceof HTMLTextAreaElement)) return;

  e.preventDefault();
  textarea.focus();
  openPasteContextMenu(
    e.clientX,
    e.clientY,
    textarea,
    textarea.selectionStart,
    textarea.selectionEnd
  );
}

function convertHtmlToPlainText(html) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${String(html || "")}</div>`, "text/html");
    return (doc.body?.innerText || doc.body?.textContent || "").trim();
  } catch {
    return "";
  }
}

function normalizeUrlForNotes(urlLike) {
  try {
    const url = new URL(String(urlLike || ""));
    if (isYouTubeVideo(url)) {
      return `${url.origin}${url.pathname}?v=${url.searchParams.get("v")}`;
    }
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function escapeMarkdownLinkLabel(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function buildSourceMarkdownLine(sourceContext) {
  const sourceUrl = normalizeUrlForNotes(sourceContext?.url || "");
  if (!sourceUrl) return "";

  const sourceLabel = escapeMarkdownLinkLabel(
    sourceContext?.title || getAttachmentSourceLabel(sourceUrl)
  );
  return `Source: [${sourceLabel}](${sourceUrl})`;
}

function prependSourceLineToMarkdown(markdownBody, sourceContext) {
  const body = String(markdownBody || "").trim();
  if (!body) return "";

  const sourceLine = buildSourceMarkdownLine(sourceContext);
  if (!sourceLine) return body;

  if (body.startsWith(`${sourceLine}\n\n`) || body === sourceLine) {
    return body;
  }

  return `${sourceLine}\n\n${body}`;
}

// Smart variant: respects sourceLinkMode setting and existing note content.
// - "always": same as prependSourceLineToMarkdown (prepend unconditionally).
// - "never": returns body unchanged.
// - "smart" (default):
//     empty editor  → prepend at top (new note).
//     same source already present anywhere → skip (no duplicate).
//     different source → prepend inline with pasted block (at cursor, not top of note).
function applySourceLineToMarkdown(markdownBody, sourceContext, existingContent) {
  const body = String(markdownBody || "").trim();
  if (!body) return "";

  const mode = appSettings.sourceLinkMode || "smart";
  if (mode === "never") return body;

  const sourceLine = buildSourceMarkdownLine(sourceContext);
  if (!sourceLine) return body;

  // Idempotent: pasted text already begins with this source line.
  if (body.startsWith(`${sourceLine}\n\n`) || body === sourceLine) {
    return body;
  }

  if (mode === "always") {
    return `${sourceLine}\n\n${body}`;
  }

  // "smart" mode.
  const existing = String(existingContent || "").trim();

  // Empty editor (new note or blank edit): prepend at top.
  if (!existing) {
    return `${sourceLine}\n\n${body}`;
  }

  // Same source already somewhere in the note: skip the marker entirely.
  if (existing.includes(sourceLine)) {
    return body;
  }

  // Different source: attach the source marker inline with the pasted block
  // (inserted at cursor position, so it sits near the new content, not at the top).
  return `${sourceLine}\n\n${body}`;
}

async function getLatestCopySourceContext() {
  try {
    const data = await chrome.storage.local.get(COPY_CONTEXT_STORAGE_KEY);
    const value = data?.[COPY_CONTEXT_STORAGE_KEY];
    if (!value || typeof value !== "object") return null;

    const sourceUrl = normalizeUrlForNotes(value.url);
    if (!sourceUrl) return null;

    const copiedAtMs = Number(value.copiedAtMs || 0);
    if (!Number.isFinite(copiedAtMs)) return null;
    if (Date.now() - copiedAtMs > COPY_CONTEXT_MAX_AGE_MS) return null;

    return {
      url: sourceUrl,
      title: String(value.title || "").trim(),
      copiedAtMs,
    };
  } catch {
    return null;
  }
}

async function readClipboardPayload() {
  let html = "";
  let text = "";
  let available = false;

  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        available = true;
        if (!html && item.types.includes("text/html")) {
          const blob = await item.getType("text/html");
          html = await blob.text();
        }
        if (!text && item.types.includes("text/plain")) {
          const blob = await item.getType("text/plain");
          text = await blob.text();
        }
      }
    } catch {
      // Fall back to readText below.
    }
  }

  if (!text && navigator.clipboard?.readText) {
    try {
      text = await navigator.clipboard.readText();
      available = true;
    } catch {
      // Ignore clipboard read failures.
    }
  }

  return { html, text, available };
}

async function pasteFromContextMenu(mode) {
  const ctx = pasteContextState;
  closePasteContextMenu();
  if (!ctx?.target || !(ctx.target instanceof HTMLTextAreaElement)) return;

  const textarea = ctx.target;
  textarea.focus();
  if (typeof ctx.selectionStart === "number" && typeof ctx.selectionEnd === "number") {
    textarea.selectionStart = ctx.selectionStart;
    textarea.selectionEnd = ctx.selectionEnd;
  }

  const frozenSourceContext = await getLatestCopySourceContext();
  const { html, text, available } = await readClipboardPayload();
  let toInsert = "";

  if (mode === "markdown") {
    const converter = MARKDOWN.convertHtmlToMarkdown;
    if (html && typeof converter === "function") {
      toInsert = converter(html, frozenSourceContext?.url || currentUrl);
    }
    if (!toInsert) {
      toInsert = text || convertHtmlToPlainText(html);
    }
    toInsert = applySourceLineToMarkdown(toInsert, frozenSourceContext, textarea.value);
  } else {
    toInsert = text || convertHtmlToPlainText(html);
  }

  if (!toInsert) {
    if (!available) {
      showToast("Clipboard read not available. Reload extension to apply permission update.", "warning");
    } else {
      showToast("Clipboard is empty.", "warning");
    }
    return;
  }

  insertTextAtCursor(textarea, toInsert);

  if (mode === "markdown") {
    const sourceLine = buildSourceMarkdownLine(frozenSourceContext);
    if (sourceLine && toInsert.startsWith(sourceLine)) {
      showToast("Pasted as markdown with source link.", "success", null, 2200);
    } else if (frozenSourceContext?.url) {
      showToast("Pasted as markdown.", "success", null, 2000);
    } else {
      showToast("Pasted as markdown (source context unavailable).", "warning", null, 2600);
    }
  }
}

async function handleMarkdownPaste(e) {
  const textarea = e.currentTarget;
  if (!(textarea instanceof HTMLTextAreaElement)) return;

  const clipboard = e.clipboardData;
  if (!clipboard) return;

  const html = clipboard.getData("text/html");
  if (!html || !/<[a-z][\s\S]*>/i.test(html)) return;

  const converter = MARKDOWN.convertHtmlToMarkdown;
  if (typeof converter !== "function") return;

  e.preventDefault();

  const frozenSourceContext = await getLatestCopySourceContext();
  let markdown = converter(html, frozenSourceContext?.url || currentUrl);
  if (!markdown) {
    markdown = clipboard.getData("text/plain") || convertHtmlToPlainText(html);
  }
  markdown = applySourceLineToMarkdown(markdown, frozenSourceContext, textarea.value);

  if (!markdown) return;

  insertTextAtCursor(textarea, markdown);

  const sourceLine = buildSourceMarkdownLine(frozenSourceContext);
  if (sourceLine && markdown.startsWith(sourceLine)) {
    showToast("Pasted as markdown with source link.", "success", null, 2200);
  } else if (frozenSourceContext?.url) {
    showToast("Pasted as markdown.", "success", null, 2000);
  } else {
    showToast("Pasted as markdown (source context unavailable).", "warning", null, 2600);
  }
}

// Initialize the extension
async function initialize() {
  await loadSettings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const url = new URL(tab.url);
  currentHostname = url.hostname;
  currentUrl = normalizeUrlForNotes(tab.url);

  // Update UI
  document.getElementById("currentUrl").textContent = currentHostname;
  const favicon = document.getElementById("favicon");
  if (favicon) {
    const safeFavicon = appSettings.privacyMode
      ? ""
      : sanitizeFaviconUrl(tab.favIconUrl || "");
    favicon.src = safeFavicon || DEFAULT_FAVICON_DATA_URI;
    favicon.alt = `${currentHostname} icon`;
  }

  applySettingsToUi();

  if (typeof STORAGE.ensureDataVersion === "function") {
    try {
      await STORAGE.ensureDataVersion();
    } catch (error) {
      console.error("Failed to run storage migration:", error);
    }
  }

  setupEventListeners();
  await refreshTagCatalog();
  await loadNotes();
}

function isYouTubeVideo(url) {
  return (
    url.hostname.includes("youtube.com") &&
    url.pathname === "/watch" &&
    url.searchParams.has("v")
  );
}

// Set up all event listeners
function setupEventListeners() {
  // Avoid duplicate listeners if initialize runs more than once
  if (window.__siteNotesListenersBound) return;
  window.__siteNotesListenersBound = true;

  // View toggle buttons
  document.getElementById("pageNotesBtn").addEventListener("click", () => {
    viewMode = "page";
    toggleActiveButton("pageNotesBtn", ["domainNotesBtn", "allNotesBtn"]);
    loadNotes();
  });

  document.getElementById("domainNotesBtn").addEventListener("click", () => {
    viewMode = "domain";
    toggleActiveButton("domainNotesBtn", ["pageNotesBtn", "allNotesBtn"]);
    loadNotes();
  });

  document.getElementById("allNotesBtn").addEventListener("click", () => {
    viewMode = "all";
    toggleActiveButton("allNotesBtn", ["pageNotesBtn", "domainNotesBtn"]);
    loadNotes();
  });

  // Search input with debounce
  const searchInput = document.getElementById("searchInput");
  let debounceTimeout;
  searchInput.addEventListener("input", (e) => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => loadNotes(e.target.value), 300);
  });

  document.querySelectorAll("[data-search-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setSearchMode(button.dataset.searchMode || "all");
      loadNotes(getCurrentSearchTerm());
    });
  });
  setSearchMode(currentSearchMode);

  document.getElementById("exportMenuBtn")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleExportMenu();
  });
  document.querySelectorAll("[data-export-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      closeExportMenu();
      exportData(button.dataset.exportScope || "all");
    });
  });

  document.getElementById("helpBtn")?.addEventListener("click", openHelpModal);
  document.getElementById("closeHelpBtn")?.addEventListener("click", closeHelpModal);
  document.getElementById("doneHelpBtn")?.addEventListener("click", closeHelpModal);

  document.getElementById("bulkTagsBtn")?.addEventListener("click", openBulkTagsModal);
  document.getElementById("closeBulkTagsBtn")?.addEventListener("click", closeBulkTagsModal);
  document.getElementById("cancelBulkTagsBtn")?.addEventListener("click", closeBulkTagsModal);
  document.getElementById("applyBulkTagsBtn")?.addEventListener("click", applyBulkTagChanges);

  // Add note button
  document
    .getElementById("addNoteBtn")
    .addEventListener("click", openNoteModal);

  // Note modal buttons
  document
    .getElementById("closeModalBtn")
    .addEventListener("click", closeNoteModal);
  document
    .getElementById("cancelNoteBtn")
    .addEventListener("click", closeNoteModal);
  document.getElementById("saveNoteBtn").addEventListener("click", saveNewNote);

  // Settings
  document
    .getElementById("settingsBtn")
    .addEventListener("click", openSettingsModal);
  document
    .getElementById("closeSettingsBtn")
    .addEventListener("click", closeSettingsModal);
  document
    .getElementById("resetDataBtn")
    .addEventListener("click", resetAllData);
  document
    .getElementById("exportDataBtn")
    ?.addEventListener("click", () => exportData());
  document.getElementById("importDataBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });
  document
    .getElementById("importFileInput")
    .addEventListener("change", importData);

  document
    .getElementById("privacyModeToggle")
    ?.addEventListener("change", async (event) => {
      const enabled = Boolean(event.target?.checked);
      const patch = {
        privacyMode: enabled,
      };
      if (enabled) {
        patch.copyContextEnabled = false;
      }

      await saveSettings(patch);
      applySettingsToUi();
      await initialize();
      showToast(
        enabled ? "Privacy mode enabled." : "Privacy mode disabled.",
        "success"
      );
    });

  document
    .getElementById("copyContextToggle")
    ?.addEventListener("change", async (event) => {
      const enabled = Boolean(event.target?.checked);
      if (appSettings.privacyMode && enabled) {
        showToast("Disable privacy mode first to enable copy context.", "warning");
        applySettingsToUi();
        return;
      }

      await saveSettings({ copyContextEnabled: enabled });
      showToast(
        enabled
          ? "Copy source context capture enabled."
          : "Copy source context capture disabled.",
        "success"
      );
    });

  document
    .getElementById("hostScopeMode")
    ?.addEventListener("change", async (event) => {
      const mode = String(event.target?.value || "all");
      await saveSettings({ hostScopeMode: mode });
      await loadNotes(document.getElementById("searchInput")?.value || "");
      showToast("Host scope mode updated.", "success");
    });

  document
    .getElementById("hostScopeEntries")
    ?.addEventListener("blur", async (event) => {
      await saveSettings({ hostScopeEntries: event.target?.value || "" });
      await loadNotes(document.getElementById("searchInput")?.value || "");
      showToast("Host scope entries updated.", "success", null, 1800);
    });

  document
    .getElementById("sourceLinkMode")
    ?.addEventListener("change", async (event) => {
      const mode = String(event.target?.value || "smart");
      await saveSettings({ sourceLinkMode: mode });
      showToast("Source link mode updated.", "success", null, 1800);
    });

  document.getElementById("toastCloseBtn")?.addEventListener("click", () => {
    hideToast();
  });

  document.getElementById("pasteAsMarkdownBtn")?.addEventListener("click", () => {
    pasteFromContextMenu("markdown");
  });
  document.getElementById("pasteAsPlainTextBtn")?.addEventListener("click", () => {
    pasteFromContextMenu("plain");
  });

  document.addEventListener("click", (e) => {
    const pasteMenu = document.getElementById("pasteContextMenu");
    if (pasteMenu?.classList.contains("visible")) {
      if (!(e.target instanceof Node) || !pasteMenu.contains(e.target)) {
        closePasteContextMenu();
      }
    }

    const exportMenu = document.getElementById("exportMenu");
    const exportMenuBtn = document.getElementById("exportMenuBtn");
    const clickedInsideExportMenu =
      e.target instanceof Node &&
      (exportMenu?.contains(e.target) || exportMenuBtn?.contains(e.target));

    if (!clickedInsideExportMenu) {
      closeExportMenu();
    }
  });

  document.addEventListener(
    "scroll",
    () => {
      closePasteContextMenu();
      closeExportMenu();
    },
    true
  );

  // Global keyboard shortcuts
  document.addEventListener("keydown", handleGlobalKeydown);

  // Global tag manager
  document
    .getElementById("manageTagsBtn")
    .addEventListener("click", openTagsManagerModal);
  document
    .getElementById("closeTagsManagerBtn")
    .addEventListener("click", closeTagsManagerModal);
  document
    .getElementById("doneTagsManagerBtn")
    .addEventListener("click", closeTagsManagerModal);
  document
    .getElementById("createTagBtn")
    .addEventListener("click", createTagFromManager);
  document
    .getElementById("closeEditTagBtn")
    .addEventListener("click", closeEditTagModal);
  document
    .getElementById("cancelEditTagBtn")
    .addEventListener("click", closeEditTagModal);
  document
    .getElementById("saveEditTagBtn")
    .addEventListener("click", saveEditedTag);
  document
    .getElementById("closeAttachNoteBtn")
    .addEventListener("click", closeAttachNoteModal);
  document
    .getElementById("cancelAttachNoteBtn")
    .addEventListener("click", closeAttachNoteModal);
  document
    .getElementById("attachAsPageBtn")
    .addEventListener("click", () => completeAttachExistingNote("page"));
  document
    .getElementById("attachToSelectionBtn")
    .addEventListener("click", () => completeAttachExistingNote("selection"));
  document
    .getElementById("editTagNameInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveEditedTag();
      }
    });
  document
    .getElementById("newTagNameInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createTagFromManager();
      }
    });

  // New note tags input
  const tagsInput = document.querySelector("#tagsInput input");
  bindTagInputListener(tagsInput);
  bindMarkdownPasteListener(document.getElementById("newNoteContent"));

  // Tab changes
  chrome.tabs.onActivated.addListener(initialize);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      initialize();
    }
  });
}

function isTextEntryTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function getActiveModal() {
  return document.querySelector(".modal.active");
}

function closeActiveModal() {
  const modal = getActiveModal();
  if (!modal) return false;

  switch (modal.id) {
    case "noteModal":
      closeNoteModal();
      return true;
    case "settingsModal":
      closeSettingsModal();
      return true;
    case "helpModal":
      closeHelpModal();
      return true;
    case "bulkTagsModal":
      closeBulkTagsModal();
      return true;
    case "tagsManagerModal":
      closeTagsManagerModal();
      return true;
    case "editTagModal":
      closeEditTagModal();
      return true;
    case "attachNoteModal":
      closeAttachNoteModal();
      return true;
    default:
      modal.classList.remove("active");
      return true;
  }
}

function isInlineNoteEditActive() {
  return Array.from(
    document.querySelectorAll('.note-card [data-role="content-editor"]')
  ).some((editor) => editor.style.display !== "none");
}

async function handleGlobalKeydown(e) {
  const key = e.key;
  const activeModal = getActiveModal();
  const pasteMenu = document.getElementById("pasteContextMenu");
  const exportMenu = document.getElementById("exportMenu");
  const pasteMenuOpen = Boolean(pasteMenu?.classList.contains("visible"));
  const exportMenuOpen = Boolean(exportMenu?.classList.contains("visible"));

  if (pasteMenuOpen && key === "Escape") {
    e.preventDefault();
    closePasteContextMenu();
    return;
  }

  if (exportMenuOpen && key === "Escape") {
    e.preventDefault();
    closeExportMenu();
    return;
  }

  if (pasteMenuOpen) return;

  if (
    key === "/" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !isTextEntryTarget(e.target) &&
    !activeModal
  ) {
    e.preventDefault();
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  if (key === "Escape") {
    if (isInlineNoteEditActive()) return;
    if (activeModal) {
      e.preventDefault();
      closeActiveModal();
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && key === "Enter" && activeModal?.id === "noteModal") {
    e.preventDefault();
    await saveNewNote();
  }
}

// Load notes based on current view mode and search term
async function loadNotes(searchTerm = null) {
  const effectiveSearchTerm =
    searchTerm === null || searchTerm === undefined ? getCurrentSearchTerm() : String(searchTerm);
  const allNotes = await getAllNotes();
  let filteredNotes = [];

  if (!hostIsAllowed(currentHostname) && viewMode !== "all") {
    currentNotes = [];
    displayNotes([]);
    return;
  }

  switch (viewMode) {
    case "page":
      filteredNotes = allNotes.filter((note) => noteAppliesToPage(note, currentUrl));
      break;
    case "domain":
      filteredNotes = allNotes.filter((note) => {
        if (noteUrlHasHostname(note.url, currentHostname)) return true;
        return getLinkedPageUrls(note).some((url) => noteUrlHasHostname(url, currentHostname));
      });
      break;
    case "all":
      filteredNotes = allNotes;
      break;
  }

  filteredNotes = filteredNotes.filter((note) => hostIsAllowed(getHostnameFromUrl(note.url)));

  // Filter by search term
  if (effectiveSearchTerm && effectiveSearchTerm.trim()) {
    filteredNotes = filteredNotes.filter((note) =>
      noteMatchesSearch(note, effectiveSearchTerm, currentSearchMode)
    );
  }

  // Sort by most recent first
  filteredNotes.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

  await refreshAnchorStates(filteredNotes);

  currentNotes = filteredNotes;
  displayNotes(filteredNotes);
}

// Get all notes from storage
async function getAllNotes() {
  try {
    if (typeof STORAGE.getAllNotes === "function") {
      return (await STORAGE.getAllNotes())
        .map((note) => normalizeNoteForUi(note))
        .filter((note) => note && note.content);
    }

    const data = await chrome.storage.local.get(null);
    return Object.entries(data)
      .filter(([key, value]) => key !== TAGS_STORAGE_KEY && Array.isArray(value))
      .flatMap(([, value]) => value)
      .map((note) => normalizeNoteForUi(note))
      .filter((note) => note && note.content);
  } catch (error) {
    console.error("Error getting notes:", error);
    return [];
  }
}

// Display notes in the container
function displayNotes(notes) {
  const container = document.getElementById("notesContainer");
  const searchTerm = document.getElementById("searchInput").value;

  updateHeaderActionsState(notes);

  if (notes.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-note-sticky"></i>
        <p>No notes found${searchTerm ? " for your search" : ""}.<br>
        ${!searchTerm ? "Click the + button to create one!" : ""}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = notes
    .map((note, index) => createNoteHTML(note, index))
    .join("");

  // Attach event listeners after rendering
  notes.forEach((_, index) => attachNoteEventListeners(index));
}

// Create HTML for a single note
function createNoteHTML(note, index) {
  const created = new Date(note.createdAt).toLocaleString();
  const modified = new Date(note.modifiedAt).toLocaleString();
  let displayUrl = "Invalid URL";
  try {
    const noteUrl = new URL(note.url);
    displayUrl = isYouTubeVideo(noteUrl)
      ? `YouTube: ${noteUrl.searchParams.get("v")}`
      : noteUrl.pathname === "/"
      ? noteUrl.hostname
      : noteUrl.pathname;
  } catch {
    displayUrl = trimToLength(String(note.url || "Invalid URL"), 80);
  }

  const safeNoteHref = sanitizeUrl(note.url);
  const escapedNoteUrl = escapeHtml(String(note.url || ""));
  const noteLinkHtml =
    safeNoteHref === "#"
      ? `<span class="note-url" title="${escapedNoteUrl}">${escapeHtml(displayUrl)}</span>`
      : `<a href="${safeNoteHref}" class="note-url" title="${escapedNoteUrl}">${escapeHtml(
          displayUrl
        )}</a>`;

  const anchorsForCurrentPage = getAnchorsForPage(note, currentUrl);
  const pageLinkedWithoutAnchor =
    note.url !== currentUrl && hasPageLevelLinkForUrl(note, currentUrl);
  const anchorRows = anchorsForCurrentPage
    .map((entry, idx) => {
      const state = getAnchorState(note, entry.id);
      const statusClass = state === "missing" ? "warning" : "";
      const statusLabel = state === "missing" ? "Missing" : "Found";
      const anchorSnippet = escapeHtml(trimToLength(entry.anchor?.exact || "", 160));
      return `
        <div class="anchor-row ${statusClass}">
          <div class="anchor-row-head">
            <button type="button" class="btn-link anchor-jump-btn" data-anchor-id="${entry.id}">Anchor ${idx + 1}</button>
            <span class="anchor-row-state">${statusLabel}</span>
            <button type="button" class="btn-link reanchor-btn" data-anchor-id="${entry.id}">Re-anchor</button>
            <button type="button" class="btn-link delete unlink-anchor-btn" data-anchor-id="${entry.id}">Unlink</button>
          </div>
          <div class="anchor-quote" title="Selected text">"${anchorSnippet}"</div>
        </div>
      `;
    })
    .join("");

  const anchorsHtml = anchorsForCurrentPage.length
    ? `<div class="anchor-pill"><i class="fas fa-link"></i> ${anchorsForCurrentPage.length} anchor${
        anchorsForCurrentPage.length === 1 ? "" : "s"
      } on this page</div>${anchorRows}`
    : "";

  const pageLinkHtml = pageLinkedWithoutAnchor
    ? '<div class="anchor-pill"><i class="fas fa-link"></i> Linked to this page (page-level) <button type="button" class="btn-link delete unlink-page-link-btn">Unlink</button></div>'
    : "";

  const attachmentSources = getAttachmentSourcesForPage(note, currentUrl);
  const attachedFromHtml = attachmentSources.length
    ? `<div class="anchor-pill"><i class="fas fa-paperclip"></i> Attached from ${attachmentSources
        .map((sourceUrl) => {
          const safeUrl = sanitizeUrl(sourceUrl);
          const label = escapeHtml(getAttachmentSourceLabel(sourceUrl));
          return `<a href="${safeUrl}" class="note-url" title="${escapeHtml(
            sourceUrl
          )}" target="_blank" rel="noopener noreferrer">${label}</a>`;
        })
        .join(", ")}</div>`
    : "";

  const selectedTags = normalizeNoteTags(note.tags);

  return `
    <div class="note-card" data-index="${index}" data-url="${escapedNoteUrl}">
      <div class="note-header">
        <div class="note-title">
          Note ${index + 1}
          ${
            viewMode !== "page"
              ? `
            ${noteLinkHtml}
          `
              : ""
          }
        </div>
        <div class="note-actions">
          <button class="note-action-btn attach-btn" title="Attach to current page or selection">
            <i class="fas fa-link"></i>
          </button>
          <button class="note-action-btn cancel-edit-btn" title="Cancel edit" style="display: none;">
            <i class="fas fa-times"></i>
          </button>
          <button class="note-action-btn edit-btn" title="Edit">
            <i class="fas fa-pen"></i>
          </button>
          <button class="note-action-btn delete-btn" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="note-content">
        <div class="note-markdown" data-role="content-display">${renderBasicMarkdown(
          note.content || ""
        )}</div>
        <textarea class="note-textarea" data-role="content-editor" style="display: none;">${escapeHtml(
          note.content || ""
        )}</textarea>
        <div class="tags-container" data-role="tags-display">${selectedTags
          .map((tag) => `<span class="tag selected-tag">#${escapeHtml(tag)}</span>`)
          .join("")}</div>
        <div class="tags-input" data-role="tags-editor" style="display: none;">
          <input type="text" placeholder="Add or select labels" style="border: none; outline: none; flex: 1;">
        </div>
        ${attachedFromHtml}
        ${pageLinkHtml}
        ${anchorsHtml}
      </div>
      <div class="note-footer">
        <span class="timestamp">Created: ${created}</span>
        <span class="timestamp">Modified: ${modified}</span>
      </div>
    </div>
  `;
}

// Attach event listeners to a note
function attachNoteEventListeners(index) {
  const noteCard = document.querySelector(`.note-card[data-index="${index}"]`);
  if (!noteCard) return;
  const note = currentNotes[index];
  if (!note) return;

  const contentDisplay = noteCard.querySelector('[data-role="content-display"]');
  const textarea = noteCard.querySelector('[data-role="content-editor"]');
  const tagsDisplay = noteCard.querySelector('[data-role="tags-display"]');
  const tagsEditor = noteCard.querySelector('[data-role="tags-editor"]');
  const attachBtn = noteCard.querySelector(".attach-btn");
  const reanchorBtns = Array.from(noteCard.querySelectorAll(".reanchor-btn"));
  const anchorJumpBtns = Array.from(noteCard.querySelectorAll(".anchor-jump-btn"));
  const unlinkAnchorBtns = Array.from(noteCard.querySelectorAll(".unlink-anchor-btn"));
  const unlinkPageBtn = noteCard.querySelector(".unlink-page-link-btn");
  const editBtn = noteCard.querySelector(".edit-btn");
  const cancelEditBtn = noteCard.querySelector(".cancel-edit-btn");
  const deleteBtn = noteCard.querySelector(".delete-btn");
  let originalContent;
  let originalTags = [];

  bindTagInputListener(tagsEditor?.querySelector("input"));
  bindMarkdownPasteListener(textarea);

  if (attachBtn) {
    attachBtn.addEventListener("click", async () => {
      await attachExistingNote(index);
    });
  }

  reanchorBtns.forEach((button) => {
    button.addEventListener("click", async () => {
      await reanchorNote(index, button.dataset.anchorId || "");
    });
  });

  anchorJumpBtns.forEach((button) => {
    button.addEventListener("click", async () => {
      await jumpToAnchor(index, button.dataset.anchorId || "");
    });
  });

  unlinkAnchorBtns.forEach((button) => {
    button.addEventListener("click", async () => {
      await unlinkAnchor(index, button.dataset.anchorId || "");
    });
  });

  if (unlinkPageBtn) {
    unlinkPageBtn.addEventListener("click", async () => {
      await unlinkPageLevelLink(index);
    });
  }

  async function commitEdit() {
    const newContent = textarea.value.trim();
    const newTags = collectTagsForSave(tagsEditor);
    const contentChanged = newContent !== originalContent;
    const tagsChanged = !areTagArraysEqual(newTags, originalTags);
    if (contentChanged || tagsChanged) {
      await saveNoteEdit(index, newContent, newTags);
    } else {
      await loadNotes();
    }
  }

  function exitEditMode() {
    textarea.style.display = "none";
    if (contentDisplay) contentDisplay.style.display = "block";
    if (tagsDisplay) tagsDisplay.style.display = "";
    if (tagsEditor) tagsEditor.style.display = "none";
    if (cancelEditBtn) cancelEditBtn.style.display = "none";
    editBtn.innerHTML = '<i class="fas fa-pen"></i>';
    editBtn.title = "Edit";
  }

  function cancelEdit() {
    textarea.value = originalContent;
    if (tagsEditor) {
      renderTagEditor(tagsEditor, originalTags);
    }
    exitEditMode();
  }

  function enterEditMode() {
    originalContent = textarea.value.trim();
    originalTags = normalizeNoteTags(currentNotes[index]?.tags);
    if (contentDisplay) contentDisplay.style.display = "none";
    textarea.style.display = "block";
    textarea.focus();
    if (tagsDisplay) tagsDisplay.style.display = "none";
    if (tagsEditor) {
      tagsEditor.style.display = "flex";
      renderTagEditor(tagsEditor, note.tags || []);
    }
    if (cancelEditBtn) cancelEditBtn.style.display = "";
    editBtn.innerHTML = '<i class="fas fa-save"></i>';
    editBtn.title = "Save";
  }

  editBtn.addEventListener("click", async () => {
    const isEditing = textarea.style.display !== "none";
    if (!isEditing) {
      enterEditMode();
      return;
    }

    await commitEdit();
    exitEditMode();
  });

  if (cancelEditBtn) {
    cancelEditBtn.addEventListener("click", () => {
      const isEditing = textarea.style.display !== "none";
      if (!isEditing) return;
      cancelEdit();
    });
  }

  textarea.addEventListener("keydown", async (e) => {
    const isEditing = textarea.style.display !== "none";
    if (!isEditing) return;

    const isSaveShortcut = (e.ctrlKey || e.metaKey) && e.key === "Enter";
    if (isSaveShortcut) {
      e.preventDefault();
      await commitEdit();
      exitEditMode();
      return;
    }

  });

  deleteBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to delete this note?")) {
      deleteNote(index);
    }
  });
}

// Modal functions
async function openNoteModal() {
  document.getElementById("noteModal").classList.add("active");
  await refreshTagCatalog();
  renderTagEditor(document.getElementById("tagsInput"), []);
  pendingNoteModalContext = await getActiveTabContext();
  pendingSelectionAnchor = await captureSelectionAnchorFromActiveTab(pendingNoteModalContext);
  renderSelectionAnchorHint();
  document.getElementById("newNoteContent").focus();
}

function closeNoteModal() {
  document.getElementById("noteModal").classList.remove("active");
  document.getElementById("newNoteContent").value = "";
  document.getElementById("tagsInput").innerHTML = `
    <input type="text" placeholder="Add or select labels" style="border: none; outline: none; flex: 1;">
  `;
  const input = document.querySelector("#tagsInput input");
  bindTagInputListener(input);
  pendingSelectionAnchor = null;
  pendingNoteModalContext = null;
  const hint = document.getElementById("selectionAnchorHint");
  if (hint) {
    hint.style.display = "none";
    hint.textContent = "";
  }
}

async function openSettingsModal() {
  await loadSettings();
  applySettingsToUi();

  const preferredScope = ["page", "domain", "all"].includes(viewMode) ? viewMode : "all";
  const exportScopeSelect = document.getElementById("exportScopeSelect");
  const importScopeSelect = document.getElementById("importScopeSelect");
  if (exportScopeSelect) exportScopeSelect.value = preferredScope;
  if (importScopeSelect) importScopeSelect.value = preferredScope;

  document.getElementById("settingsModal").classList.add("active");
}

async function closeSettingsModal() {
  const hostScopeEntries = document.getElementById("hostScopeEntries")?.value || "";
  const hostScopeMode = document.getElementById("hostScopeMode")?.value || appSettings.hostScopeMode;
  await saveSettings({ hostScopeMode, hostScopeEntries });
  document.getElementById("settingsModal").classList.remove("active");
}

async function loadHelpMarkdown() {
  if (helpMarkdownCache) return helpMarkdownCache;

  try {
    const response = await fetch(chrome.runtime.getURL("HELP.md"));
    if (!response.ok) {
      throw new Error(`Failed to load help: ${response.status}`);
    }

    helpMarkdownCache = await response.text();
  } catch (error) {
    console.error("Unable to load help markdown:", error);
    helpMarkdownCache = "# Help\n\nThe help guide could not be loaded. Please reload the extension and try again.";
  }

  return helpMarkdownCache;
}

async function openHelpModal() {
  const modal = document.getElementById("helpModal");
  const content = document.getElementById("helpContent");
  if (!modal || !content) return;

  content.innerHTML = "<p>Loading help…</p>";
  modal.classList.add("active");

  const markdown = await loadHelpMarkdown();
  content.innerHTML = renderBasicMarkdown(markdown);
  content.scrollTop = 0;
}

function closeHelpModal() {
  document.getElementById("helpModal")?.classList.remove("active");
}

async function openBulkTagsModal() {
  if (!currentNotes.length) {
    showToast("No current results to edit.", "warning", null, 2800);
    return;
  }

  await refreshTagCatalog();
  renderTagEditor(document.getElementById("bulkAddTagsInput"), []);
  renderTagEditor(document.getElementById("bulkRemoveTagsInput"), []);

  const searchTerm = getCurrentSearchTerm().trim();
  const summary = document.getElementById("bulkTagsSummary");
  if (summary) {
    const scopeDetail = searchTerm
      ? `matching "${searchTerm}"`
      : `from the current ${viewMode} view`;
    summary.textContent = `Apply tag changes to ${currentNotes.length} note(s) ${scopeDetail}.`;
  }

  document.getElementById("bulkTagsModal").classList.add("active");
}

function closeBulkTagsModal() {
  document.getElementById("bulkTagsModal")?.classList.remove("active");
}

async function applyBulkTagChanges() {
  if (!currentNotes.length) {
    closeBulkTagsModal();
    showToast("No current results to edit.", "warning", null, 2800);
    return;
  }

  const addTags = collectTagsForSave(document.getElementById("bulkAddTagsInput"));
  const removeTags = collectTagsForSave(document.getElementById("bulkRemoveTagsInput"));

  if (!addTags.length && !removeTags.length) {
    showToast("Choose tag(s) to add or remove.", "warning", null, 2800);
    return;
  }

  let updatedCount = 0;
  for (const note of currentNotes) {
    const existingTags = normalizeNoteTags(note.tags);
    const nextSet = new Set(existingTags);
    removeTags.forEach((tag) => nextSet.delete(tag));
    addTags.forEach((tag) => nextSet.add(tag));

    const nextTags = Array.from(nextSet).sort((a, b) => a.localeCompare(b));
    if (areTagArraysEqual(existingTags, nextTags)) continue;

    const updated = await updateNoteTagsOnly(note, nextTags);
    if (updated) updatedCount += 1;
  }

  if (!updatedCount) {
    showToast("No tag changes were needed.", "warning", null, 2800);
    return;
  }

  await ensureTagsInCatalog(addTags);
  await refreshTagCatalog();
  closeBulkTagsModal();
  await loadNotes(getCurrentSearchTerm());
  showToast(`Updated tags on ${updatedCount} note(s).`, "success");
}

async function openTagsManagerModal() {
  await refreshTagCatalog();
  renderTagsManager();
  document.getElementById("tagsManagerModal").classList.add("active");
}

function closeTagsManagerModal() {
  document.getElementById("tagsManagerModal").classList.remove("active");
}

function openEditTagModal(oldTag) {
  const oldValueInput = document.getElementById("editTagOldValue");
  const parentSelect = document.getElementById("editTagParentSelect");
  const nameInput = document.getElementById("editTagNameInput");

  const oldSegments = oldTag.split("/");
  const oldLeaf = oldSegments[oldSegments.length - 1] || oldTag;
  const oldParent = oldSegments.length > 1 ? oldSegments.slice(0, -1).join("/") : "";

  oldValueInput.value = oldTag;
  nameInput.value = oldLeaf;

  parentSelect.innerHTML = '<option value="">No parent</option>';
  availableTags
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((tag) => {
      // Prevent selecting itself or one of its descendants as a parent.
      if (tag === oldTag || tag.startsWith(`${oldTag}/`)) return;
      const depth = tag.split("/").length - 1;
      const indent = "\u00A0\u00A0".repeat(depth);
      parentSelect.insertAdjacentHTML(
        "beforeend",
        `<option value="${tag}">${indent}${tag}</option>`
      );
    });

  parentSelect.value = oldParent;
  document.getElementById("editTagModal").classList.add("active");
  nameInput.focus();
}

function closeEditTagModal() {
  document.getElementById("editTagModal").classList.remove("active");
}

async function saveEditedTag() {
  const oldTag = normalizeTag(document.getElementById("editTagOldValue").value);
  const parent = normalizeTag(document.getElementById("editTagParentSelect").value);
  const leaf = normalizeTag(document.getElementById("editTagNameInput").value);

  if (!oldTag || !leaf) return;

  // Keep only the edited leaf segment from the name input.
  const newLeaf = leaf.includes("/") ? leaf.split("/").pop() : leaf;
  const newTag = parent ? `${parent}/${newLeaf}` : newLeaf;

  if (!newTag || newTag === oldTag) {
    closeEditTagModal();
    return;
  }

  if (availableTags.includes(newTag)) {
    alert("That tag already exists.");
    return;
  }

  await renameTagEverywhere(oldTag, newTag);
  closeEditTagModal();
}

// Save functions
async function saveNewNote() {
  const content = document.getElementById("newNoteContent").value.trim();
  if (!content) return;

  const writeContext = pendingNoteModalContext || (await getActiveTabContext());
  if (!writeContext?.url || !writeContext?.hostname) {
    showToast("Could not resolve active page context.", "error");
    return;
  }

  const tags = collectTagsForSave(
    document.getElementById("tagsInput")
  );

  const newNote = {
    content,
    tags,
    anchor: pendingSelectionAnchor,
    url: writeContext.url,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  if (typeof STORAGE.saveNote === "function") {
    await STORAGE.saveNote(newNote, writeContext.hostname);
  } else {
    const existingNotes = (await chrome.storage.local.get(writeContext.hostname)) || {};
    const notes = existingNotes[writeContext.hostname] || [];
    notes.push(newNote);
    await chrome.storage.local.set({ [writeContext.hostname]: notes });
  }

  await ensureTagsInCatalog(tags);
  closeNoteModal();
  await loadNotes();
  showToast("Note saved.", "success");
}

async function saveNoteEdit(index, content, tags) {
  const note = currentNotes[index];
  if (!note) return;

  let updated = false;
  if (typeof STORAGE.updateNote === "function") {
    const result = await STORAGE.updateNote(note, (existing) => ({
      ...existing,
      content: content.trim(),
      tags,
      modifiedAt: new Date().toISOString(),
    }));
    updated = Boolean(result?.updated);
  } else {
    const hostname = new URL(note.url).hostname;
    const existingNotes = await chrome.storage.local.get(hostname);
    const notes = existingNotes[hostname] || [];
    const noteIndex = notes.findIndex(
      (n) => n.url === note.url && n.createdAt === note.createdAt
    );
    if (noteIndex !== -1) {
      notes[noteIndex] = {
        ...notes[noteIndex],
        content: content.trim(),
        tags,
        modifiedAt: new Date().toISOString(),
      };
      await chrome.storage.local.set({ [hostname]: notes });
      updated = true;
    }
  }

  if (updated) {
    await ensureTagsInCatalog(tags);
    await refreshTagCatalog();
    await loadNotes();
    showToast("Note updated.", "success");
  }
}

async function updateNoteTagsOnly(note, tags) {
  if (!note) return false;

  if (typeof STORAGE.updateNote === "function") {
    const result = await STORAGE.updateNote(note, (existing) => ({
      ...existing,
      tags,
      modifiedAt: new Date().toISOString(),
    }));
    return Boolean(result?.updated);
  }

  const hostname = new URL(note.url).hostname;
  const existingNotes = await chrome.storage.local.get(hostname);
  const notes = existingNotes[hostname] || [];
  const noteIndex = notes.findIndex(
    (entry) => entry.url === note.url && entry.createdAt === note.createdAt
  );

  if (noteIndex === -1) return false;

  notes[noteIndex] = {
    ...notes[noteIndex],
    tags,
    modifiedAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [hostname]: notes });
  return true;
}

async function deleteNote(index) {
  const note = currentNotes[index];
  if (!note) return;

  let deleted = null;
  if (typeof STORAGE.deleteNote === "function") {
    deleted = await STORAGE.deleteNote(note);
  } else {
    const hostname = new URL(note.url).hostname;
    const existingNotes = await chrome.storage.local.get(hostname);
    const notes = existingNotes[hostname] || [];
    const noteIndex = notes.findIndex(
      (n) => n.url === note.url && n.createdAt === note.createdAt
    );

    if (noteIndex !== -1) {
      const [deletedNote] = notes.splice(noteIndex, 1);
      await chrome.storage.local.set({ [hostname]: notes });
      deleted = { deleted: true, hostname, note: deletedNote, noteIndex };
    }
  }

  if (deleted?.deleted) {
    await refreshTagCatalog();
    await loadNotes();
    scheduleDeleteUndo({
      hostname: deleted.hostname,
      note: deleted.note,
      noteIndex: deleted.noteIndex,
    });
    showToast("Note deleted.", "warning", {
      label: "Undo",
      onClick: undoLastDelete,
    }, 9000);
  }
}

async function undoLastDelete() {
  if (!deleteUndoState?.note || !deleteUndoState.hostname) return;

  const { hostname, note, noteIndex } = deleteUndoState;
  if (deleteUndoState.timerId) {
    clearTimeout(deleteUndoState.timerId);
  }
  deleteUndoState = null;

  if (typeof STORAGE.insertNote === "function") {
    await STORAGE.insertNote(hostname, note, noteIndex);
  } else {
    const existingNotes = await chrome.storage.local.get(hostname);
    const notes = existingNotes[hostname] || [];
    const insertAt = Math.max(0, Math.min(noteIndex, notes.length));
    notes.splice(insertAt, 0, note);
    await chrome.storage.local.set({ [hostname]: notes });
  }

  await refreshTagCatalog();
  await loadNotes(document.getElementById("searchInput").value || "");
  showToast("Note restored.", "success");
}

function scheduleDeleteUndo(payload) {
  if (deleteUndoState?.timerId) {
    clearTimeout(deleteUndoState.timerId);
  }

  deleteUndoState = {
    ...payload,
    timerId: window.setTimeout(() => {
      deleteUndoState = null;
      hideToast();
    }, 9000),
  };
}

async function reanchorNote(index, anchorId) {
  const note = currentNotes[index];
  if (!note) return;

  const opContext = await getActiveTabContext();
  if (!opContext?.url) {
    showToast("Could not resolve active page context.", "error");
    return;
  }

  const updatedAnchor = await captureSelectionAnchorFromActiveTab(opContext);
  if (!updatedAnchor?.exact) {
    showToast("Select text on the page first, then try Re-anchor.", "error");
    return;
  }

  const result = await (typeof STORAGE.updateNote === "function"
    ? STORAGE.updateNote(note, (stored) => {
        if (anchorId === "legacy-primary") {
          stored.anchor = updatedAnchor;
        } else {
          const links = Array.isArray(stored.linkedAnchors) ? [...stored.linkedAnchors] : [];
          const linkIndex = resolveLinkedAnchorIndexById(links, anchorId);
          if (linkIndex === -1) return null;
          links[linkIndex] = {
            ...links[linkIndex],
            anchor: updatedAnchor,
            url: opContext.url,
          };
          stored.linkedAnchors = links;
        }

        return {
          ...stored,
          modifiedAt: new Date().toISOString(),
        };
      })
    : Promise.resolve({ updated: false }));

  if (!result?.updated && typeof STORAGE.updateNote !== "function") {
    const hostname = new URL(note.url).hostname;
    const existingNotes = await chrome.storage.local.get(hostname);
    const notes = existingNotes[hostname] || [];
    const noteIndex = notes.findIndex(
      (n) => n.url === note.url && n.createdAt === note.createdAt
    );
    if (noteIndex === -1) return;

    const stored = notes[noteIndex];
    if (anchorId === "legacy-primary") {
      stored.anchor = updatedAnchor;
    } else {
      const links = Array.isArray(stored.linkedAnchors) ? [...stored.linkedAnchors] : [];
      const linkIndex = resolveLinkedAnchorIndexById(links, anchorId);
      if (linkIndex === -1) return;
      links[linkIndex] = {
        ...links[linkIndex],
        anchor: updatedAnchor,
        url: opContext.url,
      };
      stored.linkedAnchors = links;
    }

    notes[noteIndex] = {
      ...stored,
      modifiedAt: new Date().toISOString(),
    };

    await chrome.storage.local.set({ [hostname]: notes });
  }

  await loadNotes(document.getElementById("searchInput").value || "");
  showToast("Anchor updated.", "success");
}

async function jumpToAnchor(index, anchorId) {
  const note = currentNotes[index];
  if (!note || !anchorId) return;
  const entry = getAnchorsForPage(note, currentUrl).find((item) => item.id === anchorId);
  if (!entry?.anchor?.exact) return;
  const noteKey = getNoteId(note);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [entry.anchor, noteKey, anchorId],
      func: (anchor, expectedNoteKey, expectedAnchorId) => {
        const allAnchors = Array.from(document.querySelectorAll(".sitenotes-anchor"));
        const exactAnchor = allAnchors.find(
          (el) =>
            el.dataset.noteKey === expectedNoteKey &&
            el.dataset.anchorId === expectedAnchorId
        );

        if (exactAnchor) {
          const rect = exactAnchor.getBoundingClientRect();
          window.scrollTo({
            top: Math.max(0, window.scrollY + rect.top - 140),
            behavior: "smooth",
          });
          return true;
        }

        const text = anchor?.exact;
        if (!text) return false;

        const isEligible = (node) => {
          if (!node || !node.nodeValue || !node.nodeValue.trim()) return false;
          const parent = node.parentElement;
          if (!parent) return false;
          if (parent.closest("script, style, noscript, textarea, input, select")) return false;
          return true;
        };

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let best = null;

        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!isEligible(node)) continue;

          const value = node.nodeValue;
          const idx = value.indexOf(text);
          if (idx === -1) continue;

          const before = value.slice(Math.max(0, idx - 120), idx);
          const after = value.slice(idx + text.length, idx + text.length + 120);
          let score = 1;
          if (anchor.prefix && before.endsWith(anchor.prefix)) score += 3;
          if (anchor.suffix && after.startsWith(anchor.suffix)) score += 3;
          if (!best || score > best.score) {
            best = { node, idx, score };
          }
        }

        if (!best) return false;

        const range = document.createRange();
        range.setStart(best.node, best.idx);
        range.setEnd(best.node, best.idx + text.length);
        const rect = range.getBoundingClientRect();
        if (!rect) return false;

        window.scrollTo({
          top: Math.max(0, window.scrollY + rect.top - 140),
          behavior: "smooth",
        });
        return true;
      },
    });

    const found = Boolean(result?.[0]?.result);
    if (!found) {
      showToast("Could not locate this anchor in the current page.", "error");
      return;
    }
    showToast("Scrolled to anchor.", "success");
  } catch (error) {
    showToast("Unable to jump to anchor on this page.", "error");
  }
}

async function unlinkAnchor(index, anchorId) {
  const note = currentNotes[index];
  if (!note || !anchorId) return;

  const result = await (typeof STORAGE.updateNote === "function"
    ? STORAGE.updateNote(note, (stored) => {
        const next = { ...stored };
        if (anchorId === "legacy-primary") {
          if (!next.anchor?.exact) return null;
          next.anchor = null;
        } else {
          const links = Array.isArray(next.linkedAnchors) ? [...next.linkedAnchors] : [];
          const removeIndex = resolveLinkedAnchorIndexById(links, anchorId);
          if (removeIndex === -1) return null;
          links.splice(removeIndex, 1);
          next.linkedAnchors = links;
        }

        return {
          ...next,
          modifiedAt: new Date().toISOString(),
        };
      })
    : Promise.resolve({ updated: false }));

  if (!result?.updated && typeof STORAGE.updateNote !== "function") {
    const hostname = new URL(note.url).hostname;
    const existingNotes = await chrome.storage.local.get(hostname);
    const notes = existingNotes[hostname] || [];
    const noteIndex = notes.findIndex(
      (n) => n.url === note.url && n.createdAt === note.createdAt
    );
    if (noteIndex === -1) return;

    const stored = { ...notes[noteIndex] };
    if (anchorId === "legacy-primary") {
      if (!stored.anchor?.exact) return;
      stored.anchor = null;
    } else {
      const links = Array.isArray(stored.linkedAnchors) ? [...stored.linkedAnchors] : [];
      const removeIndex = resolveLinkedAnchorIndexById(links, anchorId);
      if (removeIndex === -1) return;
      links.splice(removeIndex, 1);
      stored.linkedAnchors = links;
    }

    notes[noteIndex] = {
      ...stored,
      modifiedAt: new Date().toISOString(),
    };

    await chrome.storage.local.set({ [hostname]: notes });
  }

  await loadNotes(document.getElementById("searchInput").value || "");
  showToast("Anchor unlinked.", "success");
}

async function unlinkPageLevelLink(index) {
  const note = currentNotes[index];
  if (!note) return;

  const result = await (typeof STORAGE.updateNote === "function"
    ? STORAGE.updateNote(note, (stored) => {
        const next = { ...stored };
        const links = Array.isArray(next.linkedAnchors) ? [...next.linkedAnchors] : [];
        const removeIndex = links.findIndex(
          (entry) => entry?.url === currentUrl && !entry?.anchor?.exact
        );
        if (removeIndex === -1) return null;

        links.splice(removeIndex, 1);
        next.linkedAnchors = links;
        return {
          ...next,
          modifiedAt: new Date().toISOString(),
        };
      })
    : Promise.resolve({ updated: false }));

  if (!result?.updated && typeof STORAGE.updateNote === "function") {
    showToast("No page-level link found for this page.", "warning");
    return;
  }

  if (!result?.updated && typeof STORAGE.updateNote !== "function") {
    const hostname = new URL(note.url).hostname;
    const existingNotes = await chrome.storage.local.get(hostname);
    const notes = existingNotes[hostname] || [];
    const noteIndex = notes.findIndex(
      (n) => n.url === note.url && n.createdAt === note.createdAt
    );
    if (noteIndex === -1) return;

    const stored = { ...notes[noteIndex] };
    const links = Array.isArray(stored.linkedAnchors) ? [...stored.linkedAnchors] : [];
    const removeIndex = links.findIndex(
      (entry) => entry?.url === currentUrl && !entry?.anchor?.exact
    );
    if (removeIndex === -1) {
      showToast("No page-level link found for this page.", "warning");
      return;
    }

    links.splice(removeIndex, 1);
    stored.linkedAnchors = links;
    notes[noteIndex] = {
      ...stored,
      modifiedAt: new Date().toISOString(),
    };

    await chrome.storage.local.set({ [hostname]: notes });
  }

  await loadNotes(document.getElementById("searchInput").value || "");
  showToast("Page-level link removed.", "success");
}

async function attachExistingNote(index) {
  const source = currentNotes[index];
  if (!source) return;

  const targetContext = await getActiveTabContext();
  if (!targetContext?.url) {
    showToast("Could not resolve active page context.", "error");
    return;
  }

  const selectionAnchor = await captureSelectionAnchorFromActiveTab(targetContext);

  pendingAttachContext = {
    source,
    targetContext,
    selectionAnchor,
  };
  openAttachNoteModal();
}

function openAttachNoteModal() {
  const modal = document.getElementById("attachNoteModal");
  const text = document.getElementById("attachNoteModalText");
  const selectionBtn = document.getElementById("attachToSelectionBtn");
  const pageBtn = document.getElementById("attachAsPageBtn");

  const hasSelection = Boolean(pendingAttachContext?.selectionAnchor?.exact);
  if (text) {
    text.textContent = hasSelection
      ? "A text selection is available. Attach this note to page or selected text."
      : "No text selection detected. You can still attach this note to the page.";
  }

  if (selectionBtn) {
    selectionBtn.disabled = !hasSelection;
    selectionBtn.title = hasSelection
      ? "Attach to selected text"
      : "Select text on the page first";
  }

  if (pageBtn) {
    pageBtn.disabled = false;
    pageBtn.title = "Attach as page-level link";
  }

  modal?.classList.add("active");
}

function closeAttachNoteModal() {
  document.getElementById("attachNoteModal")?.classList.remove("active");
  pendingAttachContext = null;
}

async function completeAttachExistingNote(mode) {
  if (!pendingAttachContext?.source) {
    closeAttachNoteModal();
    return;
  }

  const { source, selectionAnchor, targetContext } = pendingAttachContext;
  if (!targetContext?.url) {
    showToast("Could not resolve active page context.", "error");
    closeAttachNoteModal();
    return;
  }

  const targetUrl = targetContext.url;
  if (mode === "selection" && !selectionAnchor?.exact) {
    showToast("Select text on the page first, then attach to selection.", "error");
    return;
  }

  const result = await (typeof STORAGE.updateNote === "function"
    ? STORAGE.updateNote(source, (stored) => {
        const links = Array.isArray(stored.linkedAnchors) ? [...stored.linkedAnchors] : [];

        if (mode === "page") {
          const alreadyPageLinked = stored.url === targetUrl || links.some(
            (entry) => entry?.url === targetUrl && !entry?.anchor?.exact
          );
          if (alreadyPageLinked) return null;

          links.push({
            id: createAnchorLinkId(),
            url: targetUrl,
            attachedFrom: source.url,
            anchor: null,
            createdAt: new Date().toISOString(),
            linkType: "page",
          });
        }

        if (mode === "selection") {
          const duplicate = links.some(
            (entry) =>
              entry?.url === targetUrl &&
              entry?.anchor?.exact === selectionAnchor.exact &&
              entry?.anchor?.prefix === selectionAnchor.prefix &&
              entry?.anchor?.suffix === selectionAnchor.suffix
          );
          if (duplicate) return null;

          links.push({
            id: createAnchorLinkId(),
            url: targetUrl,
            attachedFrom: source.url,
            anchor: selectionAnchor,
            createdAt: new Date().toISOString(),
          });
        }

        return {
          ...stored,
          linkedAnchors: links,
          modifiedAt: new Date().toISOString(),
        };
      })
    : Promise.resolve({ updated: false }));

  if (!result?.updated && typeof STORAGE.updateNote === "function") {
    if (result?.reason === "not-found") {
      showToast("Could not locate source note to link.", "error");
      closeAttachNoteModal();
      return;
    }

    showToast(
      mode === "page"
        ? "This note is already linked to the current page."
        : "This selected text is already linked to the note.",
      "warning"
    );
    closeAttachNoteModal();
    return;
  }

  if (!result?.updated && typeof STORAGE.updateNote !== "function") {
    const hostname = new URL(source.url).hostname;
    const existingNotes = await chrome.storage.local.get(hostname);
    const notes = existingNotes[hostname] || [];
    const noteIndex = notes.findIndex(
      (n) => n.url === source.url && n.createdAt === source.createdAt
    );
    if (noteIndex === -1) {
      showToast("Could not locate source note to link.", "error");
      return;
    }

    const stored = notes[noteIndex];
    const links = Array.isArray(stored.linkedAnchors) ? [...stored.linkedAnchors] : [];
    if (mode === "page") {
      const alreadyPageLinked = stored.url === targetUrl || links.some(
        (entry) => entry?.url === targetUrl && !entry?.anchor?.exact
      );
      if (alreadyPageLinked) {
        showToast("This note is already linked to the current page.", "warning");
        closeAttachNoteModal();
        return;
      }

      links.push({
        id: createAnchorLinkId(),
        url: targetUrl,
        attachedFrom: source.url,
        anchor: null,
        createdAt: new Date().toISOString(),
        linkType: "page",
      });
    }

    if (mode === "selection") {
      const duplicate = links.some(
        (entry) =>
          entry?.url === targetUrl &&
          entry?.anchor?.exact === selectionAnchor.exact &&
          entry?.anchor?.prefix === selectionAnchor.prefix &&
          entry?.anchor?.suffix === selectionAnchor.suffix
      );

      if (duplicate) {
        showToast("This selected text is already linked to the note.", "warning");
        closeAttachNoteModal();
        return;
      }

      links.push({
        id: createAnchorLinkId(),
        url: targetUrl,
        attachedFrom: source.url,
        anchor: selectionAnchor,
        createdAt: new Date().toISOString(),
      });
    }

    notes[noteIndex] = {
      ...stored,
      linkedAnchors: links,
      modifiedAt: new Date().toISOString(),
    };

    await chrome.storage.local.set({ [hostname]: notes });
  }

  await refreshTagCatalog();
  await loadNotes(document.getElementById("searchInput").value || "");
  closeAttachNoteModal();
  showToast(
    mode === "page"
      ? "Page link added to existing note."
      : "Anchor link added to existing note.",
    "success"
  );
}

// Utility functions
function toggleActiveButton(activeId, inactiveIds) {
  document.getElementById(activeId).classList.add("active");
  inactiveIds.forEach((id) =>
    document.getElementById(id).classList.remove("active")
  );
}

function normalizeSearchMode(mode) {
  return ["all", "text", "tags"].includes(mode) ? mode : "all";
}

function setSearchMode(mode) {
  currentSearchMode = normalizeSearchMode(mode);
  document.querySelectorAll("[data-search-mode]").forEach((button) => {
    const isActive = button.dataset.searchMode === currentSearchMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateHeaderActionsState(notes = currentNotes) {
  const resultCount = Array.isArray(notes) ? notes.length : 0;
  const bulkTagsBtn = document.getElementById("bulkTagsBtn");
  if (bulkTagsBtn) {
    bulkTagsBtn.disabled = resultCount === 0;
    bulkTagsBtn.title = resultCount
      ? `Edit tags for ${resultCount} current result(s)`
      : "No current results to edit";
  }

  const exportResultsBtn = document.querySelector('[data-export-scope="results"]');
  if (exportResultsBtn) {
    exportResultsBtn.disabled = resultCount === 0;
  }
}

function getCurrentSearchTerm() {
  return String(document.getElementById("searchInput")?.value || "");
}

function stripSearchQuotes(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function simpleNoteMatchesSearch(note, searchTerm, mode = currentSearchMode) {
  const term = stripSearchQuotes(searchTerm).toLowerCase();
  if (!term) return true;

  const textMatch = normalizeNoteContent(note?.content).toLowerCase().includes(term);
  const tagMatch = normalizeNoteTags(note?.tags).some((tag) => tag.toLowerCase().includes(term));

  if (mode === "text") return textMatch;
  if (mode === "tags") return tagMatch;
  return textMatch || tagMatch;
}

function isAdvancedSearchQuery(searchTerm) {
  const raw = String(searchTerm || "");
  return /\b(?:AND|OR|NOT)\b|[()]/i.test(raw) || /\b(?:tag|text):/i.test(raw);
}

function tokenizeSearchExpression(query) {
  const tokens = [];
  const source = String(query || "");
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "lparen", value: char });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rparen", value: char });
      index += 1;
      continue;
    }

    let value = "";
    let inQuote = false;

    while (index < source.length) {
      const current = source[index];
      if (current === '"') {
        inQuote = !inQuote;
        value += current;
        index += 1;
        continue;
      }

      if (!inQuote && (/\s/.test(current) || current === "(" || current === ")")) {
        break;
      }

      value += current;
      index += 1;
    }

    const trimmed = value.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    if (upper === "AND" || upper === "OR" || upper === "NOT") {
      tokens.push({ type: "operator", value: upper });
    } else {
      tokens.push({ type: "term", value: trimmed });
    }
  }

  const withImplicitAnd = [];
  tokens.forEach((token) => {
    const previous = withImplicitAnd[withImplicitAnd.length - 1];
    const needsImplicitAnd =
      previous &&
      (previous.type === "term" || previous.type === "rparen") &&
      (token.type === "term" || token.type === "lparen" || token.value === "NOT");

    if (needsImplicitAnd) {
      withImplicitAnd.push({ type: "operator", value: "AND" });
    }

    withImplicitAnd.push(token);
  });

  return withImplicitAnd;
}

function buildSearchRpn(tokens) {
  const output = [];
  const operators = [];
  const precedence = { OR: 1, AND: 2, NOT: 3 };
  const rightAssociative = new Set(["NOT"]);

  for (const token of tokens) {
    if (token.type === "term") {
      output.push(token);
      continue;
    }

    if (token.type === "operator") {
      while (operators.length) {
        const top = operators[operators.length - 1];
        if (top.type !== "operator") break;

        const shouldPop = rightAssociative.has(token.value)
          ? precedence[token.value] < precedence[top.value]
          : precedence[token.value] <= precedence[top.value];

        if (!shouldPop) break;
        output.push(operators.pop());
      }

      operators.push(token);
      continue;
    }

    if (token.type === "lparen") {
      operators.push(token);
      continue;
    }

    if (token.type === "rparen") {
      let foundLeftParen = false;
      while (operators.length) {
        const top = operators.pop();
        if (top.type === "lparen") {
          foundLeftParen = true;
          break;
        }
        output.push(top);
      }

      if (!foundLeftParen) {
        return null;
      }
    }
  }

  while (operators.length) {
    const top = operators.pop();
    if (top.type === "lparen" || top.type === "rparen") {
      return null;
    }
    output.push(top);
  }

  return output;
}

function resolveSearchTermMatch(note, rawTerm, defaultMode = currentSearchMode) {
  const match = String(rawTerm || "").trim().match(/^(tag|text):(.*)$/i);
  const fieldMode = match
    ? match[1].toLowerCase() === "tag"
      ? "tags"
      : "text"
    : defaultMode;
  const value = stripSearchQuotes(match ? match[2] : rawTerm);

  return simpleNoteMatchesSearch(note, value, fieldMode);
}

function evaluateAdvancedSearch(note, searchTerm, defaultMode = currentSearchMode) {
  const tokens = tokenizeSearchExpression(searchTerm);
  const rpn = buildSearchRpn(tokens);
  if (!rpn?.length) return null;

  const stack = [];
  for (const token of rpn) {
    if (token.type === "term") {
      stack.push(resolveSearchTermMatch(note, token.value, defaultMode));
      continue;
    }

    if (token.value === "NOT") {
      if (stack.length < 1) return null;
      stack.push(!stack.pop());
      continue;
    }

    if (stack.length < 2) return null;
    const right = stack.pop();
    const left = stack.pop();
    stack.push(token.value === "AND" ? left && right : left || right);
  }

  return stack.length === 1 ? stack[0] : null;
}

function noteMatchesSearch(note, searchTerm, mode = currentSearchMode) {
  const trimmed = String(searchTerm || "").trim();
  if (!trimmed) return true;

  if (!isAdvancedSearchQuery(trimmed)) {
    return simpleNoteMatchesSearch(note, trimmed, mode);
  }

  const advancedResult = evaluateAdvancedSearch(note, trimmed, mode);
  if (typeof advancedResult === "boolean") {
    return advancedResult;
  }

  return simpleNoteMatchesSearch(note, trimmed, mode);
}

function closeExportMenu() {
  const menu = document.getElementById("exportMenu");
  const button = document.getElementById("exportMenuBtn");
  if (menu) menu.classList.remove("visible");
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleExportMenu() {
  const menu = document.getElementById("exportMenu");
  const button = document.getElementById("exportMenuBtn");
  if (!menu || !button) return;

  const willOpen = !menu.classList.contains("visible");
  menu.classList.toggle("visible", willOpen);
  button.setAttribute("aria-expanded", String(willOpen));
}

function cloneNoteForTransfer(note) {
  if (typeof structuredClone === "function") {
    return structuredClone(note);
  }

  return JSON.parse(JSON.stringify(note));
}

function buildExportPayloadFromNotes(notes, meta = {}) {
  const safeNotes = Array.isArray(notes)
    ? notes
        .map((note) => normalizeNoteForUi(note))
        .filter((note) => note && note.url && note.content)
    : [];

  const payload = {};
  safeNotes.forEach((note) => {
    const bucketKey = getHostnameFromUrl(note.url) || "imported";
    if (!Array.isArray(payload[bucketKey])) {
      payload[bucketKey] = [];
    }
    payload[bucketKey].push(cloneNoteForTransfer(note));
  });

  const usedTags = collectTagsFromBuckets(payload);
  if (usedTags.length) {
    payload[TAGS_STORAGE_KEY] = usedTags;
  }

  const bucketCount = Object.keys(payload).filter((key) => Array.isArray(payload[key])).length;
  payload.__siteNotesDataVersion__ = 1;
  payload[EXPORT_META_KEY] = {
    ...meta,
    exportedAt: new Date().toISOString(),
    noteCount: safeNotes.length,
    bucketCount,
  };

  return { data: payload, noteCount: safeNotes.length, bucketCount };
}

function resetAllData() {
  if (!confirm("Reset all local data? A backup snapshot will be saved first.")) {
    return;
  }

  const confirmText = prompt("Type RESET to confirm data reset:", "");
  if (confirmText !== "RESET") {
    showToast("Reset cancelled.", "warning");
    return;
  }

  storageGetAll().then(async (existing) => {
    await storageSet({
      __siteNotesBackupBeforeReset__: {
        createdAt: new Date().toISOString(),
        data: existing,
      },
    });

    await storageClear();
    await storageSet({
      [SETTINGS_STORAGE_KEY]: appSettings,
    });

    availableTags = [];
    await loadNotes();
    closeSettingsModal();
    showToast("All data has been reset. Backup snapshot saved.", "success", null, 4800);
  });
}

function getTransferScope(selectId, fallback = "all") {
  const selected = String(document.getElementById(selectId)?.value || fallback);
  return ["page", "domain", "all"].includes(selected) ? selected : fallback;
}

function getTransferScopeLabel(scope) {
  switch (scope) {
    case "page":
      return "this site";
    case "domain":
      return "this domain";
    case "results":
      return "current results";
    default:
      return "all notes";
  }
}

function isNoteBucketEntry(key, value) {
  const metaKeys = new Set([
    TAGS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    COPY_CONTEXT_STORAGE_KEY,
    EXPORT_META_KEY,
    "__siteNotesDataVersion__",
    "__siteNotesBackupBeforeImport__",
    "__siteNotesBackupBeforeReset__",
  ]);

  return !metaKeys.has(key) && Array.isArray(value);
}

function scopeMatchesNote(note, scope) {
  if (!note || typeof note !== "object") return false;

  switch (scope) {
    case "page":
      return Boolean(currentUrl) && noteAppliesToPage(note, currentUrl);
    case "domain":
      if (!currentHostname) return false;
      if (noteUrlHasHostname(note.url, currentHostname)) return true;
      return getLinkedPageUrls(note).some((url) => noteUrlHasHostname(url, currentHostname));
    case "all":
    default:
      return true;
  }
}

function collectTagsFromBuckets(data) {
  const tags = new Set();

  Object.entries(data || {}).forEach(([key, value]) => {
    if (!isNoteBucketEntry(key, value)) return;
    value.forEach((note) => {
      normalizeNoteTags(note?.tags).forEach((tag) => tags.add(tag));
    });
  });

  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function buildScopedDataPayload(data, scope = "all") {
  const source = data && typeof data === "object" ? data : {};
  const scoped = {};
  let noteCount = 0;
  let bucketCount = 0;

  Object.entries(source).forEach(([key, value]) => {
    if (!isNoteBucketEntry(key, value)) return;

    const matchingNotes = value.filter((note) => scopeMatchesNote(note, scope));
    if (!matchingNotes.length) return;

    scoped[key] = matchingNotes;
    noteCount += matchingNotes.length;
    bucketCount += 1;
  });

  const usedTags = collectTagsFromBuckets(scoped);
  if (usedTags.length) {
    scoped[TAGS_STORAGE_KEY] = usedTags;
  } else if (scope === "all" && Array.isArray(source[TAGS_STORAGE_KEY])) {
    scoped[TAGS_STORAGE_KEY] = Array.from(
      new Set(source[TAGS_STORAGE_KEY].map((tag) => normalizeTag(tag)).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }

  if (scope === "all" && source[SETTINGS_STORAGE_KEY]) {
    scoped[SETTINGS_STORAGE_KEY] = normalizeSettings(source[SETTINGS_STORAGE_KEY]);
  }

  scoped.__siteNotesDataVersion__ = Number(source.__siteNotesDataVersion__ || 1);
  scoped[EXPORT_META_KEY] = {
    scope,
    exportedAt: new Date().toISOString(),
    currentUrl: currentUrl || undefined,
    currentHostname: currentHostname || undefined,
    noteCount,
    bucketCount,
  };

  return { data: scoped, noteCount, bucketCount };
}

function sanitizeFilenamePart(value, fallback) {
  const cleaned = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function buildExportFilename(scope) {
  const datePart = new Date().toISOString().slice(0, 10);

  if (scope === "page") {
    return `sitenotes_${sanitizeFilenamePart(currentHostname, "site")}_site_${datePart}.json`;
  }

  if (scope === "domain") {
    return `sitenotes_${sanitizeFilenamePart(currentHostname, "domain")}_domain_${datePart}.json`;
  }

  if (scope === "results") {
    const searchFragment = sanitizeFilenamePart(getCurrentSearchTerm(), "results");
    return `sitenotes_search_${searchFragment}_${datePart}.json`;
  }

  return `sitenotes_all_${datePart}.json`;
}

function exportData(scopeOverride = null) {
  const scope = ["page", "domain", "results", "all"].includes(scopeOverride)
    ? scopeOverride
    : getTransferScope("exportScopeSelect", "all");
  const scopeLabel = getTransferScopeLabel(scope);

  if ((scope === "page" && !currentUrl) || (scope === "domain" && !currentHostname)) {
    showToast(`Open a supported page before exporting ${scopeLabel}.`, "warning", null, 4200);
    return;
  }

  chrome.storage.local.get(null, (data) => {
    const scopedExport =
      scope === "results"
        ? buildExportPayloadFromNotes(currentNotes, {
            scope,
            viewMode,
            searchMode: currentSearchMode,
            searchTerm: getCurrentSearchTerm().trim(),
          })
        : buildScopedDataPayload(data, scope);

    if (!scopedExport.noteCount) {
      showToast(`No notes found for ${scopeLabel}.`, "warning", null, 4200);
      return;
    }

    const blob = new Blob([JSON.stringify(scopedExport.data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = buildExportFilename(scope);
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${scopedExport.noteCount} note(s) for ${scopeLabel}.`, "success");
  });
}

function storageGetAll() {
  return chrome.storage.local.get(null);
}

function storageSet(data) {
  return chrome.storage.local.set(data || {});
}

function storageClear() {
  return chrome.storage.local.clear();
}

function isImportablePageUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return ["http:", "https:", "file:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function normalizeImportNote(note) {
  if (!note || typeof note !== "object") return null;
  if (!isImportablePageUrl(note.url)) return null;

  const content = String(note.content || "").trim();
  if (!content) return null;

  const createdAt = String(note.createdAt || new Date().toISOString());
  const modifiedAt = String(note.modifiedAt || createdAt);
  const tags = Array.isArray(note.tags)
    ? Array.from(new Set(note.tags.map((tag) => normalizeTag(tag)).filter(Boolean)))
    : [];

  const linkedAnchors = Array.isArray(note.linkedAnchors)
    ? note.linkedAnchors
        .filter((entry) => entry && typeof entry === "object" && isImportablePageUrl(entry.url))
        .map((entry) => ({
          id: String(entry.id || createAnchorLinkId()),
          url: String(entry.url),
          attachedFrom: entry.attachedFrom ? String(entry.attachedFrom) : undefined,
          anchor:
            entry.anchor && typeof entry.anchor === "object" && typeof entry.anchor.exact === "string"
              ? {
                  type: "text-quote",
                  exact: String(entry.anchor.exact || ""),
                  prefix: String(entry.anchor.prefix || ""),
                  suffix: String(entry.anchor.suffix || ""),
                  capturedAt: String(entry.anchor.capturedAt || new Date().toISOString()),
                }
              : null,
          createdAt: String(entry.createdAt || new Date().toISOString()),
          linkType: entry.linkType ? String(entry.linkType) : undefined,
        }))
    : [];

  const normalized = {
    url: String(note.url),
    content,
    tags,
    createdAt,
    modifiedAt,
    linkedAnchors,
  };

  if (
    note.anchor &&
    typeof note.anchor === "object" &&
    typeof note.anchor.exact === "string" &&
    note.anchor.exact.trim()
  ) {
    normalized.anchor = {
      type: "text-quote",
      exact: String(note.anchor.exact),
      prefix: String(note.anchor.prefix || ""),
      suffix: String(note.anchor.suffix || ""),
      capturedAt: String(note.anchor.capturedAt || new Date().toISOString()),
    };
  }

  return normalized;
}

function validateImportPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["Top-level backup payload must be an object."], normalized: null };
  }

  const allowedMetaKeys = new Set([
    TAGS_STORAGE_KEY,
    SETTINGS_STORAGE_KEY,
    "__siteNotesDataVersion__",
    "__siteNotesLastCopyContext__",
    "__siteNotesBackupBeforeImport__",
    "__siteNotesBackupBeforeReset__",
    EXPORT_META_KEY,
  ]);

  const errors = [];
  const normalized = {};

  Object.entries(data).forEach(([key, value]) => {
    if (allowedMetaKeys.has(key)) {
      if (key === TAGS_STORAGE_KEY) {
        normalized[key] = Array.isArray(value)
          ? Array.from(new Set(value.map((tag) => normalizeTag(tag)).filter(Boolean))).sort((a, b) =>
              a.localeCompare(b)
            )
          : [];
      } else if (key === SETTINGS_STORAGE_KEY) {
        normalized[key] = normalizeSettings(value);
      } else {
        normalized[key] = value;
      }
      return;
    }

    if (!Array.isArray(value)) {
      errors.push(`Bucket '${key}' is not an array.`);
      return;
    }

    const notes = value
      .map((note) => normalizeImportNote(note))
      .filter(Boolean);

    if (notes.length !== value.length) {
      errors.push(`Bucket '${key}' has invalid note entries.`);
    }

    normalized[key] = notes;
  });

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}

function removeScopeFromExistingData(existing, scope) {
  if (scope === "all") return {};

  const reduced = {};

  Object.entries(existing || {}).forEach(([key, value]) => {
    if (!isNoteBucketEntry(key, value)) {
      reduced[key] = value;
      return;
    }

    const remaining = value.filter((note) => !scopeMatchesNote(note, scope));
    if (remaining.length) {
      reduced[key] = remaining;
    }
  });

  return reduced;
}

function mergeImportData(existing, incoming, options = {}) {
  const merged = { ...existing };
  const includeSettings = options.includeSettings !== false;

  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (key === EXPORT_META_KEY) return;

    if (key === TAGS_STORAGE_KEY) {
      const currentTags = Array.isArray(merged[key]) ? merged[key] : [];
      const incomingTags = Array.isArray(value) ? value : [];
      merged[key] = Array.from(
        new Set([...currentTags, ...incomingTags].map((tag) => normalizeTag(tag)).filter(Boolean))
      ).sort((a, b) => a.localeCompare(b));
      return;
    }

    if (key === SETTINGS_STORAGE_KEY) {
      if (includeSettings && value && typeof value === "object") {
        merged[key] = normalizeSettings({ ...merged[key], ...value });
      }
      return;
    }

    if (
      key === COPY_CONTEXT_STORAGE_KEY ||
      key === "__siteNotesBackupBeforeImport__" ||
      key === "__siteNotesBackupBeforeReset__"
    ) {
      return;
    }

    if (!Array.isArray(value)) {
      merged[key] = value;
      return;
    }

    const current = Array.isArray(existing[key]) ? existing[key] : [];
    const byId = new Map();

    current.forEach((note) => {
      byId.set(`${note.url}::${note.createdAt}`, note);
    });
    value.forEach((note) => {
      byId.set(`${note.url}::${note.createdAt}`, note);
    });

    merged[key] = Array.from(byId.values());
  });

  const usedTags = collectTagsFromBuckets(merged);
  const currentCatalog = Array.isArray(merged[TAGS_STORAGE_KEY]) ? merged[TAGS_STORAGE_KEY] : [];
  merged[TAGS_STORAGE_KEY] = Array.from(
    new Set([...currentCatalog, ...usedTags].map((tag) => normalizeTag(tag)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  return merged;
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const mode = document.getElementById("importModeSelect")?.value || "merge";
  const scope = getTransferScope("importScopeSelect", "all");
  const scopeLabel = getTransferScopeLabel(scope);

  if ((scope === "page" && !currentUrl) || (scope === "domain" && !currentHostname)) {
    showToast(`Open a supported page before importing for ${scopeLabel}.`, "warning", null, 4200);
    e.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const parsed = JSON.parse(String(event.target.result || "{}"));
      const validation = validateImportPayload(parsed);

      if (!validation.valid) {
        showToast(`Import blocked: ${validation.errors[0]}`, "error", null, 5200);
        return;
      }

      const scopedImport = buildScopedDataPayload(validation.normalized, scope);
      if (!scopedImport.noteCount && scope !== "all") {
        showToast(`No notes for ${scopeLabel} were found in this backup.`, "warning", null, 4600);
        return;
      }

      if (mode === "dry-run") {
        showToast(
          `Dry run passed. ${scopedImport.noteCount} note(s) across ${scopedImport.bucketCount} bucket(s) ready for ${scopeLabel}.`,
          "success",
          null,
          4600
        );
        return;
      }

      const existing = await storageGetAll();
      await storageSet({
        __siteNotesBackupBeforeImport__: {
          createdAt: new Date().toISOString(),
          mode,
          scope,
          data: existing,
        },
      });

      if (mode === "replace") {
        const replaceMessage =
          scope === "all"
            ? "Replace mode will overwrite all current data."
            : `Replace mode will overwrite ${scopeLabel} in your current notes.`;

        if (!confirm(replaceMessage)) {
          showToast("Import cancelled.", "warning");
          return;
        }

        const confirmText = prompt("Type REPLACE to continue:", "");
        if (confirmText !== "REPLACE") {
          showToast("Import cancelled.", "warning");
          return;
        }

        if (scope === "all") {
          await storageClear();
          await storageSet(scopedImport.data);
        } else {
          const reducedExisting = removeScopeFromExistingData(existing, scope);
          const merged = mergeImportData(reducedExisting, scopedImport.data, {
            includeSettings: false,
          });
          await storageClear();
          await storageSet(merged);
        }
      } else {
        const merged = mergeImportData(existing, scopedImport.data, {
          includeSettings: scope === "all",
        });
        await storageSet(merged);
      }

      await loadSettings();
      applySettingsToUi();
      await refreshTagCatalog();
      await loadNotes();
      closeSettingsModal();
      showToast(`Imported ${scopedImport.noteCount} note(s) (${mode}, ${scopeLabel}).`, "success");
    } catch (error) {
      showToast("Invalid backup file.", "error");
    } finally {
      e.target.value = "";
    }
  };
  reader.readAsText(file);
}

// Tag handling
function normalizeTag(rawTag) {
  if (!rawTag) return "";
  const cleaned = rawTag.replace(/^#+/, "").trim();
  if (!cleaned) return "";

  const segments = cleaned
    .split("/")
    .map((segment) =>
      segment
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9_.-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .filter(Boolean);

  return segments.join("/");
}

function getNoteId(note) {
  return `${note.url}::${note.createdAt}`;
}

function createAnchorLinkId() {
  return `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function noteUrlHasHostname(url, hostname) {
  try {
    return new URL(url).hostname === hostname;
  } catch {
    return false;
  }
}

function getHostnameFromUrl(url) {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function getLinkedPageUrls(note) {
  if (!Array.isArray(note?.linkedAnchors)) return [];
  return note.linkedAnchors
    .map((entry) => entry?.url)
    .filter((url) => typeof url === "string" && url.length > 0);
}

function getAttachmentSourceLabel(url) {
  try {
    const parsed = new URL(url);
    if (isYouTubeVideo(parsed)) {
      return `${parsed.hostname}/watch?v=${parsed.searchParams.get("v") || ""}`;
    }
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return trimToLength(String(url || ""), 80);
  }
}

function getAttachmentSourcesForPage(note, pageUrl) {
  if (!note || note.url === pageUrl) return [];

  const sources = new Set();
  if (Array.isArray(note.linkedAnchors)) {
    note.linkedAnchors.forEach((entry) => {
      if (entry?.url !== pageUrl) return;
      const source = typeof entry?.attachedFrom === "string" ? entry.attachedFrom : note.url;
      if (source && source !== pageUrl) {
        sources.add(source);
      }
    });
  }

  // Backward-compatible fallback for existing links without attachedFrom metadata.
  if (!sources.size && noteAppliesToPage(note, pageUrl) && note.url !== pageUrl) {
    sources.add(note.url);
  }

  return Array.from(sources);
}

function noteAppliesToPage(note, pageUrl) {
  if (note.url === pageUrl) return true;
  return getLinkedPageUrls(note).includes(pageUrl);
}

function getAnchorsForPage(note, pageUrl) {
  const results = [];

  if (
    note.url === pageUrl &&
    note.anchor?.type === "text-quote" &&
    typeof note.anchor?.exact === "string" &&
    note.anchor.exact.length > 0
  ) {
    results.push({ id: "legacy-primary", anchor: note.anchor, url: note.url });
  }

  if (Array.isArray(note.linkedAnchors)) {
    note.linkedAnchors.forEach((entry, linkIndex) => {
      if (!entry || entry.url !== pageUrl) return;
      if (
        entry.anchor?.type !== "text-quote" ||
        typeof entry.anchor?.exact !== "string" ||
        !entry.anchor.exact
      ) {
        return;
      }
      const id = entry.id || `idx-${linkIndex}`;
      results.push({ id, anchor: entry.anchor, url: entry.url });
    });
  }

  return results;
}

function hasPageLevelLinkForUrl(note, pageUrl) {
  if (!Array.isArray(note?.linkedAnchors)) return false;
  return note.linkedAnchors.some(
    (entry) => entry?.url === pageUrl && !entry?.anchor?.exact
  );
}

function resolveLinkedAnchorIndexById(links, anchorId) {
  const exact = links.findIndex((entry) => entry?.id === anchorId);
  if (exact !== -1) return exact;

  if (anchorId.startsWith("idx-")) {
    const idx = Number(anchorId.slice(4));
    if (Number.isInteger(idx) && idx >= 0 && idx < links.length) {
      return idx;
    }
  }

  return -1;
}

function getAnchorStateKey(note, anchorId) {
  return `${getNoteId(note)}::${anchorId}`;
}

function getAnchorState(note, anchorId) {
  return anchorStateByNoteId[getAnchorStateKey(note, anchorId)]?.status || "unknown";
}

function trimToLength(text, maxLength) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeHtml(text) {
  if (typeof MARKDOWN.escapeHtml === "function") {
    return MARKDOWN.escapeHtml(text);
  }
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url) {
  if (typeof MARKDOWN.sanitizeUrl === "function") {
    return MARKDOWN.sanitizeUrl(url);
  }
  const trimmed = String(url || "").trim();
  if (!trimmed) return "#";
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return "#";
}

function renderInlineMarkdown(text) {
  if (typeof MARKDOWN.renderInlineMarkdown === "function") {
    return MARKDOWN.renderInlineMarkdown(text);
  }
  return escapeHtml(text || "");
}

function renderBasicMarkdown(text) {
  if (typeof MARKDOWN.renderBasicMarkdown === "function") {
    return MARKDOWN.renderBasicMarkdown(text);
  }
  return renderInlineMarkdown(text || "");
}

function renderSelectionAnchorHint() {
  const hint = document.getElementById("selectionAnchorHint");
  if (!hint) return;

  if (!pendingSelectionAnchor?.exact) {
    hint.classList.remove("warning");
    hint.style.display = "none";
    hint.textContent = "";
    return;
  }

  hint.classList.remove("warning");
  hint.style.display = "block";
  hint.innerHTML = `<strong>Anchor:</strong> This note will be attached to selected text.<br>"${escapeHtml(
    trimToLength(pendingSelectionAnchor.exact, 220)
  )}"`;
}

async function getActiveTabContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url) return null;

    const normalizedUrl = normalizeUrlForNotes(tab.url);
    const hostname = getHostnameFromUrl(normalizedUrl);
    return {
      tabId: tab.id,
      rawUrl: tab.url,
      url: normalizedUrl,
      hostname,
    };
  } catch {
    return null;
  }
}

async function captureSelectionAnchorFromActiveTab(tabContext = null) {
  try {
    const context = tabContext || (await getActiveTabContext());
    if (!context?.tabId) return null;

    const results = await chrome.scripting.executeScript({
      target: { tabId: context.tabId },
      func: () => {
        const selection = window.getSelection();
        const range =
          selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
        const rawText = selection ? selection.toString() : "";
        const trimmedText = rawText.trim();
        if (!range || !trimmedText) return null;

        function getNodePath(root, node) {
          if (!root || !node) return null;
          const path = [];
          let current = node;
          while (current && current !== root) {
            const parent = current.parentNode;
            if (!parent) return null;
            const index = Array.prototype.indexOf.call(parent.childNodes, current);
            if (index < 0) return null;
            path.push(index);
            current = parent;
          }
          if (current !== root) return null;
          return path.reverse();
        }

        let exact = trimmedText;
        let prefix = "";
        let suffix = "";
        let textNodePath = null;
        let startOffset = null;
        let endOffset = null;

        // Keep an exact DOM pointer when selection is inside a single text node.
        if (
          range.startContainer === range.endContainer &&
          range.startContainer?.nodeType === Node.TEXT_NODE
        ) {
          const node = range.startContainer;
          const fullNodeText = node.nodeValue || "";
          const selected = fullNodeText.slice(range.startOffset, range.endOffset);
          const leadingTrim = selected.length - selected.trimStart().length;
          const trailingTrim = selected.length - selected.trimEnd().length;
          const localStart = range.startOffset + leadingTrim;
          const localEnd = range.endOffset - trailingTrim;
          const localExact = fullNodeText.slice(localStart, localEnd);

          if (localExact) {
            exact = localExact.slice(0, 1200);
            prefix = fullNodeText.slice(Math.max(0, localStart - 120), localStart);
            suffix = fullNodeText.slice(localEnd, localEnd + 120);
            textNodePath = getNodePath(document.body, node);
            startOffset = localStart;
            endOffset = localEnd;
          }
        }

        if (!prefix && !suffix) {
          const fullText = document.body?.innerText || "";
          const idx = fullText.indexOf(trimmedText);
          prefix = idx >= 0 ? fullText.slice(Math.max(0, idx - 120), idx) : "";
          suffix =
            idx >= 0
              ? fullText.slice(idx + trimmedText.length, idx + trimmedText.length + 120)
              : "";
        }

        return {
          type: "text-quote",
          exact,
          prefix: prefix.slice(-120),
          suffix: suffix.slice(0, 120),
          textNodePath: Array.isArray(textNodePath) ? textNodePath : undefined,
          startOffset: Number.isInteger(startOffset) ? startOffset : undefined,
          endOffset: Number.isInteger(endOffset) ? endOffset : undefined,
          capturedAt: new Date().toISOString(),
        };
      },
    });

    return results?.[0]?.result || null;
  } catch (error) {
    // Some pages (e.g. chrome://) disallow script injection.
    return null;
  }
}

async function refreshAnchorStates(notes) {
  anchorStateByNoteId = {};
  const candidates = notes.flatMap((note) =>
    getAnchorsForPage(note, currentUrl).map((entry) => ({ note, entry }))
  );

  if (!candidates.length) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const texts = candidates.map((item) => item.entry.anchor.exact);
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [texts],
      func: (anchors) => {
        const pageText = document.body?.innerText || "";
        return anchors.map((anchorText) =>
          pageText.includes(anchorText) ? "found" : "missing"
        );
      },
    });

    const states = results?.[0]?.result || [];
    candidates.forEach((item, idx) => {
      anchorStateByNoteId[getAnchorStateKey(item.note, item.entry.id)] = {
        status: states[idx] || "unknown",
      };
    });
  } catch (error) {
    candidates.forEach((item) => {
      anchorStateByNoteId[getAnchorStateKey(item.note, item.entry.id)] = {
        status: "unknown",
      };
    });
  }
}

function handleTagInput(e) {
  const tagsEditor = getTagEditorFromInput(e.target);
  if (!tagsEditor) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    moveTagSuggestion(tagsEditor, 1);
    return;
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    moveTagSuggestion(tagsEditor, -1);
    return;
  }

  if (e.key === "Enter" || e.key === "Tab") {
    if (selectActiveTagSuggestion(tagsEditor)) {
      e.preventDefault();
      return;
    }

    if (e.target.value.trim()) {
      e.preventDefault();
      addTagFromInput(tagsEditor);
    }
    return;
  }

  if (e.key === ",") {
    e.preventDefault();
    addTagFromInput(tagsEditor);
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    hideTagSuggestions(tagsEditor);
  }
}

function parseTagInputValue(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) return [];

  // Prefer explicit hashtag tokens when present, e.g. "#foo #bar".
  const hashtagTokens = raw.match(/#[^\s,]+/g);
  if (hashtagTokens?.length) {
    return Array.from(new Set(hashtagTokens.map((token) => normalizeTag(token)).filter(Boolean)));
  }

  // Fallback: comma/newline separated values.
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((token) => normalizeTag(token))
        .filter(Boolean)
    )
  );
}

function collectTagsForSave(tagsEditor) {
  const selected = new Set(getTagsFromEditor(tagsEditor));
  const input = tagsEditor?.querySelector("input");
  if (input) {
    parseTagInputValue(input.value).forEach((tag) => selected.add(tag));
    input.value = "";
  }

  return Array.from(selected).sort((a, b) => a.localeCompare(b));
}

function getTagsFromEditor(tagsEditor) {
  if (!tagsEditor) return [];
  return Array.from(tagsEditor.querySelectorAll(".tag-chip"))
    .map((chip) => normalizeTag(chip.dataset.tag || ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function addTagChip(tagsEditor, tag) {
  if (!tagsEditor || !tag) return;
  const normalizedTag = normalizeTag(tag);
  if (!normalizedTag) return;

  if (getTagsFromEditor(tagsEditor).includes(normalizedTag)) {
    return;
  }

  const input = tagsEditor.querySelector("input");
  const chip = document.createElement("span");
  chip.className = "tag tag-chip";
  chip.dataset.tag = normalizedTag;

  const label = document.createElement("span");
  label.textContent = `#${normalizedTag}`;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.innerHTML = "&times;";
  removeBtn.addEventListener("click", () => {
    chip.remove();
  });

  chip.appendChild(label);
  chip.appendChild(removeBtn);

  if (input) {
    tagsEditor.insertBefore(chip, input);
  } else {
    tagsEditor.appendChild(chip);
  }

  showTagSuggestions(tagsEditor);
}

function renderTagEditor(tagsEditor, tags) {
  if (!tagsEditor) return;
  tagsEditor.innerHTML =
    '<input type="text" placeholder="Add or select labels" style="border: none; outline: none; flex: 1;">';

  bindTagInputListener(tagsEditor.querySelector("input"));

  (tags || [])
    .map((tag) => normalizeTag(tag))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .forEach((tag) => addTagChip(tagsEditor, tag));

  hideTagSuggestions(tagsEditor);
}

function areTagArraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

async function refreshTagCatalog() {
  const allNotes = await getAllNotes();
  const noteTags = allNotes.flatMap((note) => note.tags || []);
  const stored = await chrome.storage.local.get(TAGS_STORAGE_KEY);
  const storedTags = Array.isArray(stored[TAGS_STORAGE_KEY])
    ? stored[TAGS_STORAGE_KEY]
    : [];

  const merged = Array.from(
    new Set([...storedTags, ...noteTags].map((tag) => normalizeTag(tag)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  availableTags = merged;
  await chrome.storage.local.set({ [TAGS_STORAGE_KEY]: merged });
}

async function ensureTagsInCatalog(tags) {
  const normalizedIncoming = (tags || []).map((tag) => normalizeTag(tag)).filter(Boolean);
  if (!normalizedIncoming.length) return;

  const merged = Array.from(new Set([...availableTags, ...normalizedIncoming])).sort((a, b) =>
    a.localeCompare(b)
  );
  availableTags = merged;
  await chrome.storage.local.set({ [TAGS_STORAGE_KEY]: merged });
}

function getTagDisplayRows(tags) {
  return tags
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .map((tag) => ({
      fullTag: tag,
      depth: tag.split("/").length - 1,
    }));
}

function renderTagsManager() {
  const list = document.getElementById("tagsManagerList");
  const parentSelect = document.getElementById("newTagParentSelect");

  parentSelect.innerHTML = '<option value="">No parent</option>';
  availableTags
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .forEach((tag) => {
      const depth = tag.split("/").length - 1;
      const indent = "\u00A0\u00A0".repeat(depth);
      parentSelect.insertAdjacentHTML(
        "beforeend",
        `<option value="${tag}">${indent}${tag}</option>`
      );
    });

  if (!availableTags.length) {
    list.innerHTML = '<div class="tag-manager-empty">No tags yet.</div>';
    return;
  }

  const rows = getTagDisplayRows(availableTags);
  list.innerHTML = rows
    .map(
      (row) => `
        <div class="tag-manager-item" data-tag="${row.fullTag}">
          <div class="tag-manager-name" style="padding-left: ${row.depth * 12}px">#${row.fullTag}</div>
          <div class="tag-manager-actions">
            <button type="button" class="btn-link edit-tag-btn">Edit</button>
            <button type="button" class="btn-link delete delete-tag-btn">Delete</button>
          </div>
          <span></span>
        </div>
      `
    )
    .join("");

  list.querySelectorAll(".edit-tag-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".tag-manager-item");
      const oldTag = row?.dataset.tag;
      if (!oldTag) return;
      openEditTagModal(oldTag);
    });
  });

  list.querySelectorAll(".delete-tag-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".tag-manager-item");
      const tag = row?.dataset.tag;
      if (!tag) return;

      const ok = confirm(
        `Delete tag '${tag}' everywhere? Nested tags under it will also be removed.`
      );
      if (!ok) return;

      await deleteTagEverywhere(tag);
    });
  });
}

async function createTagFromManager() {
  const parent = normalizeTag(document.getElementById("newTagParentSelect").value);
  const name = normalizeTag(document.getElementById("newTagNameInput").value);

  if (!name) return;

  // Only take the final segment for the name field and compose full path using parent.
  const leaf = name.includes("/") ? name.split("/").pop() : name;
  const fullTag = parent ? `${parent}/${leaf}` : leaf;

  if (availableTags.includes(fullTag)) {
    alert("Tag already exists.");
    return;
  }

  await ensureTagsInCatalog([fullTag]);
  document.getElementById("newTagNameInput").value = "";
  renderTagsManager();
  renderTagEditor(document.getElementById("tagsInput"), []);
  await loadNotes();
  showToast(`Tag '#${fullTag}' created.`, "success");
}

async function renameTagEverywhere(oldTag, newTag) {
  await rewriteTagsEverywhere((tag) => {
    if (tag === oldTag) return newTag;
    if (tag.startsWith(`${oldTag}/`)) return `${newTag}${tag.slice(oldTag.length)}`;
    return tag;
  });
  showToast(`Tag '#${oldTag}' renamed to '#${newTag}'.`, "success");
}

async function deleteTagEverywhere(targetTag) {
  await rewriteTagsEverywhere((tag) => {
    if (tag === targetTag || tag.startsWith(`${targetTag}/`)) return null;
    return tag;
  });
  showToast(`Tag '#${targetTag}' deleted.`, "success");
}

function showToast(message, type = "success", action = null, durationMs = 3500) {
  const toast = document.getElementById("toast");
  const toastMessage = document.getElementById("toastMessage");
  const toastAction = document.getElementById("toastActionBtn");

  if (!toast || !toastMessage) return;

  if (window.__siteNotesToastTimeout) {
    clearTimeout(window.__siteNotesToastTimeout);
  }

  toast.classList.remove("success", "warning", "error");
  toast.classList.add(type, "visible");
  toastMessage.textContent = message;

  if (toastAction) {
    if (action?.label && typeof action?.onClick === "function") {
      toastAction.style.display = "inline-flex";
      toastAction.textContent = action.label;
      toastAction.onclick = () => {
        action.onClick();
      };
    } else {
      toastAction.style.display = "none";
      toastAction.onclick = null;
    }
  }

  window.__siteNotesToastTimeout = window.setTimeout(() => {
    hideToast();
  }, durationMs);
}

function hideToast() {
  const toast = document.getElementById("toast");
  const toastAction = document.getElementById("toastActionBtn");
  if (!toast) return;
  toast.classList.remove("visible");
  if (toastAction) {
    toastAction.style.display = "none";
    toastAction.onclick = null;
  }
}

async function rewriteTagsEverywhere(mapTagFn) {
  if (typeof STORAGE.rewriteTags === "function") {
    await STORAGE.rewriteTags((tag) => mapTagFn(normalizeTag(tag)));
  } else {
    const data = await chrome.storage.local.get(null);
    const updates = {};

    const storedCatalog = Array.isArray(data[TAGS_STORAGE_KEY])
      ? data[TAGS_STORAGE_KEY]
      : [];
    const rewrittenCatalog = Array.from(
      new Set(
        storedCatalog
          .map((tag) => normalizeTag(tag))
          .map((tag) => mapTagFn(tag))
          .map((tag) => normalizeTag(tag))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    updates[TAGS_STORAGE_KEY] = rewrittenCatalog;

    Object.entries(data).forEach(([key, value]) => {
      if (key === TAGS_STORAGE_KEY || !Array.isArray(value)) return;

      let changedInBucket = false;
      const updatedNotes = value.map((note) => {
        const currentTags = (note.tags || []).map((tag) => normalizeTag(tag)).filter(Boolean);
        const mapped = currentTags
          .map((tag) => mapTagFn(tag))
          .map((tag) => normalizeTag(tag))
          .filter(Boolean);
        const deduped = Array.from(new Set(mapped));
        const changed = !areTagArraysEqual(deduped, currentTags);

        if (changed) {
          changedInBucket = true;
          return {
            ...note,
            tags: deduped,
            modifiedAt: new Date().toISOString(),
          };
        }
        return note;
      });

      if (changedInBucket) {
        updates[key] = updatedNotes;
      }
    });

    if (Object.keys(updates).length) {
      await chrome.storage.local.set(updates);
    }
  }

  await refreshTagCatalog();
  renderTagsManager();
  renderTagEditor(document.getElementById("tagsInput"), []);
  loadNotes();
}

// Initialize the extension
document.addEventListener("DOMContentLoaded", initialize);
