let currentUrl = "";
let currentHostname = "";
let viewMode = "page"; // "page", "domain", or "all"
let currentNotes = [];
let availableTags = [];
let pendingSelectionAnchor = null;
let anchorStateByNoteId = {};
let pendingAttachContext = null;

const TAGS_STORAGE_KEY = "__siteNotesTags__";

function bindTagInputListener(input) {
  if (!input || input.dataset.tagInputBound === "1") return;
  input.addEventListener("keydown", handleTagInput);
  input.dataset.tagInputBound = "1";
}

// Initialize the extension
async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const url = new URL(tab.url);
  currentHostname = url.hostname;

  // Special handling for YouTube videos
  if (isYouTubeVideo(url)) {
    currentUrl = `${url.origin}${url.pathname}?v=${url.searchParams.get("v")}`;
  } else {
    // For other URLs, remove query parameters and hash
    url.search = "";
    url.hash = "";
    currentUrl = url.toString();
  }

  // Update UI
  document.getElementById("currentUrl").textContent = currentHostname;
  document.getElementById(
    "favicon"
  ).src = `https://www.google.com/s2/favicons?domain=${currentHostname}`;

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
    .addEventListener("click", exportData);
  document.getElementById("importDataBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });
  document
    .getElementById("importFileInput")
    .addEventListener("change", importData);

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

  // Tab changes
  chrome.tabs.onActivated.addListener(initialize);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
      initialize();
    }
  });
}

// Load notes based on current view mode and search term
async function loadNotes(searchTerm = "") {
  const allNotes = await getAllNotes();
  let filteredNotes = [];

  switch (viewMode) {
    case "page":
      filteredNotes = allNotes.filter((note) => note.url === currentUrl);
      break;
    case "domain":
      filteredNotes = allNotes.filter((note) => {
        const noteUrl = new URL(note.url);
        return noteUrl.hostname === currentHostname;
      });
      break;
    case "all":
      filteredNotes = allNotes;
      break;
  }

  // Filter by search term
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filteredNotes = filteredNotes.filter(
      (note) =>
        note.content.toLowerCase().includes(term) ||
        (note.tags || []).some((tag) => tag.toLowerCase().includes(term))
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
    const data = await chrome.storage.local.get(null);
    return Object.entries(data)
      .filter(([key, value]) => key !== TAGS_STORAGE_KEY && Array.isArray(value))
      .flatMap(([, value]) => value)
      .filter((note) => note && typeof note === "object" && note.url && note.content);
  } catch (error) {
    console.error("Error getting notes:", error);
    return [];
  }
}

// Display notes in the container
function displayNotes(notes) {
  const container = document.getElementById("notesContainer");
  const searchTerm = document.getElementById("searchInput").value;

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
  const noteUrl = new URL(note.url);
  const displayUrl = isYouTubeVideo(noteUrl)
    ? `YouTube: ${noteUrl.searchParams.get("v")}`
    : noteUrl.pathname === "/"
    ? noteUrl.hostname
    : noteUrl.pathname;

  const noteId = getNoteId(note);
  const anchorState = anchorStateByNoteId[noteId] || null;
  const hasAnchor = Boolean(note.anchor?.exact);
  const anchorSnippet = hasAnchor
    ? escapeHtml(trimToLength(note.anchor.exact, 180))
    : "";
  const anchorStatusHtml = !hasAnchor
    ? ""
    : anchorState?.status === "missing"
    ? '<div class="anchor-clue warning"><strong>Anchor changed.</strong> Selected text was not found in the current page DOM. This note is shown as a page-level fallback.</div>'
    : '<div class="anchor-pill"><i class="fas fa-link"></i> Anchored to selected text</div>';

  return `
    <div class="note-card" data-index="${index}" data-url="${note.url}">
      <div class="note-header">
        <div class="note-title">
          Note ${index + 1}
          ${
            viewMode !== "page"
              ? `
            <a href="${note.url}" class="note-url" title="${note.url}">
              ${displayUrl}
            </a>
          `
              : ""
          }
        </div>
        <div class="note-actions">
          <button class="note-action-btn attach-btn" title="Attach to current page or selection">
            <i class="fas fa-link"></i>
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
        <div class="tags-container" data-role="tags-display">
          ${(note.tags || []).map((tag) => `<span class="tag">#${tag}</span>`).join("")}
        </div>
        <div class="tags-input" data-role="tags-editor" style="display: none;">
          ${(note.tags || [])
            .map(
              (tag) =>
                `<span class="tag">#${tag}<button type="button" title="Remove tag">&times;</button></span>`
            )
            .join("")}
          <input type="text" placeholder="Add tags (press Enter)" style="border: none; outline: none; flex: 1;">
        </div>
        <div class="available-tags" data-role="tags-picker" style="display: none;"></div>
        ${anchorStatusHtml}
        ${
          hasAnchor
            ? `<div class="anchor-quote" title="Selected text">"${anchorSnippet}"</div>`
            : ""
        }
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

  const contentDisplay = noteCard.querySelector('[data-role="content-display"]');
  const textarea = noteCard.querySelector('[data-role="content-editor"]');
  const tagsDisplay = noteCard.querySelector('[data-role="tags-display"]');
  const tagsEditor = noteCard.querySelector('[data-role="tags-editor"]');
  const tagsInput = tagsEditor?.querySelector("input");
  const tagsPicker = noteCard.querySelector('[data-role="tags-picker"]');
  const attachBtn = noteCard.querySelector(".attach-btn");
  const editBtn = noteCard.querySelector(".edit-btn");
  const deleteBtn = noteCard.querySelector(".delete-btn");
  let originalContent;
  let originalTags = [];

  if (tagsInput) {
    tagsInput.addEventListener("keydown", handleTagInput);
  }
  attachTagDeleteHandlers(tagsEditor);

  if (attachBtn) {
    attachBtn.addEventListener("click", async () => {
      await attachExistingNote(index);
    });
  }

  editBtn.addEventListener("click", async () => {
    const isEditing = textarea.style.display === "none";

    if (isEditing) {
      // Enter edit mode
      originalContent = textarea.value;
      originalTags = getTagsFromEditor(tagsEditor);
      if (contentDisplay) contentDisplay.style.display = "none";
      textarea.style.display = "block";
      textarea.focus();
      if (tagsDisplay) tagsDisplay.style.display = "none";
      if (tagsEditor) tagsEditor.style.display = "flex";
      if (tagsPicker) {
        tagsPicker.style.display = "flex";
        buildTagPicker(tagsPicker, tagsEditor);
      }
      editBtn.innerHTML = '<i class="fas fa-save"></i>';
      editBtn.title = "Save";
    } else {
      // Save changes
      const newContent = textarea.value.trim();
      const newTags = collectTagsForSave(tagsEditor, tagsPicker);
      const contentChanged = newContent !== originalContent;
      const tagsChanged = !areTagArraysEqual(newTags, originalTags);
      if (contentChanged || tagsChanged) {
        await saveNoteEdit(index, newContent, newTags);
      } else {
        loadNotes();
      }
      textarea.style.display = "none";
      if (contentDisplay) contentDisplay.style.display = "block";
      if (tagsDisplay) tagsDisplay.style.display = "";
      if (tagsEditor) tagsEditor.style.display = "none";
      if (tagsPicker) tagsPicker.style.display = "none";
      editBtn.innerHTML = '<i class="fas fa-pen"></i>';
      editBtn.title = "Edit";
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
  renderNewNoteTagPicker();
  pendingSelectionAnchor = await captureSelectionAnchorFromActiveTab();
  renderSelectionAnchorHint();
  document.getElementById("newNoteContent").focus();
}

function closeNoteModal() {
  document.getElementById("noteModal").classList.remove("active");
  document.getElementById("newNoteContent").value = "";
  document.getElementById("tagsInput").innerHTML = `
    <input type="text" placeholder="Add tags (press Enter)" style="border: none; outline: none; flex: 1;">
  `;
  const input = document.querySelector("#tagsInput input");
  bindTagInputListener(input);
  document.getElementById("noteTagPicker").innerHTML = "";
  pendingSelectionAnchor = null;
  const hint = document.getElementById("selectionAnchorHint");
  if (hint) {
    hint.style.display = "none";
    hint.textContent = "";
  }
}

function openSettingsModal() {
  document.getElementById("settingsModal").classList.add("active");
}

function closeSettingsModal() {
  document.getElementById("settingsModal").classList.remove("active");
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

  const tags = collectTagsForSave(
    document.getElementById("tagsInput"),
    document.getElementById("noteTagPicker")
  );

  const newNote = {
    content,
    tags,
    anchor: pendingSelectionAnchor,
    url: currentUrl,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };

  const existingNotes = (await chrome.storage.local.get(currentHostname)) || {};
  const notes = existingNotes[currentHostname] || [];
  notes.push(newNote);

  await chrome.storage.local.set({ [currentHostname]: notes });
  await ensureTagsInCatalog(tags);
  closeNoteModal();
  loadNotes();
}

async function saveNoteEdit(index, content, tags) {
  const note = currentNotes[index];
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
    await ensureTagsInCatalog(tags);
    await refreshTagCatalog();
    loadNotes();
  }
}

async function deleteNote(index) {
  const note = currentNotes[index];
  const hostname = new URL(note.url).hostname;
  const existingNotes = await chrome.storage.local.get(hostname);
  const notes = existingNotes[hostname] || [];

  const noteIndex = notes.findIndex(
    (n) => n.url === note.url && n.createdAt === note.createdAt
  );

  if (noteIndex !== -1) {
    notes.splice(noteIndex, 1);
    await chrome.storage.local.set({ [hostname]: notes });
    await refreshTagCatalog();
    loadNotes();
  }
}

async function attachExistingNote(index) {
  const source = currentNotes[index];
  if (!source) return;

  const selectionAnchor = await captureSelectionAnchorFromActiveTab();

  pendingAttachContext = {
    source,
    selectionAnchor,
  };
  openAttachNoteModal();
}

function openAttachNoteModal() {
  const modal = document.getElementById("attachNoteModal");
  const text = document.getElementById("attachNoteModalText");
  const selectionBtn = document.getElementById("attachToSelectionBtn");

  const hasSelection = Boolean(pendingAttachContext?.selectionAnchor?.exact);
  if (text) {
    text.textContent = hasSelection
      ? "A text selection is available. Choose where to attach this note."
      : "No text selection detected. You can attach this note to the current page.";
  }

  if (selectionBtn) {
    selectionBtn.disabled = !hasSelection;
    selectionBtn.title = hasSelection
      ? "Attach to selected text"
      : "Select text on the page first";
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

  const { source, selectionAnchor } = pendingAttachContext;
  const anchor =
    mode === "selection" && selectionAnchor?.exact ? selectionAnchor : null;

  const attachedNote = {
    content: source.content,
    tags: Array.isArray(source.tags) ? [...source.tags] : [],
    anchor,
    url: currentUrl,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    attachedFrom: {
      url: source.url,
      createdAt: source.createdAt,
    },
  };

  const existingNotes = (await chrome.storage.local.get(currentHostname)) || {};
  const notes = existingNotes[currentHostname] || [];
  notes.push(attachedNote);

  await chrome.storage.local.set({ [currentHostname]: notes });
  await ensureTagsInCatalog(attachedNote.tags);
  await refreshTagCatalog();
  await loadNotes(document.getElementById("searchInput").value || "");
  closeAttachNoteModal();
}

// Utility functions
function toggleActiveButton(activeId, inactiveIds) {
  document.getElementById(activeId).classList.add("active");
  inactiveIds.forEach((id) =>
    document.getElementById(id).classList.remove("active")
  );
}

function resetAllData() {
  if (
    confirm("Are you sure you want to reset all data? This cannot be undone.")
  ) {
    chrome.storage.local.clear(async () => {
      availableTags = [];
      await loadNotes();
      closeSettingsModal();
    });
  }
}

function exportData() {
  chrome.storage.local.get(null, (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sitenotes_backup.json";
    a.click();
    URL.revokeObjectURL(url);
  });
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const data = JSON.parse(event.target.result);
      chrome.storage.local.clear(() => {
        chrome.storage.local.set(data, async () => {
          await refreshTagCatalog();
          await loadNotes();
          closeSettingsModal();
        });
      });
    } catch (error) {
      alert("Invalid backup file");
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

function trimToLength(text, maxLength) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeHtml(text) {
  return String(text)
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

function renderInlineMarkdown(text) {
  let html = escapeHtml(text || "");

  // Markdown links: [label](https://example.com)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    const safe = sanitizeUrl(url);
    if (safe === "#") return label;
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // Auto-link plain URLs
  html = html.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (m, prefix, url) => {
    const safe = sanitizeUrl(url);
    return `${prefix}<a href="${safe}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });

  // Basic emphasis
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

async function captureSelectionAnchorFromActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const selection = window.getSelection();
        const text = selection ? selection.toString().trim() : "";
        if (!text) return null;

        const fullText = document.body?.innerText || "";
        const idx = fullText.indexOf(text);
        const prefix = idx >= 0 ? fullText.slice(Math.max(0, idx - 40), idx) : "";
        const suffix =
          idx >= 0
            ? fullText.slice(idx + text.length, idx + text.length + 40)
            : "";

        return {
          type: "text-quote",
          exact: text.slice(0, 1200),
          prefix: prefix.slice(-120),
          suffix: suffix.slice(0, 120),
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
  const candidates = notes.filter(
    (note) => note.url === currentUrl && note.anchor?.type === "text-quote" && note.anchor?.exact
  );

  if (!candidates.length) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const texts = candidates.map((note) => note.anchor.exact);
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
    candidates.forEach((note, idx) => {
      anchorStateByNoteId[getNoteId(note)] = { status: states[idx] || "unknown" };
    });
  } catch (error) {
    candidates.forEach((note) => {
      anchorStateByNoteId[getNoteId(note)] = { status: "unknown" };
    });
  }
}

function handleTagInput(e) {
  if (e.key === "Enter" && e.target.value.trim()) {
    e.preventDefault();
    const tag = normalizeTag(e.target.value);
    if (!tag) return;

    const existingTags = getTagsFromEditor(e.target.parentElement);
    if (existingTags.includes(tag)) {
      e.target.value = "";
      return;
    }

    insertTagChip(e.target.parentElement, tag, e.target);
    e.target.value = "";
    syncTagPickerSelectionForContainer(e.target.parentElement);
  }
}

function insertTagChip(container, tag, beforeElement) {
  const tagElement = document.createElement("span");
  tagElement.className = "tag";
  tagElement.innerHTML = `#${tag}<button type="button">&times;</button>`;

  const deleteBtn = tagElement.querySelector("button");
  deleteBtn.addEventListener("click", function () {
    tagElement.remove();
    syncTagPickerSelectionForContainer(container);
  });

  container.insertBefore(tagElement, beforeElement || container.querySelector("input"));
}

function getTagsFromEditor(tagsEditor) {
  if (!tagsEditor) return [];
  return Array.from(tagsEditor.querySelectorAll(".tag"))
    .map((tagElement) =>
      normalizeTag(
        tagElement.textContent.replace(/^#/, "").replace("×", "").trim()
      )
    )
    .filter(Boolean);
}

function collectTagsForSave(tagsEditor, tagsPicker) {
  const chipTags = getTagsFromEditor(tagsEditor);
  const pendingInput = tagsEditor?.querySelector("input")?.value || "";
  const pendingTag = normalizeTag(pendingInput);

  const activePickerTags = Array.from(
    tagsPicker?.querySelectorAll(".available-tag-btn.active") || []
  )
    .map((button) => normalizeTag(button.dataset.tag || ""))
    .filter(Boolean);

  return Array.from(
    new Set([...chipTags, ...activePickerTags, pendingTag].filter(Boolean))
  );
}

function attachTagDeleteHandlers(tagsEditor) {
  if (!tagsEditor) return;
  tagsEditor.querySelectorAll(".tag button").forEach((button) => {
    button.addEventListener("click", () => {
      button.parentElement.remove();
      syncTagPickerSelectionForContainer(tagsEditor);
    });
  });
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

function renderNewNoteTagPicker() {
  const picker = document.getElementById("noteTagPicker");
  const editor = document.getElementById("tagsInput");
  buildTagPicker(picker, editor);
}

function buildTagPicker(pickerContainer, editorContainer) {
  if (!pickerContainer || !editorContainer) return;

  if (!availableTags.length) {
    pickerContainer.innerHTML = "";
    return;
  }

  const selected = new Set(getTagsFromEditor(editorContainer));
  pickerContainer.innerHTML = availableTags
    .map((tag) => {
      const activeClass = selected.has(tag) ? "active" : "";
      return `<button type="button" class="available-tag-btn ${activeClass}" data-tag="${tag}">#${tag}</button>`;
    })
    .join("");

  pickerContainer.querySelectorAll(".available-tag-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const tag = button.dataset.tag;
      const input = editorContainer.querySelector("input");
      const editorTags = getTagsFromEditor(editorContainer);

      if (editorTags.includes(tag)) {
        const chip = Array.from(editorContainer.querySelectorAll(".tag")).find(
          (el) => normalizeTag(el.textContent.replace(/^#/, "").replace("×", "").trim()) === tag
        );
        if (chip) chip.remove();
      } else {
        insertTagChip(editorContainer, tag, input);
      }

      syncTagPickerSelectionForContainer(editorContainer);
    });
  });
}

function syncTagPickerSelectionForContainer(editorContainer) {
  const noteModalEditor = document.getElementById("tagsInput");
  if (editorContainer === noteModalEditor) {
    renderNewNoteTagPicker();
    return;
  }

  const noteCard = editorContainer.closest(".note-card");
  if (!noteCard) return;
  const picker = noteCard.querySelector('[data-role="tags-picker"]');
  if (!picker) return;
  buildTagPicker(picker, editorContainer);
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
  renderNewNoteTagPicker();
  loadNotes();
}

async function renameTagEverywhere(oldTag, newTag) {
  await rewriteTagsEverywhere((tag) => {
    if (tag === oldTag) return newTag;
    if (tag.startsWith(`${oldTag}/`)) return `${newTag}${tag.slice(oldTag.length)}`;
    return tag;
  });
}

async function deleteTagEverywhere(targetTag) {
  await rewriteTagsEverywhere((tag) => {
    if (tag === targetTag || tag.startsWith(`${targetTag}/`)) return null;
    return tag;
  });
}

async function rewriteTagsEverywhere(mapTagFn) {
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

  await refreshTagCatalog();
  renderTagsManager();
  renderNewNoteTagPicker();
  loadNotes();
}

// Initialize the extension
document.addEventListener("DOMContentLoaded", initialize);
