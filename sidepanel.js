let currentUrl = "";
let currentHostname = "";
let viewMode = "page"; // "page", "domain", or "all"
let currentNotes = [];
let availableTags = [];

const TAGS_STORAGE_KEY = "__siteNotesTags__";

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
    .getElementById("newTagNameInput")
    .addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createTagFromManager();
      }
    });

  // New note tags input
  const tagsInput = document.querySelector("#tagsInput input");
  if (tagsInput) {
    tagsInput.addEventListener("keydown", handleTagInput);
  }

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
          <button class="note-action-btn edit-btn" title="Edit">
            <i class="fas fa-pen"></i>
          </button>
          <button class="note-action-btn delete-btn" title="Delete">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
      <div class="note-content">
        <textarea class="note-textarea" readonly>${note.content}</textarea>
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

  const textarea = noteCard.querySelector(".note-textarea");
  const tagsDisplay = noteCard.querySelector('[data-role="tags-display"]');
  const tagsEditor = noteCard.querySelector('[data-role="tags-editor"]');
  const tagsInput = tagsEditor?.querySelector("input");
  const tagsPicker = noteCard.querySelector('[data-role="tags-picker"]');
  const editBtn = noteCard.querySelector(".edit-btn");
  const deleteBtn = noteCard.querySelector(".delete-btn");
  let originalContent;
  let originalTags = [];

  if (tagsInput) {
    tagsInput.addEventListener("keydown", handleTagInput);
  }
  attachTagDeleteHandlers(tagsEditor);

  editBtn.addEventListener("click", async () => {
    const isEditing = textarea.hasAttribute("readonly");

    if (isEditing) {
      // Enter edit mode
      originalContent = textarea.value;
      originalTags = getTagsFromEditor(tagsEditor);
      textarea.removeAttribute("readonly");
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
      const newTags = getTagsFromEditor(tagsEditor);
      const contentChanged = newContent !== originalContent;
      const tagsChanged = !areTagArraysEqual(newTags, originalTags);
      if (contentChanged || tagsChanged) {
        await saveNoteEdit(index, newContent, newTags);
      } else {
        loadNotes();
      }
      textarea.setAttribute("readonly", "true");
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
  document.getElementById("newNoteContent").focus();
}

function closeNoteModal() {
  document.getElementById("noteModal").classList.remove("active");
  document.getElementById("newNoteContent").value = "";
  document.getElementById("tagsInput").innerHTML = `
    <input type="text" placeholder="Add tags (press Enter)" style="border: none; outline: none; flex: 1;">
  `;
  const input = document.querySelector("#tagsInput input");
  if (input) {
    input.addEventListener("keydown", handleTagInput);
  }
  document.getElementById("noteTagPicker").innerHTML = "";
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

// Save functions
async function saveNewNote() {
  const content = document.getElementById("newNoteContent").value.trim();
  if (!content) return;

  const tags = getTagsFromEditor(document.getElementById("tagsInput"));

  const newNote = {
    content,
    tags,
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
            <button type="button" class="btn-link rename-tag-btn">Rename</button>
            <button type="button" class="btn-link delete delete-tag-btn">Delete</button>
          </div>
          <span></span>
        </div>
      `
    )
    .join("");

  list.querySelectorAll(".rename-tag-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest(".tag-manager-item");
      const oldTag = row?.dataset.tag;
      if (!oldTag) return;

      const rawNewTag = prompt("Rename tag", oldTag);
      if (rawNewTag === null) return;
      const newTag = normalizeTag(rawNewTag);

      if (!newTag || newTag === oldTag) return;
      if (availableTags.includes(newTag)) {
        alert("That tag already exists.");
        return;
      }

      await renameTagEverywhere(oldTag, newTag);
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
