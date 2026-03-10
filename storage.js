(() => {
  const TAGS_STORAGE_KEY = "__siteNotesTags__";
  const DATA_VERSION_KEY = "__siteNotesDataVersion__";
  const CURRENT_DATA_VERSION = 1;

  function createAnchorLinkId() {
    return `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeNoteHostname(note, fallbackHostname = "") {
    if (fallbackHostname) return fallbackHostname;
    try {
      return new URL(note?.url || "").hostname;
    } catch {
      return "";
    }
  }

  function matchesNoteIdentity(candidate, identity) {
    if (!candidate || !identity) return false;
    return candidate.url === identity.url && candidate.createdAt === identity.createdAt;
  }

  async function getBucket(hostname) {
    if (!hostname) return [];
    const data = await chrome.storage.local.get(hostname);
    return Array.isArray(data[hostname]) ? data[hostname] : [];
  }

  async function setBucket(hostname, notes) {
    if (!hostname) return;
    await chrome.storage.local.set({ [hostname]: notes });
  }

  async function getAllNotes() {
    const data = await chrome.storage.local.get(null);
    return Object.entries(data)
      .filter(([key, value]) => key !== TAGS_STORAGE_KEY && Array.isArray(value))
      .flatMap(([, value]) => value)
      .filter((note) => note && typeof note === "object" && note.url && note.content);
  }

  async function saveNote(note, hostname = "") {
    const resolvedHostname = normalizeNoteHostname(note, hostname);
    if (!resolvedHostname || !note) {
      return { saved: false };
    }

    const notes = await getBucket(resolvedHostname);
    notes.push(note);
    await setBucket(resolvedHostname, notes);

    return { saved: true, hostname: resolvedHostname, notes };
  }

  async function updateNote(noteIdentity, updateFn) {
    const hostname = normalizeNoteHostname(noteIdentity);
    if (!hostname || typeof updateFn !== "function") {
      return { updated: false, reason: "invalid-input" };
    }

    const notes = await getBucket(hostname);
    const noteIndex = notes.findIndex((note) => matchesNoteIdentity(note, noteIdentity));
    if (noteIndex === -1) {
      return { updated: false, reason: "not-found", hostname, notes };
    }

    const previous = notes[noteIndex];
    const next = updateFn({ ...previous });
    if (!next) {
      return { updated: false, reason: "no-change", hostname, notes };
    }

    notes[noteIndex] = next;
    await setBucket(hostname, notes);

    return {
      updated: true,
      hostname,
      notes,
      noteIndex,
      previous,
      note: next,
      reason: "updated",
    };
  }

  async function deleteNote(noteIdentity) {
    const hostname = normalizeNoteHostname(noteIdentity);
    if (!hostname) {
      return { deleted: false };
    }

    const notes = await getBucket(hostname);
    const noteIndex = notes.findIndex((note) => matchesNoteIdentity(note, noteIdentity));
    if (noteIndex === -1) {
      return { deleted: false, hostname, notes };
    }

    const [deletedNote] = notes.splice(noteIndex, 1);
    await setBucket(hostname, notes);

    return {
      deleted: true,
      hostname,
      notes,
      noteIndex,
      note: deletedNote,
    };
  }

  async function insertNote(hostname, note, insertIndex) {
    if (!hostname || !note) {
      return { inserted: false };
    }

    const notes = await getBucket(hostname);
    const index = Number.isInteger(insertIndex)
      ? Math.max(0, Math.min(insertIndex, notes.length))
      : notes.length;
    notes.splice(index, 0, note);
    await setBucket(hostname, notes);

    return { inserted: true, hostname, notes, noteIndex: index, note };
  }

  async function rewriteTags(mapTagFn) {
    if (typeof mapTagFn !== "function") {
      return { rewritten: false };
    }

    const data = await chrome.storage.local.get(null);
    const updates = {};

    const storedCatalog = Array.isArray(data[TAGS_STORAGE_KEY]) ? data[TAGS_STORAGE_KEY] : [];
    const rewrittenCatalog = Array.from(
      new Set(
        storedCatalog
          .map((tag) => String(tag || "").trim())
          .map((tag) => mapTagFn(tag))
          .map((tag) => String(tag || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    updates[TAGS_STORAGE_KEY] = rewrittenCatalog;

    Object.entries(data).forEach(([key, value]) => {
      if (key === TAGS_STORAGE_KEY || !Array.isArray(value)) return;

      let changedInBucket = false;
      const updatedNotes = value.map((note) => {
        const currentTags = Array.isArray(note?.tags)
          ? note.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
          : [];

        const mapped = currentTags
          .map((tag) => mapTagFn(tag))
          .map((tag) => String(tag || "").trim())
          .filter(Boolean);

        const deduped = Array.from(new Set(mapped));
        const changed =
          deduped.length !== currentTags.length ||
          deduped.some((value, idx) => value !== currentTags[idx]);

        if (!changed) return note;

        changedInBucket = true;
        return {
          ...note,
          tags: deduped,
          modifiedAt: new Date().toISOString(),
        };
      });

      if (changedInBucket) {
        updates[key] = updatedNotes;
      }
    });

    await chrome.storage.local.set(updates);
    return { rewritten: true, updates };
  }

  function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return Array.from(
      new Set(
        tags
          .map((tag) => String(tag || "").trim())
          .filter(Boolean)
      )
    );
  }

  function normalizeAnchor(anchor) {
    if (!anchor || typeof anchor !== "object") return null;
    if (!anchor.exact || typeof anchor.exact !== "string") return null;

    const path = Array.isArray(anchor.textNodePath)
      ? anchor.textNodePath.filter((idx) => Number.isInteger(idx) && idx >= 0)
      : null;
    const startOffset = Number.isInteger(anchor.startOffset) ? anchor.startOffset : null;
    const endOffset = Number.isInteger(anchor.endOffset) ? anchor.endOffset : null;

    return {
      type: anchor.type || "text-quote",
      exact: anchor.exact,
      prefix: typeof anchor.prefix === "string" ? anchor.prefix : "",
      suffix: typeof anchor.suffix === "string" ? anchor.suffix : "",
      textNodePath: path && path.length ? path : undefined,
      startOffset: startOffset !== null ? startOffset : undefined,
      endOffset: endOffset !== null ? endOffset : undefined,
      capturedAt: anchor.capturedAt || new Date().toISOString(),
    };
  }

  function normalizeLinkedAnchors(links) {
    if (!Array.isArray(links)) return [];
    return links
      .map((entry) => {
        if (!entry || typeof entry !== "object" || !entry.url) return null;
        return {
          id: entry.id || createAnchorLinkId(),
          url: entry.url,
          attachedFrom: typeof entry.attachedFrom === "string" ? entry.attachedFrom : undefined,
          anchor: normalizeAnchor(entry.anchor),
          createdAt: entry.createdAt || new Date().toISOString(),
          linkType: entry.linkType || undefined,
        };
      })
      .filter(Boolean);
  }

  function migrateNoteToV1(note) {
    if (!note || typeof note !== "object" || !note.url || !note.content) {
      return null;
    }

    const createdAt = note.createdAt || new Date().toISOString();
    const linkedAnchors = normalizeLinkedAnchors(note.linkedAnchors);
    return {
      ...note,
      createdAt,
      modifiedAt: note.modifiedAt || createdAt,
      tags: normalizeTags(note.tags),
      anchor: normalizeAnchor(note.anchor),
      linkedAnchors,
    };
  }

  function migrateDataToV1(data) {
    const updates = {};

    Object.entries(data).forEach(([key, value]) => {
      if (key === TAGS_STORAGE_KEY || key === DATA_VERSION_KEY) return;
      if (!Array.isArray(value)) return;

      updates[key] = value
        .map((note) => migrateNoteToV1(note))
        .filter(Boolean);
    });

    updates[TAGS_STORAGE_KEY] = normalizeTags(data[TAGS_STORAGE_KEY]);
    updates[DATA_VERSION_KEY] = 1;
    return updates;
  }

  async function ensureDataVersion() {
    const data = await chrome.storage.local.get(null);
    const currentVersion = Number(data[DATA_VERSION_KEY] || 0);

    if (currentVersion >= CURRENT_DATA_VERSION) {
      return { migrated: false, from: currentVersion, to: currentVersion };
    }

    let updates = null;
    if (currentVersion < 1) {
      updates = migrateDataToV1(data);
    }

    if (!updates) {
      return { migrated: false, from: currentVersion, to: currentVersion };
    }

    await chrome.storage.local.set(updates);
    return { migrated: true, from: currentVersion, to: CURRENT_DATA_VERSION };
  }

  async function getDataVersion() {
    const data = await chrome.storage.local.get(DATA_VERSION_KEY);
    return Number(data[DATA_VERSION_KEY] || 0);
  }

  globalThis.SiteNotesStorage = {
    getDataVersion,
    ensureDataVersion,
    getAllNotes,
    saveNote,
    updateNote,
    deleteNote,
    insertNote,
    rewriteTags,
  };
})();
