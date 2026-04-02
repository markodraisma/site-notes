<div align="center">
 <h1> <img src="https://lh3.googleusercontent.com/sdKiamsmN579AClKr5yPVE4LLLvg8adDOwTcog_f7ddRxkMsSEa9OjggLsAxPrzOy7YPJXdLSRV52r238DpLdDTQIA=s60" width="80px"><br/>SiteNotes</h1>
 <a href="https://www.buymeacoffee.com/VishwaGauravIn" target="_blank"><img alt="" src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=flat&logo=buy-me-a-coffee&logoColor=black" style="vertical-align:center" /></a>
 <img src="https://img.shields.io/npm/v/npm?style=normal"/>
 <img src="https://img.shields.io/badge/License-AGPL%20v3-brightgreen?style=normal"/>
 <img src="https://img.shields.io/github/languages/code-size/VishwaGauravIn/site-notes?logo=github&style=normal"/>
</div>
<br/>

## Overview
The **Site Notes Chrome Extension** is a lightweight tool designed to enhance your browsing experience by enabling you to attach quick notes to websites directly within the browser. Whether you're conducting research, taking quick reminders, or organizing your online workflow, this extension is your go-to solution.

### [🔗 Download Link](https://chromewebstore.google.com/detail/ejadohapkjcpjhlemdjmpnlhjponfomd)

## Features
### 1. 📝 Context-Aware Notes
- Save notes per exact page URL, with special handling for YouTube video pages.
- Switch between **Page Notes**, **Domain Notes**, and **All Notes**.
- Keep notes tied to the browsing context where they matter most.

### 2. ✍️ Markdown Editing and Smart Paste
- Write notes in markdown while editing.
- Read mode renders headings, lists, tables, links, images, inline code, and paragraphs.
- Paste webpage content as markdown or plain text from the editor context menu.
- Optionally prepend a source-page link when pasting copied content.
- `Ctrl/Cmd+Z` works for normal typing and paste-insert actions.

### 3. 🏷️ Tagging and Bulk Tag Workflows
- Add tags while creating or editing notes.
- Pick from existing labels or create nested tags like `work/project`.
- Manage tags globally: create, rename, re-parent, and delete.
- Apply **bulk add/remove tag changes** to the current result set.

### 4. 🔎 Advanced Search and Filtering
- Search in **All**, **Text**, or **Tags** mode.
- Use boolean operators: `AND`, `OR`, `NOT`, and parentheses.
- Use fielded search like `tag:research` or `text:invoice`.
- Filter within the current page/domain/all-notes view.

### 5. 📌 Anchors, Highlights, and Attachments
- Create notes from selected text on a page.
- Show anchor metadata and selected snippets in the side panel.
- Highlight anchored text directly on the page and show rich hover tooltips.
- Attach existing notes to the current page or a current text selection.
- Re-anchor or unlink anchors when a page has changed.

### 6. 📤 Export, Import, and Restore
- Export from the main panel for **this site**, **this domain**, **current results**, or **all notes**.
- Import/restore from **Settings** using **Merge**, **Replace**, or **Dry run** mode.
- Reset all local data with a backup snapshot saved first.
- All data stays local in `chrome.storage.local` and works offline.

### 7. ❓ In-App Help and Shortcuts
- Open a built-in **Help** dialog from the side panel for usage guidance.
- `Ctrl/Cmd + Enter`: Save note while Add Note modal is open.
- `Esc`: Close the active modal.
- `/`: Focus the search input when not typing in a field.

## Files
### Core Components
- `manifest.json`: The configuration file that defines the extension’s permissions, background scripts, and metadata.
- `background.js`: The background script managing extension logic.
- `sidepanel.html`: The user interface for the extension’s side panel.
- `sidepanel.js`: Core side panel logic for notes, tags, search, bulk actions, export/import, and modals.
- `markdown.js`: Shared markdown rendering and HTML-to-markdown conversion helpers.
- `storage.js`: Shared storage service for note CRUD and tag rewrite operations.
- `contentScript.js`: In-page anchor highlighting, rich tooltip rendering, and click behavior for anchored notes.
- `HELP.md`: In-app usage guide rendered inside the extension’s Help modal.

### Assets
- `icon16.png`: 16x16 icon for the extension.
- `icon32.png`: 32x32 icon for the extension.
- `icon192.png`: 192x192 icon for high-resolution displays.

### Development Metadata
- `.git`: Git version control directory (if applicable).

## Installation

1. Clone the repository or download it as a ZIP file.
   ```bash
   git clone https://github.com/VishwaGauravIn/site-notes.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`.

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **Load unpacked** and select the extracted folder.

5. The extension will appear in your toolbar, ready to use!

## Usage
1. Open the side panel on any page and create a note for the current page or text selection.
2. Add tags by typing them directly or selecting from the suggestion list.
3. Switch between **Page Notes**, **Domain Notes**, and **All Notes** depending on what you want to review.
4. Use markdown for structure and links, or paste copied page content as markdown.
5. Search with plain terms or advanced queries such as `tag:research AND text:browser`.
6. Use **Bulk Tags** to add or remove tags on the currently visible results.
7. Use **Export** from the main panel for the current site, domain, results, or the entire note collection.
8. Open **Settings** when you need to import/restore notes, change privacy options, or manage tags globally.
9. Open **Help** in the extension for a focused quick-reference guide.

## Development
### Prerequisites
- Node.js and npm (for advanced development or adding dependencies).
- Git (for version control).

### Building
This extension is designed to work out of the box. If you want to modify the code:
1. Edit the `background.js` or `sidepanel.js` as required.
2. Reload the extension in `chrome://extensions/` to test your changes.

### Contribution
Feel free to fork the repository, create a new branch, and submit a pull request with your improvements.

## License
This project is licensed under the AGPL-3.0 - see the [LICENSE](LICENSE) file for details.

## Author
Developed by [VishwaGauravIn](https://itsvg.in).

