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
### 1. 📝 Contextual Note-Taking
- Save notes per exact page URL (with special handling for YouTube video URLs).
- Switch between Page Notes, Domain Notes, and All Notes.

### 2. ✍️ Basic Markdown Notes
- Write notes in plain markdown while editing.
- Read mode renders basic rich text: links, bold, italic, inline code, paragraphs, and line breaks.
- Add-note modal includes a compact markdown quick help for headings, lists, and links.
- Paste rich copied webpage content directly into note editors and it is converted to markdown.

### 3. 🔗 Link-Friendly Reading
- Markdown links like `[title](https://example.com)` are clickable.
- Plain URLs are auto-linked in rendered notes.

### 4. 🏷️ Advanced Tag Management (Gmail-style)
- Add tags while creating or editing notes.
- Choose existing tags from a picker.
- Create nested tags using `/` (for example `work/project`).
- Manage tags globally: create, edit (rename + change parent), and delete.
- Renaming/deleting propagates across all notes and nested children.

### 5. 🔍 Search and Filtering
- Search by note text and tags.
- Quickly find notes in the current page/domain or across all notes.

### 6. 📌 Text Anchors (Selection-Aware Notes)
- Create notes attached to selected text on a page.
- Notes include anchor metadata and show selected text snippets in the side panel.
- If DOM/content changes and anchor text is missing later, notes gracefully fall back to page-level behavior.

### 7. 🌐 In-Page Highlights and Tooltips
- Anchored text is highlighted directly on the page.
- Hovering highlighted text shows a rich tooltip preview of the note (including markdown rendering).

### 8. 🧷 Attach Existing Notes Anywhere
- Attach an existing note to the current page.
- Optionally attach it to currently selected text through an explicit attach modal.
- Linked notes show "Attached from ..." context in the side panel for better traceability.

### 9. 🖱️ Smart Click Behavior for Anchors
- If an anchored note contains links, clicking highlighted anchor text opens the first note link in a new tab.
- Existing native page links are respected and not overridden.

### 10. ⚙️ Data and Privacy
- All data is stored locally with `chrome.storage.local`.
- Import/export backups and reset all data from Settings.
- Works offline; no external backend required.
- Storage schema versioning and automatic migration keep older local data compatible.

### 11. ⌨️ Keyboard Shortcuts
- `Ctrl/Cmd + Enter`: Save note while Add Note modal is open.
- `Esc`: Close the active modal.
- `/`: Focus the search input when not typing in a field.

## Files
### Core Components
- `manifest.json`: The configuration file that defines the extension’s permissions, background scripts, and metadata.
- `background.js`: The background script managing extension logic.
- `sidepanel.html`: The user interface for the extension’s side panel.
- `sidepanel.js`: Core side panel logic for notes, tags, markdown rendering, anchors, and modals.
- `storage.js`: Shared storage service for note CRUD and tag rewrite operations.
- `contentScript.js`: In-page anchor highlighting, rich tooltip rendering, and click behavior for anchored notes.

### Assets
- `icon16.png`: 16x16 icon for the extension.
- `icon32.png`: 32x32 icon for the extension.
- `icon192.png`: 192x192 icon for high-resolution displays.

### Development Metadata
- `.git`: Git version control directory (if applicable).

## Installation

1. Clone the repository or download it as a ZIP file.
   ```bash
   git clone https://github.com/your-username/site-notes.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`.

3. Enable **Developer mode** (toggle in the top-right corner).

4. Click **Load unpacked** and select the extracted folder.

5. The extension will appear in your toolbar, ready to use!

## Usage
1. Select text on a page (optional), then open the side panel and create a note.
2. Add tags by typing or selecting existing tags.
3. Use markdown in note content for links and basic formatting.
4. Manage tags in Settings -> Manage Tags (including nested tags and parent changes).
5. Attach existing notes to the current page or selected text using the attach action.
6. Revisit pages to see anchored highlights and tooltips on matching text.
7. Use keyboard shortcuts for faster navigation and note capture.

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

