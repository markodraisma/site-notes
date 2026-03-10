# SiteNotes Quick Wins Plan

## Status Legend
- [ ] Not started
- [~] In progress
- [x] Done
- [!] Blocked

## Progress Snapshot
- Priority 1: 4/4 done
- Priority 2: 3/3 done
- Priority 3: 3/3 done
- Overall: 10/10 complete

## Goal
Improve the project with high-ROI changes across features, usability, and maintainability while minimizing regression risk.

## Current Snapshot
- Strong feature baseline: page/domain/all views, markdown, advanced nested tags, text anchors, in-page highlights, tooltip previews, and attach-existing-note flows.
- Main risk area: code growth and duplication (especially markdown/rendering logic across contexts).

## Priority 1: High Impact, Low/Medium Effort

### 1. Shared Markdown Engine [x]
- Category: Maintainability + Consistency
- Why: Markdown parsing is duplicated in `sidepanel.js` and `contentScript.js`.
- Benefit: One source of truth, fewer rendering mismatches.
- Effort: Low-Medium
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Create shared module (for example `markdown.js`) with:
  - [x] `sanitizeUrl`
  - [x] `renderInlineMarkdown`
  - [x] `renderBasicMarkdown`
  - [x] Use it in sidepanel and content script.
  - [x] Keep CSS-specific style concerns in each UI file.
- Acceptance:
  - [x] Same markdown output in sidepanel note cards and in-page tooltip.

### 2. Re-anchor Missing Anchors [x]
- Category: Feature + UX
- Why: Missing-anchor warnings exist, but recovery is manual.
- Benefit: One-click recovery when page content changes.
- Effort: Medium
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Add `Re-anchor` action when anchor state is `missing`.
  - [x] Prompt user to select text and save updated anchor.
- Acceptance:
  - [x] Missing anchor can be fixed from note card without re-creating note.

### 3. Undo for Delete [x]
- Category: Usability
- Why: Deletion is currently immediate and destructive.
- Benefit: Reduces accidental data loss.
- Effort: Low
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Add temporary delete buffer in memory.
  - [x] Show toast with `Undo` for 5-10 seconds.
- Acceptance:
  - [x] Deleted note can be restored within timeout.

### 4. Toast Feedback for Core Actions [x]
- Category: Usability
- Why: Several operations are silent.
- Benefit: Better confidence and perceived responsiveness.
- Effort: Low
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Add lightweight toast component.
  - [x] Trigger for: save, attach, import, export, tag edits, reset (after complete).
- Acceptance:
  - [x] Every major action gives clear success/failure feedback.

## Priority 2: Medium Impact, Low Effort

### 5. Keyboard Shortcuts [x]
- Category: Usability
- Benefit: Faster workflows for power users.
- Effort: Low
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] `Ctrl/Cmd+Enter` save note.
  - [x] `Esc` close active modal.
  - [x] `/` focus search input.
- Acceptance:
  - [x] Shortcuts work reliably in sidepanel and do not conflict with text input intent.

### 6. Markdown Help Hint [x]
- Category: Usability
- Benefit: Improves discoverability of formatting.
- Effort: Low
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Add compact markdown cheat sheet in note modal.
- Acceptance:
  - [x] Users can discover link, heading, and list syntax quickly.

### 7. Attached-From Visibility [x]
- Category: Feature
- Why: `attachedFrom` is stored but not surfaced.
- Benefit: Better context and traceability.
- Effort: Low
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Show "Attached from <url>" in note card footer or metadata area.
- Acceptance:
  - [x] Attached notes clearly show origin.

## Priority 3: Scale and Code Health

### 8. Storage Service Layer [x]
- Category: Maintainability
- Why: Storage operations are spread across many functions.
- Benefit: Easier schema evolution and fewer bugs.
- Effort: Medium
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Introduce storage service module:
  - [x] `getAllNotes`
  - [x] `saveNote`
  - [x] `updateNote`
  - [x] `deleteNote`
  - [x] `rewriteTags`
  - [x] Use service from sidepanel.
- Acceptance:
  - [x] Sidepanel uses service methods, direct storage access reduced.

### 9. Smarter Content Script Re-rendering [x]
- Category: Performance
- Why: Content script rerenders on any local storage change.
- Benefit: Lower CPU churn on active pages.
- Effort: Medium
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Debounce rerenders.
  - [x] Filter changes to only relevant note keys/URLs.
- Acceptance:
  - [x] Fewer redundant rerenders during frequent updates.

### 10. Schema Versioning [x]
- Category: Maintainability
- Why: Feature growth increases migration needs.
- Benefit: Safe future migrations.
- Effort: Medium
- Owner: TBD
- Last updated: 2026-03-10
- Tasks:
  - [x] Add `dataVersion` key.
  - [x] Add migration pipeline for older data formats.
- Acceptance:
  - [x] Older storage can upgrade automatically.

## Suggested Execution Order
1. Shared markdown engine
2. Toast feedback
3. Undo delete
4. Re-anchor action
5. Keyboard shortcuts + markdown hint
6. Attached-from visibility
7. Storage service layer
8. Content script rerender optimization
9. Schema versioning

## Effort Buckets
- 1-hour wins:
  - Toast feedback
  - Keyboard shortcuts
  - Markdown help hint
  - Attached-from visibility
- Half-day wins:
  - Undo delete
  - Re-anchor action (basic flow)
- 1-2 day wins:
  - Shared markdown engine
  - Storage service layer
  - Content script rerender optimization
  - Schema versioning

## Definition of Done
- No diagnostics errors in modified files.
- Existing features remain functional: note CRUD, tag management, anchors, attach flows.
- Updated README reflects any new user-visible behavior.

## Completed Log
- 2026-03-10: Completed #1 Shared Markdown Engine.
- 2026-03-10: Completed #2 Re-anchor Missing Anchors.
- 2026-03-10: Completed #3 Undo for Delete.
- 2026-03-10: Completed #4 Toast Feedback for Core Actions.
- 2026-03-10: Completed #5 Keyboard Shortcuts.
- 2026-03-10: Completed #6 Markdown Help Hint.
- 2026-03-10: Completed #7 Attached-From Visibility.
- 2026-03-10: Completed #8 Storage Service Layer.
- 2026-03-10: Completed #9 Smarter Content Script Re-rendering.
- 2026-03-10: Completed #10 Schema Versioning.
