// --- AI Logic (Standard Fetch for Chrome Extensions) ---
const apiKey = "YOUR KEY";
const SETTINGS_KEY = "userSettings";

const callGemini = async (title) => {
  const result = await chrome.storage.local.get([SETTINGS_KEY]);
  const settings = result[SETTINGS_KEY] || {};
  const keywords = settings.keywords || {
    curriculum: [],
    phd: [],
  };

  const prompt = `System Prompt:

You are a strict video classifier. You must categorize a YouTube video into exactly one of these categories: 'trash', 'interesting', 'curriculum', 'phd'.

trash: Entertainment, gossip, memes, gaming, low-value content.

phd: ${keywords.phd.join(", ")}

curriculum:  ${keywords.curriculum.join(", ")}.

interesting: Anything educational/commentary that doesn't fit the above.

The YouTube title is ${title}.

Reply ONLY with the category name in lowercase.`;

  if (!apiKey) {
    console.warn("Gemini API Key is missing or invalid in popup.js");
    return "Please set your API key in popup.js";
  }

  // *** FIX: Changed URL to use the required model and path structure ***
  const model = "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // Throw an error with the HTTP status for better debugging
      const errorText = await response.text();
      console.error("Gemini Response Error:", errorText);
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();

    // Check if the content part exists
    if (
      data.candidates &&
      data.candidates.length > 0 &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts.length > 0
    ) {
      const content = data.candidates[0].content.parts[0].text;
      return content;
    } else {
      console.error(
        "Gemini Error: No text content returned in response.",
        data
      );
      return "Error: Empty AI response";
    }
  } catch (error) {
    console.error("AI Call Failed:", error);
    return `Error fetching AI response: ${error.message}`;
  }
};
