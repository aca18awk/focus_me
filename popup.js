// --- Constants ---
const MIN_TO_MS = 60 * 1000;

// --- DOM Elements ---
let statusEl, trashEl, interestingEl, curriculumEl, phdEl;
let allButtons;
let statUpdateInterval;

// --- Main Function ---
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Get all DOM elements
  statusEl = document.getElementById("status");
  trashEl = document.getElementById("stats-trash");
  interestingEl = document.getElementById("stats-interesting");
  curriculumEl = document.getElementById("stats-curriculum");
  phdEl = document.getElementById("stats-phd");
  allButtons = document.querySelectorAll(".buttons button");

  // 2. Check Tab URL
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const youtubeURL = "youtube.com/watch";
  const isYouTubeVideo = tab.url && tab.url.includes(youtubeURL);

  if (!isYouTubeVideo) {
    statusEl.textContent = "Not on a YouTube video page.";
    allButtons.forEach((btn) => (btn.disabled = true));
    return; // Stop here if not on a video
  }

  // 3. Check if tab is *already* categorized
  // THIS IS THE FIX: We are correctly calling "getTabStatus"
  chrome.runtime.sendMessage(
    { action: "getTabStatus", tabId: tab.id },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Error getting tab status:",
          chrome.runtime.lastError.message
        );
        statusEl.textContent = "Error. Please reload.";
        return;
      }

      if (response && response.category) {
        // --- This tab is ALREADY categorized ---
        statusEl.textContent = "This video is categorized as:";
        showCategorizedUI(response.category);
      } else {
        // --- This tab is NOT categorized ---
        statusEl.textContent = "Categorize this video:";
        addClickListeners(tab.id); // Only add listeners if uncategorized
      }
    }
  );

  // 4. Start Live Stats Update (this runs regardless)
  updateStatsDisplay();
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
 * Updates the stats display
 */
async function updateStatsDisplay() {
  // NEW: The response is now an object { stats, limits }
  chrome.runtime.sendMessage({ action: "getLiveStats" }, (response) => {
    // *** UPDATED: More robust check ***
    if (
      chrome.runtime.lastError ||
      !response ||
      !response.stats ||
      !response.limits
    ) {
      console.warn(
        "Error getting live stats or limits (background script might be waking up):",
        chrome.runtime.lastError
      );
      // Show a loading state to prevent "undefined"
      trashEl.textContent = "Loading...";
      interestingEl.textContent = "Loading...";
      curriculumEl.textContent = "Loading...";
      phdEl.textContent = "Loading...";
      return; // Fail gracefully and wait for next 1-sec update
    }

    const { stats, limits } = response;
    const msToMins = (ms) => (ms / MIN_TO_MS).toFixed(2);

    // *** UPDATED: Read from stats and limits objects ***
    // Add fallback checks for safety
    trashEl.textContent = `${msToMins(stats.trash)} / ${limits.trash || 0} min`;
    interestingEl.textContent = `${msToMins(stats.interesting)} / ${
      limits.interesting || 0
    } min`;
    curriculumEl.textContent = `${msToMins(stats.curriculum)} / ${
      limits.curriculum || 0
    } min`;
    phdEl.textContent = `${msToMins(stats.phd)} min`;
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

/**
 * Disables buttons and shows the already-selected category.
 */
function showCategorizedUI(category) {
  const categoryToEmoji = {
    trash: "🗑️",
    interesting: "💡",
    curriculum: "🎓",
    phd: "🔬",
  };

  // Update the status message to be more specific
  statusEl.textContent = `Categorized as: ${categoryToEmoji[category] || ""}`;

  allButtons.forEach((btn) => {
    btn.disabled = true; // Disable all buttons

    // Add a special class to the selected button
    if (btn.id === `btn-${category}`) {
      btn.classList.add("selected");
    } else {
      btn.classList.remove("selected");
    }
  });
}
