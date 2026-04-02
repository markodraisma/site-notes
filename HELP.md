# SiteNotes Help

## Quick start
1. Open the side panel on the page you want to annotate.
2. Click **+** to create a new note.
3. Type your note in markdown or paste content from the page.
4. Add tags if needed.
5. Save the note with **Save Note** or `Ctrl/Cmd + Enter`.

## Views
Use the buttons at the top to change scope:

- **Page Notes** — only notes for the current page
- **Domain Notes** — notes for the current site/domain
- **All Notes** — your full collection

## Search
The search bar can work in three modes:

- **All** — search text and tags together
- **Text** — search only note content
- **Tags** — search only tags

You can also use advanced search:

- `tag:research AND text:browser`
- `project OR client`
- `(tag:idea OR tag:todo) AND NOT text:draft`

Supported operators:

- `AND`
- `OR`
- `NOT`
- parentheses `()`
- field prefixes `tag:` and `text:`

## Tags
- Type a tag and press `Enter`, `Tab`, or `,` to add it.
- Nested tags are supported, for example `work/project`.
- Open **Settings → Manage Tags** to rename, re-parent, or delete tags globally.

## Bulk tag editing
Use **Bulk Tags** to apply tag changes to the notes currently shown in the list.

You can:
- add one or more tags to all current results
- remove one or more tags from all current results

This works with your current view and current search.

## Anchors and attachments
- If you select text on a page before creating a note, the note can be attached to that selection.
- Anchored text may be highlighted directly on the page.
- Existing notes can also be attached to the current page or selection.

## Export and import
### Export
Use the **Export** button in the main panel to export:
- this site
- this domain
- current results
- all notes

### Import / restore
Open **Settings** to import a JSON backup using:
- **Merge** — safest default
- **Replace** — overwrite the selected scope
- **Dry run** — validate only

## Privacy options
In **Settings** you can also:
- enable privacy mode
- control copy-source context capture
- choose how source links are inserted on paste
- allowlist or denylist specific sites

## Keyboard shortcuts
- `/` — focus search
- `Esc` — close the active modal
- `Ctrl/Cmd + Enter` — save a note while the Add Note modal is open

## Tip
Use **Export current results** together with advanced search to create focused backups, for example all notes matching a project tag or review topic.
