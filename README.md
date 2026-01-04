# Personal Data Tracker - Chrome Extension

This is a custom Chrome Extension built to track and log data from specific websites. It allows for local testing and data collection directly within the browser.

## 🚀 Running This Extension (Developer Mode)

1. **Clone/Download** this repository to a folder on your computer.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Toggle **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing these files.
5. The extension icon should appear in your toolbar. Pin it for easy access!

---

## 📂 File Structure & Responsibilities

Here is a high-level overview of the codebase and how the components interact.

### `manifest.json`

**The Blueprint.**
This is the configuration file that tells Chrome everything about the extension.

- **Identity:** Defines the name, version, and description.
- **Permissions:** Lists what the extension is allowed to do (e.g., `storage` to save data, `activeTab` to read the current site).
- **Registration:** Tells Chrome which scripts to run in the background and which to run on the web page.

### `popup.html`

**The Interface.**
This is the standard HTML file that defines the visual layout of the small window that appears when you click the extension icon.

- Contains the buttons (e.g., "Start Tracking", "Export") and display areas for the data.

### `popup.js`

**The UI Logic.**
This script handles the interactivity of the `popup.html`.

- **Event Listeners:** It listens for clicks on your buttons.
- **Communication:** It sends messages to the Content Script to request data.
- **Storage Retrieval:** It pulls saved data from Chrome's local storage to display it to the user.
- _Note: This script only runs while the popup window is actually open._

### `content.js`

**The Scraper (The "Eyes").**
This script is injected directly into the web page you are viewing.

- **DOM Access:** It can read and manipulate the HTML of the website (finding specific text, prices, or elements).
- **Extraction:** It grabs the specific data points defined in your logic.
- **Messaging:** It sends the extracted data back to the popup or saves it to storage.

### `background.js` (Service Worker)

**The Event Manager.**
This script runs in the background, independent of the web page or the popup.

- **Lifecycle Management:** It handles events like extension installation or browser startup.
- **Persistent Logic:** Useful for logic that needs to run even if the popup is closed (though in simple trackers, much of the work can often be done in `content.js`).

---

## 🛠 How it Works (Data Flow)

1. **Trigger:** User opens the Popup and clicks "Track".
2. **Action:** `popup.js` sends a signal to the active tab.
3. **Extraction:** `content.js` receives the signal, scans the page DOM, and finds the target data.
4. **Storage:** The data is saved to `chrome.storage.local`.
5. **Display:** `popup.js` detects the storage change (or receives a response) and updates the HTML to show the tracked count/data.
