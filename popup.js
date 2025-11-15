// --- Constants ---
const MIN_TO_MS = 60 * 1000;
const limitsInMinutes = {
  trash: 0.5,
  interesting: 30,
  curriculum: 60,
  phd: 9999,
};

// --- DOM Elements ---
let statusEl, trashEl, interestingEl, curriculumEl, phdEl;
let statUpdateInterval; // To hold our live-update timer

// --- Main Function ---
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Get all DOM elements
  statusEl = document.getElementById("status");
  trashEl = document.getElementById("stats-trash");
  interestingEl = document.getElementById("stats-interesting");
  curriculumEl = document.getElementById("stats-curriculum");
  phdEl = document.getElementById("stats-phd");
  const buttons = document.querySelectorAll(".buttons button");

  // 2. Check Tab URL & Set Status
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const youtubeURL = "youtube.com/watch";
  const isYouTubeVideo = tab.url && tab.url.includes(youtubeURL);

  if (isYouTubeVideo) {
    statusEl.textContent = "Categorize this video:";
    buttons.forEach((btn) => (btn.disabled = false));
  } else {
    statusEl.textContent = "Not on a YouTube video page.";
    buttons.forEach((btn) => (btn.disabled = true));
  }

  // 3. Add Button Listeners
  // Pass the tab.id from our query, as it's more reliable
  addClickListeners(tab.id);

  // 4. Start Live Stats Update
  // First, run it *once* to load the stats immediately
  updateStatsDisplay();

  // Then, set it to run every second while the popup is open
  statUpdateInterval = setInterval(updateStatsDisplay, 1000);
});

// When the popup is closed, clear the interval
window.addEventListener("unload", () => {
  if (statUpdateInterval) {
    clearInterval(statUpdateInterval);
  }
});

// --- Helper Functions ---

/**
 * Asks the background script for the latest stats and updates the HTML.
 */
async function updateStatsDisplay() {
  // Use 'getLiveStats' which now returns the TOTAL (saved + live)
  chrome.runtime.sendMessage({ action: "getLiveStats" }, (totalStats) => {
    // Check if stats were returned (can fail during reloads)
    if (!totalStats) return;

    const msToMins = (ms) => (ms / MIN_TO_MS).toFixed(2);

    trashEl.textContent = `${msToMins(totalStats.trash)} / ${
      limitsInMinutes.trash
    } min`;
    interestingEl.textContent = `${msToMins(totalStats.interesting)} / ${
      limitsInMinutes.interesting
    } min`;
    curriculumEl.textContent = `${msToMins(totalStats.curriculum)} / ${
      limitsInMinutes.curriculum
    } min`;
    phdEl.textContent = `${msToMins(totalStats.phd)} min`;
  });
}

/**
 * Wires up the buttons to send messages and close the popup.
 */
function addClickListeners(tabId) {
  const buttons = [
    { id: "btn-trash", category: "trash" },
    { id: "btn-interesting", category: "interesting" },
    { id: "btn-curriculum", category: "curriculum" },
    { id: "btn-phd", category: "phd" },
  ];

  buttons.forEach((buttonInfo) => {
    document.getElementById(buttonInfo.id).addEventListener("click", () => {
      chrome.runtime.sendMessage(
        {
          action: "startTimer",
          category: buttonInfo.category,
          tabId: tabId,
        },
        () => {
          window.close(); // Close the popup after clicking
        }
      );
    });
  });
}
