// At the top of background.js
let activeTimers = {};

const MIN_TO_MS = 60 * 1000;

const limitsInMs = {
  trash: 10 * MIN_TO_MS,
  interesting: 30 * MIN_TO_MS,
  curriculum: 60 * MIN_TO_MS,
  phd: 9999 * MIN_TO_MS,
};

// 1. LISTENER FOR POPUP MESSAGES
// This is what STARTS a timer
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startTimer") {
    const tabId = message.tabId;
    if (activeTimers[tabId]) {
      console.log(`Timer for tab ${tabId} is already running.`);
      return;
    }

    // NEW: When we start a new timer, pause all others
    Object.keys(activeTimers).forEach((id) => pauseTimer(parseInt(id)));

    activeTimers[tabId] = {
      category: message.category,
      totalTimeMs: 0,
      startTime: Date.now(),
    };

    chrome.action.setBadgeText({ tabId: tabId, text: "" });

    console.log(`Timer started for tab ${tabId}:`, activeTimers[tabId]);
    console.log("All active timers:", activeTimers);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (activeTimers[tabId]) {
    console.log(`Tab ${tabId} was closed. Stopping timer.`);
    stopTimerAndSave(tabId);
  }
});

// 3. LISTENER FOR URL CHANGES
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // We only care if the URL changed and this is a tab we are timing
  if (changeInfo.url && activeTimers[tabId]) {
    // The URL changed. Check if it's still a YouTube video page.
    stopTimerAndSave(tabId);

    if (changeInfo.url.includes("youtube.com/watch")) {
      // 2. Set a badge to remind the user to categorize the *new* video.
      console.log(`Setting badge for tab ${tabId} to '!'`);
      chrome.action.setBadgeText({ tabId: tabId, text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#FF0000" }); // Red
    } else {
      // It's no longer a video page (e.g., homepage, channel page)
      console.log(`Tab ${tabId} navigated away from video. Stopping timer.`);
      stopTimerAndSave(tabId);

      chrome.action.setBadgeText({ tabId: tabId, text: "" });
    }
  }
});

// 4. LISTENER FOR TAB ACTIVATION (Your "pause/resume" logic)
chrome.tabs.onActivated.addListener((activeInfo) => {
  const newActiveTabId = activeInfo.tabId;

  // Loop through all our active timers
  Object.keys(activeTimers).forEach((tabIdStr) => {
    const tabId = parseInt(tabIdStr);

    if (tabId === newActiveTabId) {
      // This is the tab we just switched TO. Resume its timer.
      resumeTimer(tabId);
    } else {
      // This is a tab we just switched AWAY from. Pause its timer.
      pauseTimer(tabId);
    }
  });
});

/**
 * NEW Helper function to PAUSE a timer.
 */
function pauseTimer(tabId) {
  const timerData = activeTimers[tabId];
  // Check if timer exists AND is currently running
  if (timerData && timerData.startTime) {
    const durationMs = Date.now() - timerData.startTime;
    timerData.totalTimeMs += durationMs;
    timerData.startTime = null; // Set to null to indicate "paused"
    console.log(
      `Paused timer for tab ${tabId}. Total so far: ${timerData.totalTimeMs}ms`
    );
  }
}

/**
 * NEW Helper function to RESUME a timer.
 */
function resumeTimer(tabId) {
  const timerData = activeTimers[tabId];
  // Check if timer exists AND is currently paused
  if (timerData && timerData.startTime === null) {
    timerData.startTime = Date.now(); // Restart the session clock
    console.log(`Resumed timer for tab ${tabId}.`);
  }
}

/**
 * UPDATED Helper function to stop a timer, save its duration to storage,
 * and remove it from the activeTimers object.
 */
async function stopTimerAndSave(tabId) {
  // 1. First, pause the timer one last time to capture any final duration
  pauseTimer(tabId);

  const timerData = activeTimers[tabId];
  if (!timerData) return; // Safety check

  // 2. Get the total duration and category
  const totalDurationMs = timerData.totalTimeMs;
  const category = timerData.category;

  // 3. Don't save if no time was spent (e.g., immediate close)
  if (totalDurationMs === 0) {
    console.log(`Tab ${tabId} closed with no duration. Deleting timer.`);
    delete activeTimers[tabId];
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  const storageData = await chrome.storage.local.get(today);

  const todaysStats = storageData[today] || {
    trash: 0,
    interesting: 0,
    curriculum: 0,
    phd: 0,
  };

  // 6. Add the new *total* duration to the correct category
  todaysStats[category] += totalDurationMs;

  await chrome.storage.local.set({ [today]: todaysStats });

  console.log(`Saved ${totalDurationMs}ms to category ${category} for today.`);
  console.log("Today's total stats:", todaysStats);

  delete activeTimers[tabId];
  console.log("Active timers remaining:", activeTimers);
}
