// --- CONSTANTS ---
const MIN_TO_MS = 60 * 1000;
// --- STORAGE KEYS ---
const TODAY_KEY_CHECK = "lastRunDate";
const ACTIVE_TIMERS_KEY = "activeTimers";
const SETTINGS_KEY = "userSettings"; // From settings.js

// --- Settings Cache ---
let userSettings = {
  limits: {}, // in minutes
  limitsInMs: {}, // in milliseconds
  keywords: {},
};

const DEFAULT_LIMITS = {
  trash: 0.5,
  interesting: 30,
  curriculum: 60,
  phd: 9999,
};

// --- Function to load settings ---
async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const savedSettings = data[SETTINGS_KEY] || {};

  userSettings.limits = savedSettings.limits || DEFAULT_LIMITS;
  userSettings.keywords = savedSettings.keywords || {
    curriculum: [],
    phd: [],
  };

  // Convert limits to milliseconds for internal use
  userSettings.limitsInMs = {};
  for (const category in userSettings.limits) {
    userSettings.limitsInMs[category] =
      userSettings.limits[category] * MIN_TO_MS;
  }
  console.log("Settings loaded and cache updated:", userSettings);
}

// --- NEW: Gatekeeper function for Service Worker wakeup ---
/**
 * Ensures settings are loaded, especially after service worker wakeup.
 */
async function ensureSettingsLoaded() {
  if (!userSettings.limitsInMs.trash) {
    console.log("Service worker woke up or settings empty. Reloading...");
    await loadSettings();
  }
}

// --- ALARM CREATION & Load settings on start ---
chrome.runtime.onInstalled.addListener(() => {
  createStatCheckAlarm();
  loadSettings(); // Load settings on install
  console.log("Alarm created on install.");
});

chrome.runtime.onStartup.addListener(() => {
  createStatCheckAlarm();
  loadSettings(); // Load settings on startup
  console.log("Alarm created on startup.");
});

// --- Listen for settings changes ---
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes[SETTINGS_KEY]) {
    console.log("Storage changed! Reloading settings cache...");
    loadSettings();
  }
});

function createStatCheckAlarm() {
  chrome.alarms.create("checkLimits", {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
}

// --- ALARM LISTENER ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkLimits") {
    console.log("Alarm fired: Checking time limits and for new day.");
    // We MUST ensure settings are loaded before running alarm logic
    (async () => {
      await ensureSettingsLoaded();
      // 1. Check if it's a new day
      resetFlagsOnNewDay();
      // 2. Proactively check all limits and block if necessary
      proactivelyCheckLimits();
    })();
  }
});

// --- STORAGE HELPER FUNCTIONS ---
/**
 * Gets the active timers object from storage.
 */
async function getActiveTimers() {
  const data = await chrome.storage.local.get(ACTIVE_TIMERS_KEY);
  return data[ACTIVE_TIMERS_KEY] || {};
}

/**
 * Saves the active timers object to storage.
 */
async function saveActiveTimers(timers) {
  await chrome.storage.local.set({ [ACTIVE_TIMERS_KEY]: timers });
}

// --- MAIN MESSAGE LISTENER ---
// *** THIS IS THE FIX: Removed the stray '.' before '=>' ***
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A. POPUP IS ASKING FOR LIVE STATS
  if (message.action === "getLiveStats") {
    (async () => {
      await ensureSettingsLoaded(); // CLEANUP

      const totalStats = await getTodaysTotalStats();
      sendResponse({
        stats: totalStats,
        limits: userSettings.limits, // Send limits in minutes
      });
    })();
    return true; // Keep message port open for async response
  }

  // B. POPUP IS STARTING A TIMER
  if (message.action === "startTimer") {
    (async () => {
      await ensureSettingsLoaded(); // CLEANUP

      const tabId = message.tabId;
      const category = message.category;
      chrome.action.setBadgeText({ tabId: tabId, text: "" });

      if (!tabId) {
        console.error("Message did not contain a tabId.");
        return;
      }

      // 1. First, check if this category is already over the limit.
      const totalStats = await getTodaysTotalStats();
      const timeSpent = totalStats[category];
      const timeLimit = userSettings.limitsInMs[category]; // Now reliable

      if (timeSpent >= timeLimit) {
        // 2. If OVER limit, just send the block command. Do NOT start a timer.
        console.log(
          `Category "${category}" is already over limit. Blocking tab ${tabId}.`
        );
        // *** NEW FIX from previous bug (ensures tab is tainted) ***
        const activeTimers = await getActiveTimers();
        activeTimers[tabId] = {
          category: category,
          totalTimeMs: 0,
          startTime: null, // Timer is "active" but not running
        };
        await saveActiveTimers(activeTimers);
        // *** END FIX ***

        chrome.tabs.sendMessage(tabId, { action: "blockVideo" }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              `Could not send 'blockVideo' to tab ${tabId} (it may be reloading): ${chrome.runtime.lastError.message}`
            );
          }
        });
        sendResponse({ success: true, blocked: true });
        return;
      }
      // --- END NEW LOGIC ---

      // 3. If NOT over limit, proceed with starting the timer as normal.
      const activeTimers = await getActiveTimers();
      if (activeTimers[tabId]) {
        console.log(`Timer for tab ${tabId} is already running.`);
        sendResponse({ success: false, reason: "Timer already running." });
        return;
      }

      await pauseAllTimers(tabId);

      activeTimers[tabId] = {
        category: category,
        totalTimeMs: 0,
        startTime: Date.now(),
      };

      await saveActiveTimers(activeTimers);

      console.log(`Timer started for tab ${tabId}:`, activeTimers[tabId]);
      sendResponse({ success: true, blocked: false });
    })();
    return true;
  }

  // C. CONTENT SCRIPT "HANDSHAKE"
  if (message.action === "checkMyStatus") {
    const tabId = sender.tab.id;
    if (!tabId) {
      sendResponse({ action: "unblockVideo" }); // No tab, so unblock
      return;
    }

    (async () => {
      await ensureSettingsLoaded(); // CLEANUP

      // 2. Get the timer for this tab
      const activeTimers = await getActiveTimers();
      const timer = activeTimers[tabId];

      // 3. If tab is not categorized, it's not blocked.
      if (!timer) {
        sendResponse({ action: "unblockVideo" });
        return;
      }

      // 4. Tab *is* categorized, so check its stats
      const category = timer.category;
      const totalStats = await getTodaysTotalStats();
      const timeSpent = totalStats[category];
      const timeLimit = userSettings.limitsInMs[category];

      // 5. Respond with the correct action
      if (timeSpent >= timeLimit) {
        // Over limit, tell it to BLOCK
        console.log(
          `checkMyStatus: Tab ${tabId} (${category}) is OVER limit. Sending blockVideo.`
        );
        await pauseTimer(tabId);
        sendResponse({ action: "blockVideo" });
      } else {
        // Under limit, tell it to UNBLOCK
        console.log(
          `checkMyStatus: Tab ${tabId} (${category}) is OK. Sending unblockVideo.`
        );
        sendResponse({ action: "unblockVideo" });
      }
    })();

    return true; // Keep message port open for async response
  }

  // D. POPUP IS ASKING FOR TAB STATUS
  if (message.action === "getTabStatus") {
    (async () => {
      const { tabId } = message;
      if (!tabId) {
        sendResponse({ category: null });
        return;
      }

      const activeTimers = await getActiveTimers();
      const timer = activeTimers[tabId];

      if (timer) {
        sendResponse({ category: timer.category });
      } else {
        sendResponse({ category: null });
      }
    })();
    return true; // Keep message port open for async response
  }
});

// --- TAB EVENT LISTENERS (Now all async) ---

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const activeTimers = await getActiveTimers();
  if (activeTimers[tabId]) {
    console.log(`Tab ${tabId} was closed. Stopping timer.`);
    await stopTimerAndSave(tabId);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const activeTimers = await getActiveTimers();
  if (changeInfo.url) {
    // If it's a new video page, show the "!"
    if (changeInfo.url.includes("youtube.com/watch")) {
      chrome.action.setBadgeText({ tabId: tabId, text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
    }

    // If the tab was being timed, stop the timer
    if (activeTimers[tabId]) {
      await stopTimerAndSave(tabId);
      if (changeInfo.url.includes("youtube.com/watch")) {
        console.log(`Tab ${tabId} navigated to new video. Stopping old timer.`);
      } else {
        console.log(`Tab ${tabId} navigated away. Stopping timer.`);
        chrome.action.setBadgeText({ tabId: tabId, text: "" }); // Clear badge if navigating away from YT
      }
    }
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const newActiveTabId = activeInfo.tabId;
  const activeTimers = await getActiveTimers();

  // We can't use forEach with await, so use Promise.all
  const timerPromises = Object.keys(activeTimers).map((tabIdStr) => {
    const tabId = parseInt(tabIdStr);
    if (tabId === newActiveTabId) {
      return resumeTimer(tabId); // resumeTimer is now async
    } else {
      return pauseTimer(tabId); // pauseTimer is now async
    }
  });
  await Promise.all(timerPromises);
});

// --- HELPER FUNCTIONS (All updated to be async) ---

/**
 * Pauses a specific timer and saves the state.
 */
async function pauseTimer(tabId) {
  const activeTimers = await getActiveTimers();
  const timerData = activeTimers[tabId];

  if (timerData && timerData.startTime) {
    const durationMs = Date.now() - timerData.startTime;
    timerData.totalTimeMs += durationMs;
    timerData.startTime = null;
    console.log(
      `Paused timer for tab ${tabId}. Total so far: ${timerData.totalTimeMs}ms`
    );
    await saveActiveTimers(activeTimers); // SAVE TO STORAGE
  }
}

/**
 * Pauses ALL running timers. Used when starting a new timer.
 */
async function pauseAllTimers(exceptTabId = null) {
  const activeTimers = await getActiveTimers();
  let wasModified = false;

  for (const tabIdStr in activeTimers) {
    const tabId = parseInt(tabIdStr);
    if (tabId === exceptTabId) continue;

    const timerData = activeTimers[tabId];
    if (timerData && timerData.startTime) {
      const durationMs = Date.now() - timerData.startTime;
      timerData.totalTimeMs += durationMs;
      timerData.startTime = null;
      wasModified = true;
    }
  }

  if (wasModified) {
    await saveActiveTimers(activeTimers); // SAVE TO STORAGE
  }
}

/**
 * Resumes a specific timer and saves the state.
 */
async function resumeTimer(tabId) {
  const activeTimers = await getActiveTimers();
  const timerData = activeTimers[tabId];

  if (timerData && timerData.startTime === null) {
    // *** NEW SAFETY CHECK ***
    // Before resuming, check if the category is over limit
    await ensureSettingsLoaded();
    const totalStats = await getTodaysTotalStats();
    const timeSpent = totalStats[timerData.category];
    const timeLimit = userSettings.limitsInMs[timerData.category];

    if (timeSpent >= timeLimit) {
      console.log(
        `Resume denied: Tab ${tabId} category ${timerData.category} is over limit.`
      );
      // Ensure it's blocked
      chrome.tabs.sendMessage(tabId, { action: "blockVideo" });
      return; // Do not resume
    }
    // *** END CHECK ***

    timerData.startTime = Date.now();
    console.log(`Resumed timer for tab ${tabId}.`);
    await saveActiveTimers(activeTimers); // SAVE TO STORAGE
  }
}

/**
 * Stops a timer, saves its duration to *daily stats*, and *removes it* from *active timers*.
 */
async function stopTimerAndSave(tabId) {
  const activeTimers = await getActiveTimers();
  const timerData = activeTimers[tabId];
  if (!timerData) return;

  // Pause one last time to get final duration
  if (timerData.startTime) {
    const durationMs = Date.now() - timerData.startTime;
    timerData.totalTimeMs += durationMs;
    timerData.startTime = null;
  }

  const totalDurationMs = timerData.totalTimeMs;

  // 1. Save to daily stats (if duration > 0)
  if (totalDurationMs > 0) {
    const category = timerData.category;
    const today = new Date().toISOString().split("T")[0];
    const storageData = await chrome.storage.local.get(today);
    const todaysStats = storageData[today] || {
      trash: 0,
      interesting: 0,
      curriculum: 0,
      phd: 0,
    };

    todaysStats[category] += totalDurationMs;
    await chrome.storage.local.set({ [today]: todaysStats });
    console.log(`Saved ${totalDurationMs}ms to category ${category}.`);
  }

  // 2. Remove from active timers list and save the *new* active timers object
  delete activeTimers[tabId];
  await saveActiveTimers(activeTimers); // SAVE TO STORAGE
  console.log("Active timers remaining:", activeTimers);
}

// --- NOTIFICATION/BLOCKING FUNCTIONS ---

/**
 * Checks if it's a new day and resets daily flags.
 */
async function resetFlagsOnNewDay() {
  const today = new Date().toISOString().split("T")[0];
  const storageKeys = [TODAY_KEY_CHECK];
  const allStorage = await chrome.storage.local.get(storageKeys);

  // Check if it's a new day.
  if (allStorage[TODAY_KEY_CHECK] !== today) {
    console.log("It's a new day! Resetting notification flags.");
    await chrome.storage.local.set({
      [TODAY_KEY_CHECK]: today,
    });
  } else {
    // console.log("Still the same day. No reset needed."); // Too noisy
  }
}

/**
 * Called by the 1-minute alarm to proactively block tabs.
 */
async function proactivelyCheckLimits() {
  console.log("Alarm: Proactively checking limits...");
  const totalStats = await getTodaysTotalStats();
  const activeTimers = await getActiveTimers();

  const overLimitCategories = new Set();
  const limitsInMs = userSettings.limitsInMs;

  // Find which categories are over limit
  for (const category in limitsInMs) {
    if (totalStats[category] >= limitsInMs[category]) {
      overLimitCategories.add(category);
    }
  }

  if (overLimitCategories.size === 0) {
    // console.log("Alarm: All categories are within limits."); // Too noisy
    return; // Nothing to do
  }

  console.log("Alarm: Found over-limit categories:", overLimitCategories);

  // Now, find all active timers that belong to those categories
  for (const tabIdStr in activeTimers) {
    const tabId = parseInt(tabIdStr);
    const timer = activeTimers[tabId];

    if (timer && overLimitCategories.has(timer.category)) {
      console.log(
        `Alarm: Blocking tab ${tabId} for category ${timer.category}`
      );
      await pauseTimer(tabId); // Pause the timer

      // Send the block message
      chrome.tabs.sendMessage(tabId, { action: "blockVideo" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(
            `Alarm: Could not send 'blockVideo' to tab ${tabId}: ${chrome.runtime.lastError.message}`
          );
        }
      });
    }
  }
}

/**
 * A central function to get the *total* time spent today (saved + live).
 */
async function getTodaysTotalStats() {
  // 1. Get *SAVED* stats from storage
  const today = new Date().toISOString().split("T")[0];
  const storageData = await chrome.storage.local.get(today);
  const savedStats = storageData[today] || {
    trash: 0,
    interesting: 0,
    curriculum: 0,
    phd: 0,
  };

  // 2. Get *LIVE* stats from the (now persistent) active timers
  const activeTimers = await getActiveTimers();
  const liveStats = { trash: 0, interesting: 0, curriculum: 0, phd: 0 };

  for (const tabId in activeTimers) {
    const timer = activeTimers[tabId];
    let currentTotalMs = timer.totalTimeMs;
    if (timer.startTime) {
      currentTotalMs += Date.now() - timer.startTime;
    }
    liveStats[timer.category] += currentTotalMs;
  }

  // 3. Combine them
  const totalStats = { trash: 0, interesting: 0, curriculum: 0, phd: 0 };
  for (const category in savedStats) {
    totalStats[category] = savedStats[category] + liveStats[category];
  }

  return totalStats;
}
