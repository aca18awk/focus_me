// --- CONSTANTS ---
const MIN_TO_MS = 60 * 1000;
const limitsInMs = {
  trash: 0.5 * MIN_TO_MS,
  interesting: 30 * MIN_TO_MS,
  curriculum: 60 * MIN_TO_MS,
  phd: 9999 * MIN_TO_MS,
};
// --- STORAGE KEYS ---
const TODAY_KEY_CHECK = "lastRunDate";
const NOTIFICATIONS_KEY = "notificationsSentToday";
const ACTIVE_TIMERS_KEY = "activeTimers"; // NEW: Key for persistent timers

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
    checkLimitsAndNotify();
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
// Note: The whole listener function is now ASYNC
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
    // We wrap this in an async IIFE to use await
    (async () => {
      const tabId = message.tabId;
      if (!tabId) {
        console.error("Message did not contain a tabId.");
        return;
      }

      const activeTimers = await getActiveTimers();
      if (activeTimers[tabId]) {
        console.log(`Timer for tab ${tabId} is already running.`);
        return;
      }

      // Pause all other timers
      await pauseAllTimers(tabId); // This function is now async

      activeTimers[tabId] = {
        category: message.category,
        totalTimeMs: 0,
        startTime: Date.now(),
      };

      await saveActiveTimers(activeTimers); // SAVE TO STORAGE

      chrome.action.setBadgeText({ tabId: tabId, text: "" });
      console.log(`Timer started for tab ${tabId}:`, activeTimers[tabId]);
      sendResponse({ success: true });
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

// --- NOTIFICATION FUNCTIONS (Updated to use new helpers) ---

async function checkLimitsAndNotify() {
  const today = new Date().toISOString().split("T")[0];
  const storageKeys = [TODAY_KEY_CHECK, NOTIFICATIONS_KEY];
  const storageData = await chrome.storage.local.get(storageKeys);

  let notificationsSentToday = storageData[NOTIFICATIONS_KEY] || {};

  if (storageData[TODAY_KEY_CHECK] !== today) {
    await chrome.storage.local.set({
      [TODAY_KEY_CHECK]: today,
      [NOTIFICATIONS_KEY]: {},
    });
    notificationsSentToday = {};
    console.log("It's a new day! Resetting notification flags.");
  }

  const totalStats = await getTodaysTotalStats();
  let notificationsUpdated = false;

  for (const category in limitsInMs) {
    const timeSpent = totalStats[category];
    const timeLimit = limitsInMs[category];

    if (timeSpent >= timeLimit && !notificationsSentToday[category]) {
      notificationsSentToday[category] = true;
      notificationsUpdated = true;

      console.log(`Sending notification for category: ${category}`);
      chrome.notifications.create(`limit-${category}`, {
        type: "basic",
        iconUrl: "hello_extensions.png",
        title: "YouTube Mindfulness",
        message: `You've reached your ${
          limitsInMs[category] / MIN_TO_MS
        } min limit for the "${category}" category today.`,
        priority: 2,
      });
    }
  }

  if (notificationsUpdated) {
    await chrome.storage.local.set({
      [NOTIFICATIONS_KEY]: notificationsSentToday,
    });
    console.log("Updated notification flags in storage.");
  }
}

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
