// --- IMPORT SHARED FILES ---
try {
  importScripts("llm.js");
} catch (e) {
  console.error(e);
}

// --- CONSTANTS ---
const MIN_TO_MS = 60 * 1000;
const TODAY_KEY_CHECK = "lastRunDate";
const ACTIVE_TIMERS_KEY = "activeTimers";
const SETTINGS_KEY = "userSettings"; // From settings.js

// --- Settings Cache ---
let userSettings = {
  limits: {},
  limitsInMs: {},
  keywords: {},
};

const DEFAULT_LIMITS = {
  trash: 0.5,
  interesting: 30,
  curriculum: 60,
  phd: 9999,
};

// --- INITIALIZATION ---
async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const savedSettings = data[SETTINGS_KEY] || {};

  userSettings.limits = savedSettings.limits || DEFAULT_LIMITS;
  userSettings.keywords = savedSettings.keywords || { curriculum: [], phd: [] };

  userSettings.limitsInMs = {};
  for (const category in userSettings.limits) {
    userSettings.limitsInMs[category] =
      userSettings.limits[category] * MIN_TO_MS;
  }
  console.log("Settings loaded:", userSettings);
}

async function ensureSettingsLoaded() {
  if (!userSettings.limitsInMs.trash) await loadSettings();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("checkLimits", {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
  loadSettings();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("checkLimits", {
    delayInMinutes: 1,
    periodInMinutes: 1,
  });
  loadSettings();
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes[SETTINGS_KEY]) loadSettings();
});

// --- CORE TIMER LOGIC ---

async function attemptStartTimer(tabId, category) {
  await ensureSettingsLoaded();

  const totalStats = await getTodaysTotalStats();
  const timeSpent = totalStats[category];
  const timeLimit = userSettings.limitsInMs[category];

  if (timeSpent >= timeLimit) {
    console.log(`Category "${category}" over limit. Blocking tab ${tabId}.`);
    const activeTimers = await getActiveTimers();
    activeTimers[tabId] = {
      category: category,
      totalTimeMs: 0,
      startTime: null,
    };
    await saveActiveTimers(activeTimers);
    chrome.tabs.sendMessage(tabId, { action: "blockVideo" });
    return { success: true, blocked: true };
  }

  const activeTimers = await getActiveTimers();

  // Pause others first (Single Tasking Mode)
  await pauseAllTimers(tabId);

  activeTimers[tabId] = {
    category: category,
    totalTimeMs: 0,
    startTime: Date.now(),
  };

  await saveActiveTimers(activeTimers);
  chrome.action.setBadgeText({ tabId: tabId, text: "" });
  console.log(`Timer started for tab ${tabId} [${category}]`);
  return { success: true, blocked: false };
}

// --- AUTO-CATEGORIZATION LOGIC ---

async function tryAutoCategorize(tabId) {
  console.log(`🤖 Auto-categorizing Tab ${tabId}...`);
  await new Promise((r) => setTimeout(r, 1500));

  try {
    const title = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(
        tabId,
        { action: "requestTitleFromTab" },
        (response) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(response?.title);
        }
      );
    });

    if (!title || title === "YouTube") {
      console.log("Title not ready yet, skipping auto-cat.");
      return;
    }

    console.log("Video Title:", title);

    const category = await callGemini(title);
    const validCategories = ["trash", "interesting", "curriculum", "phd"];

    if (category && validCategories.includes(category)) {
      console.log(`AI Decided: ${category}`);
      await attemptStartTimer(tabId, category);
    } else {
      console.warn("AI returned invalid category:", category);
    }
  } catch (err) {
    console.warn("Auto-categorization failed (tab closed or busy):", err);
  }
}

// --- EVENT LISTENERS ---

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && changeInfo.url.includes("youtube.com/watch")) {
    const activeTimers = await getActiveTimers();

    if (activeTimers[tabId]) {
      await stopTimerAndSave(tabId);
    }

    chrome.action.setBadgeText({ tabId: tabId, text: "?" });
    chrome.action.setBadgeBackgroundColor({ color: "#FFA500" });

    tryAutoCategorize(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // A. START TIMER
  if (message.action === "startTimer") {
    (async () => {
      const result = await attemptStartTimer(message.tabId, message.category);
      sendResponse(result);
    })();
    return true;
  }

  // B. LIVE STATS
  if (message.action === "getLiveStats") {
    (async () => {
      await ensureSettingsLoaded();
      const totalStats = await getTodaysTotalStats();
      sendResponse({ stats: totalStats, limits: userSettings.limits });
    })();
    return true;
  }

  // C. CHECK STATUS
  if (message.action === "checkMyStatus") {
    const tabId = sender.tab.id;
    (async () => {
      await ensureSettingsLoaded();
      const activeTimers = await getActiveTimers();
      const timer = activeTimers[tabId];

      if (!timer) {
        sendResponse({ action: "unblockVideo" });
        return;
      }

      const totalStats = await getTodaysTotalStats();
      if (
        totalStats[timer.category] >= userSettings.limitsInMs[timer.category]
      ) {
        await pauseTimer(tabId);
        sendResponse({ action: "blockVideo" });
      } else {
        sendResponse({ action: "unblockVideo" });
      }
    })();
    return true;
  }

  // D. TAB STATUS
  if (message.action === "getTabStatus") {
    (async () => {
      const activeTimers = await getActiveTimers();
      sendResponse({ category: activeTimers[message.tabId]?.category || null });
    })();
    return true;
  }
});

// --- TAB CLEANUP ---
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const activeTimers = await getActiveTimers();
  if (activeTimers[tabId]) await stopTimerAndSave(tabId);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const newActiveTabId = activeInfo.tabId;
  const activeTimers = await getActiveTimers();
  const timerPromises = Object.keys(activeTimers).map((tabIdStr) => {
    const tabId = parseInt(tabIdStr);
    if (tabId === newActiveTabId) {
      return resumeTimer(tabId);
    } else {
      return pauseTimer(tabId);
    }
  });
  await Promise.all(timerPromises);
});

// --- HELPER FUNCTIONS ---
async function getActiveTimers() {
  const data = await chrome.storage.local.get(ACTIVE_TIMERS_KEY);
  return data[ACTIVE_TIMERS_KEY] || {};
}

async function saveActiveTimers(timers) {
  await chrome.storage.local.set({ [ACTIVE_TIMERS_KEY]: timers });
}

async function pauseTimer(tabId) {
  const activeTimers = await getActiveTimers();
  const timerData = activeTimers[tabId];
  if (timerData && timerData.startTime) {
    timerData.totalTimeMs += Date.now() - timerData.startTime;
    timerData.startTime = null;
    await saveActiveTimers(activeTimers);
    console.log(`Paused timer for tab ${tabId} (Inactive Tab)`);
  }
}

async function pauseAllTimers(exceptTabId = null) {
  const activeTimers = await getActiveTimers();
  let wasModified = false;
  for (const tabIdStr in activeTimers) {
    const tabId = parseInt(tabIdStr);
    if (tabId === exceptTabId) continue;
    const timerData = activeTimers[tabId];
    if (timerData && timerData.startTime) {
      timerData.totalTimeMs += Date.now() - timerData.startTime;
      timerData.startTime = null;
      wasModified = true;
    }
  }
  if (wasModified) await saveActiveTimers(activeTimers);
}

async function resumeTimer(tabId) {
  const activeTimers = await getActiveTimers();
  const timerData = activeTimers[tabId];
  if (timerData && timerData.startTime === null) {
    await ensureSettingsLoaded();
    const totalStats = await getTodaysTotalStats();
    if (
      totalStats[timerData.category] >=
      userSettings.limitsInMs[timerData.category]
    ) {
      chrome.tabs.sendMessage(tabId, { action: "blockVideo" });
      return;
    }
    timerData.startTime = Date.now();
    await saveActiveTimers(activeTimers);
    console.log(`Resumed timer for tab ${tabId} (Tab Activated)`);
  }
}

async function stopTimerAndSave(tabId) {
  const activeTimers = await getActiveTimers();
  const timerData = activeTimers[tabId];
  if (!timerData) return;

  if (timerData.startTime) {
    timerData.totalTimeMs += Date.now() - timerData.startTime;
  }

  if (timerData.totalTimeMs > 0) {
    const category = timerData.category;
    const today = new Date().toISOString().split("T")[0];
    const storageData = await chrome.storage.local.get(today);
    const todaysStats = storageData[today] || {
      trash: 0,
      interesting: 0,
      curriculum: 0,
      phd: 0,
    };
    todaysStats[category] += timerData.totalTimeMs;
    await chrome.storage.local.set({ [today]: todaysStats });
  }

  delete activeTimers[tabId];
  await saveActiveTimers(activeTimers);
}

async function getTodaysTotalStats() {
  const today = new Date().toISOString().split("T")[0];
  const storageData = await chrome.storage.local.get(today);
  const savedStats = storageData[today] || {
    trash: 0,
    interesting: 0,
    curriculum: 0,
    phd: 0,
  };
  const activeTimers = await getActiveTimers();
  const liveStats = { trash: 0, interesting: 0, curriculum: 0, phd: 0 };

  for (const tabId in activeTimers) {
    const timer = activeTimers[tabId];
    let currentTotalMs = timer.totalTimeMs;
    if (timer.startTime) currentTotalMs += Date.now() - timer.startTime;
    liveStats[timer.category] += currentTotalMs;
  }

  const totalStats = { trash: 0, interesting: 0, curriculum: 0, phd: 0 };
  for (const category in savedStats) {
    totalStats[category] = savedStats[category] + liveStats[category];
  }
  return totalStats;
}

// --- ALARM & MIDNIGHT RESET ---
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkLimits") {
    (async () => {
      await ensureSettingsLoaded();
      await handleNewDayCheck();
      proactivelyCheckLimits();
    })();
  }
});

async function handleNewDayCheck() {
  const today = new Date().toISOString().split("T")[0];
  const data = await chrome.storage.local.get([
    TODAY_KEY_CHECK,
    ACTIVE_TIMERS_KEY,
  ]);
  const lastRunDate = data[TODAY_KEY_CHECK];
  const activeTimers = data[ACTIVE_TIMERS_KEY] || {};

  if (lastRunDate !== today) {
    console.log(`🌞 New Day! Resetting stats.`);
    if (lastRunDate) {
      const yesterdayData = await chrome.storage.local.get(lastRunDate);
      const yesterdayStats = yesterdayData[lastRunDate] || {
        trash: 0,
        interesting: 0,
        curriculum: 0,
        phd: 0,
      };
      let dirty = false;
      for (const tabId in activeTimers) {
        if (activeTimers[tabId].totalTimeMs > 0) {
          yesterdayStats[activeTimers[tabId].category] +=
            activeTimers[tabId].totalTimeMs;
          dirty = true;
        }
        activeTimers[tabId].totalTimeMs = 0;
        if (activeTimers[tabId].startTime)
          activeTimers[tabId].startTime = Date.now();
      }
      if (dirty)
        await chrome.storage.local.set({ [lastRunDate]: yesterdayStats });
    } else {
      for (const tabId in activeTimers) activeTimers[tabId].totalTimeMs = 0;
    }
    await chrome.storage.local.set({
      [TODAY_KEY_CHECK]: today,
      [ACTIVE_TIMERS_KEY]: activeTimers,
    });
  }
}

async function proactivelyCheckLimits() {
  const totalStats = await getTodaysTotalStats();
  const activeTimers = await getActiveTimers();
  const limitsInMs = userSettings.limitsInMs;

  for (const tabIdStr in activeTimers) {
    const tabId = parseInt(tabIdStr);
    const timer = activeTimers[tabId];
    if (totalStats[timer.category] >= limitsInMs[timer.category]) {
      console.log(`Alarm: Blocking tab ${tabId}`);
      await pauseTimer(tabId);
      chrome.tabs.sendMessage(tabId, { action: "blockVideo" });
    }
  }
}
