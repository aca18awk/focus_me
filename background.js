// --- CONSTANTS ---
const MIN_TO_MS = 60 * 1000;
const limitsInMs = {
  trash: 0.5 * MIN_TO_MS, // Test limit
  interesting: 30 * MIN_TO_MS,
  curriculum: 60 * MIN_TO_MS,
  phd: 9999 * MIN_TO_MS,
};
// --- STORAGE KEYS ---
const TODAY_KEY_CHECK = "lastRunDate";
const ACTIVE_TIMERS_KEY = "activeTimers";
const NOTIFICATIONS_KEY = "notificationsSentToday"; // We need this back for the "new day" logic

// --- ALARM CREATION ---
chrome.runtime.onInstalled.addListener(() => {
  createStatCheckAlarm();
  console.log("Alarm created on install.");
});

chrome.runtime.onStartup.addListener(() => {
  createStatCheckAlarm();
  console.log("Alarm created on startup.");
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
    console.log("Alarm fired: Checking time limits.");
    resetStatsOnNewDay();
  }
});

// --- NEW STORAGE HELPER FUNCTIONS ---
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A. POPUP IS ASKING FOR LIVE STATS
  if (message.action === "getLiveStats") {
    getTodaysTotalStats().then((totalStats) => {
      sendResponse(totalStats);
    });
    return true; // Keep message port open for async response
  }

  // B. POPUP IS STARTING A TIMER
  if (message.action === "startTimer") {
    (async () => {
      const tabId = message.tabId;
      const category = message.category;
      if (!tabId) {
        console.error("Message did not contain a tabId.");
        return;
      }

      // 1. First, check if this category is already over the limit.
      const totalStats = await getTodaysTotalStats();
      const timeSpent = totalStats[category];
      const timeLimit = limitsInMs[category];

      if (timeSpent >= timeLimit) {
        // 2. If OVER limit, just send the block command. Do NOT start a timer.
        console.log(
          `Category "${category}" is already over limit. Blocking tab ${tabId}.`
        );
        // Send block message and handle potential error
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

      chrome.action.setBadgeText({ tabId: tabId, text: "" });
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
      const activeTimers = await getActiveTimers();
      const timer = activeTimers[tabId];

      // If tab is not categorized, it shouldn't be blocked.
      if (!timer) {
        sendResponse({ action: "unblockVideo" });
        return;
      }

      // Tab is categorized, so let's check its stats
      const category = timer.category;
      const totalStats = await getTodaysTotalStats();
      const timeSpent = totalStats[category];
      const timeLimit = limitsInMs[category];

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
  if (changeInfo.url && activeTimers[tabId]) {
    if (changeInfo.url.includes("youtube.com/watch")) {
      console.log(`Tab ${tabId} navigated to new video. Stopping old timer.`);
      await stopTimerAndSave(tabId);

      chrome.action.setBadgeText({ tabId: tabId, text: "!" });
      chrome.action.setBadgeBackgroundColor({ color: "#FF0000" });
    } else {
      console.log(`Tab ${tabId} navigated away. Stopping timer.`);
      await stopTimerAndSave(tabId);
      chrome.action.setBadgeText({ tabId: tabId, text: "" });
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
 * This function is called by the 1-minute alarm.
 * Its *only* job is to check if it's a new day and reset stats.
 * All blocking logic has been removed because blocker.js now polls.
 * *** THIS IS THE UPDATED/SIMPLIFIED VERSION ***
 */
async function resetStatsOnNewDay() {
  const today = new Date().toISOString().split("T")[0];
  const allStorage = await chrome.storage.local.get(null); // Get everything

  // Check if it's a new day.
  if (allStorage[TODAY_KEY_CHECK] !== today) {
    console.log("It's a new day! Resetting all daily stats.");

    const keysToRemove = [];
    // Find all old stat keys (YYYY-MM-DD format)
    for (const key in allStorage) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
        keysToRemove.push(key);
      }
    }

    // Also remove the notification key from yesterday (if it exists)
    if (allStorage[NOTIFICATIONS_KEY]) {
      keysToRemove.push(NOTIFICATIONS_KEY);
    }

    // Perform the removal
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log("Removed old daily stats:", keysToRemove);
    }

    // Set the new date marker
    await chrome.storage.local.set({ [TODAY_KEY_CHECK]: today });
  } else {
    console.log("Still the same day. No reset needed.");
  }

  // NO MORE "check limits" or "send message" logic here. It's all
  // handled by the blocker.js polling 'checkMyStatus'.
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
