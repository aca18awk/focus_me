console.log(
  "Blocker Script Injected. Listening for commands and SPA navigates."
);

const PLAY_BUTTON_SELECTOR = "button.ytp-play-button.ytp-button";
const OVERLAY_ID = "mindfulness-blocker-overlay";

// --- 1. SPA Navigation Listener ---
// YouTube is a Single Page App. "yt-navigate-finish" is the custom event
// that fires every time a new "page" (video) loads within the same tab.
document.addEventListener("yt-navigate-finish", () => {
  console.log("SPA Navigation detected (yt-navigate-finish).");

  // 1. Immediately run unblockVideo() to remove any *old* overlay
  //    from the previous video. This fixes the "persisting overlay" bug.
  unblockVideo();

  // 2. Re-run the handshake to check the status of the *new* video page.
  runHandshake();
});

// --- 2. Initial Page Load Handshake ---
// This runs ONCE when the script is first injected (e.g., a full F5 refresh)
runHandshake();

setInterval(runHandshake, 5000); // 5000ms = 5 seconds

// --- 3. The "Listener" ---
// Listens for *live* commands from the background (e.g., alarm just fired)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "blockVideo") {
    blockVideo();
    sendResponse({ success: true });
  } else if (message.action === "unblockVideo") {
    unblockVideo();
    sendResponse({ success: true });
  }
});

// --- 4. NEW: Handshake Function ---
// We wrap the handshake in a function so we can call it on load AND on navigate.
function runHandshake() {
  console.log("Running handshake (checkMyStatus)...");
  chrome.runtime.sendMessage({ action: "checkMyStatus" }, (response) => {
    if (chrome.runtime.lastError) {
      // This can happen if the background script is reloading.
      // The handshake will just run again on the next navigation.
      console.warn(
        "Handshake failed (background reloading?):",
        chrome.runtime.lastError.message
      );
      return;
    }

    if (response && response.action === "blockVideo") {
      blockVideo();
    } else if (response && response.action === "unblockVideo") {
      // This is the normal state, we don't need to do anything
      // because the 'yt-navigate-finish' listener *already* cleared the overlay.
      console.log("Handshake response: unblockVideo (Page is clean).");
    }
  });
}

// --- 5. The "Block" Function ---
function blockVideo() {
  console.log("BlockVideo command received. Blocking video.");
  // ... (rest of this function is unchanged) ...

  const videoPlayer = document.querySelector(".html5-video-player");
  if (!videoPlayer) return;

  // A. Find and disable the play button
  const playButton = videoPlayer.querySelector(PLAY_BUTTON_SELECTOR);
  if (playButton) {
    const isPlaying =
      playButton.getAttribute("data-title-no-tooltip") === "Pause";
    if (isPlaying) {
      playButton.click();
    }
    playButton.disabled = true;
    console.log("Play button disabled.");
  }

  // B. Add the overlay (if it doesn't exist)
  if (document.getElementById(OVERLAY_ID)) return;
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div class="blocker-text">
      Time limit reached for this category.
      <br>
      This video is blocked for the rest of the day.
    </div>
  `;
  videoPlayer.appendChild(overlay);
  console.log("Blocker overlay added.");
}

// --- 6. The "Unblock" Function ---
function unblockVideo() {
  console.log("UnblockVideo command received. Unblocking video.");

  // ... (rest of this function is unchanged) ...
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.remove();
    console.log("Blocker overlay removed.");
  }

  // B. Find and re-enable the play button
  const playButton = document.querySelector(PLAY_BUTTON_SELECTOR);
  if (playButton) {
    playButton.disabled = false;
    console.log("Play button enabled.");
  }
}
