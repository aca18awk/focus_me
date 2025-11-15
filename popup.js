// Wait for the popup's HTML (hello.html) to finish loading
document.addEventListener("DOMContentLoaded", async () => {
  // --- Task 1: Check Tab URL & Set Status ---
  const statusEl = document.getElementById("status");
  const buttons = document.querySelectorAll(".buttons button");
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

  // --- Task 2: Add Button Listeners ---
  document.getElementById("btn-trash").addEventListener("click", () => {
    chrome.runtime.sendMessage({
      action: "startTimer",
      category: "trash",
      tabId: tab.id,
    });
  });

  document.getElementById("btn-interesting").addEventListener("click", () => {
    chrome.runtime.sendMessage({
      action: "startTimer",
      category: "interesting",
      tabId: tab.id,
    });
  });

  document.getElementById("btn-curriculum").addEventListener("click", () => {
    chrome.runtime.sendMessage({
      action: "startTimer",
      category: "curriculum",
      tabId: tab.id,
    });
  });

  document.getElementById("btn-phd").addEventListener("click", () => {
    chrome.runtime.sendMessage({
      action: "startTimer",
      category: "phd",
      tabId: tab.id,
    });
  });

  // --- Task 3: Fetch Stats from Storage & Display Them ---
  const today = new Date().toISOString().split("T")[0];
  const storageData = await chrome.storage.local.get(today);
  const todaysStats = storageData[today] || {
    trash: 0,
    interesting: 0,
    curriculum: 0,
    phd: 0,
  };

  // Helper function to convert MS to Minutes
  const msToMins = (ms) => Math.floor(ms / 60000);

  // Get the display elements
  const trashEl = document.getElementById("stats-trash");
  const interestingEl = document.getElementById("stats-interesting");
  const curriculumEl = document.getElementById("stats-curriculum");
  const phdEl = document.getElementById("stats-phd");

  // Update their text
  trashEl.textContent = `${msToMins(todaysStats.trash)} / 10 min`;
  interestingEl.textContent = `${msToMins(todaysStats.interesting)} / 30 min`;
  curriculumEl.textContent = `${msToMins(todaysStats.curriculum)} / 60 min`;
  phdEl.textContent = `${msToMins(todaysStats.phd)} min`;
});
