// --- CONSTANTS ---
const SETTINGS_KEY = "userSettings";
const DEFAULT_LIMITS = {
  trash: 0.5,
  interesting: 30,
  curriculum: 60,
  phd: 9999,
};

// --- DOM Elements ---
let limitInputs, tagContainers, saveButton, tabs, tabPanes;

// --- Main Init ---
document.addEventListener("DOMContentLoaded", () => {
  // Get all elements
  limitInputs = {
    trash: document.getElementById("limit-trash"),
    interesting: document.getElementById("limit-interesting"),
    curriculum: document.getElementById("limit-curriculum"),
    phd: document.getElementById("limit-phd"),
  };
  tagContainers = {
    curriculum: document.getElementById("tags-curriculum"),
    phd: document.getElementById("tags-phd"),
  };
  saveButton = document.getElementById("save-button");
  tabs = document.querySelectorAll(".tab-link");
  tabPanes = document.querySelectorAll(".tab-pane");

  // 1. Initialize functionality
  initTabs();
  initTagInputs();

  // 2. Add listener to the save button
  saveButton.addEventListener("click", saveSettings);

  // 3. Load existing settings from storage
  loadSettings();
});

// --- Tab Switching Logic ---
function initTabs() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      // 1. Deactivate all tabs and panes
      tabs.forEach((t) => t.classList.remove("active"));
      tabPanes.forEach((p) => p.classList.remove("active"));

      // 2. Activate the clicked tab and its corresponding pane
      tab.classList.add("active");
      document.getElementById(tab.dataset.tab).classList.add("active");
    });
  });
}

// --- Tag Input Logic ---
function initTagInputs() {
  for (const category in tagContainers) {
    const container = tagContainers[category];
    const input = container.querySelector(".tag-input");

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const text = input.value.trim();
        if (text) {
          createTagElement(text, category, container);
          input.value = "";
        }
      }
    });
  }
}

/**
 * Creates and inserts a new tag element into the DOM.
 * @param {string} text - The text for the tag.
 * @param {string} category - The category ("curriculum" or "phd").
 * @param {HTMLElement} container - The container to insert into.
 */
function createTagElement(text, category, container) {
  const input = container.querySelector(".tag-input");

  const tagEl = document.createElement("span");
  tagEl.className = "tag-item";
  tagEl.textContent = text;
  // Store text reliably
  tagEl.dataset.text = text; // Store the text in a data attribute

  const closeBtn = document.createElement("button");
  closeBtn.className = "tag-close-btn";
  closeBtn.innerHTML = "&times;";
  closeBtn.addEventListener("click", () => {
    tagEl.remove();
  });

  tagEl.appendChild(closeBtn);
  container.insertBefore(tagEl, input); // Insert the tag *before* the input field
}

/**
 * Reads all tags from a specific container.
 * @param {HTMLElement} container - The tag container.
 * @returns {string[]} An array of tag strings.
 */
function getTags(container) {
  const tags = [];
  container.querySelectorAll(".tag-item").forEach((tagEl) => {
    // Read from the reliable data attribute
    if (tagEl.dataset.text) {
      tags.push(tagEl.dataset.text);
    }
  });
  return tags;
}

// --- Save & Load Logic ---

/**
 * Saves all settings from the UI into chrome.storage.
 */
function saveSettings() {
  // 1. Get limits
  const limits = {};
  for (const category in limitInputs) {
    // Save as a number
    limits[category] = parseFloat(limitInputs[category].value) || 0;
  }

  // 2. Get keywords
  const keywords = {
    curriculum: getTags(tagContainers.curriculum),
    // *** THIS IS THE FIX ***
    phd: getTags(tagContainers.phd),
  };

  // 3. Save to storage
  const settingsToSave = { limits, keywords };
  console.log("Saving settings:", settingsToSave); // DEBUG
  chrome.storage.local.set({ [SETTINGS_KEY]: settingsToSave }, () => {
    console.log("Settings saved successfully."); // DEBUG
    // 4. Show visual feedback
    saveButton.textContent = "Saved!";
    setTimeout(() => {
      saveButton.textContent = "Save Settings";
    }, 2000);
  });
}

/**
 * Loads settings from chrome.storage and populates the UI.
 */
function loadSettings() {
  chrome.storage.local.get([SETTINGS_KEY], (result) => {
    if (chrome.runtime.lastError) {
      console.error("Error loading settings:", chrome.runtime.lastError);
      return;
    }

    console.log("Loaded settings:", result); // DEBUG

    const settings = result[SETTINGS_KEY] || {};
    const limits = settings.limits || DEFAULT_LIMITS;
    const keywords = settings.keywords || {
      curriculum: [],
      phd: [],
    };
    console.log("Applying limits:", limits); // DEBUG
    console.log("Applying keywords:", keywords); // DEBUG

    // 1. Populate time limits
    for (const category in limitInputs) {
      if (limitInputs[category]) {
        limitInputs[category].value = limits[category] || 0;
      }
    }

    // 2. Populate curriculum keywords
    if (keywords.curriculum && tagContainers.curriculum) {
      keywords.curriculum.forEach((tagText) => {
        createTagElement(tagText, "curriculum", tagContainers.curriculum);
      });
    }

    // 3. Populate PhD keywords
    if (keywords.phd && tagContainers.phd) {
      keywords.phd.forEach((tagText) => {
        createTagElement(tagText, "phd", tagContainers.phd);
      });
    }
  });
}
