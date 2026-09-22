const DAY_MS = 24 * 60 * 60 * 1000;
const AGE_SETTINGS_KEY = "wlSorterAgeFilter";

function setSortingState(isSorting) {
  for (const id of ["sortBtn", "smartSortBtn", "recentSortBtn"]) {
    const button = document.getElementById(id);
    if (button) button.disabled = isSorting;
  }
}

function localDateString(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readAgeSettings() {
  return {
    mode: document.querySelector("input[name='ageMode']:checked")?.value || "days",
    days: Math.max(1, Number(document.getElementById("ageDays").value) || 7),
    date: document.getElementById("ageDate").value
  };
}

function loadAgeSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(AGE_SETTINGS_KEY)) || {};
  } catch {
    saved = {};
  }

  const mode = saved.mode === "date" ? "date" : "days";
  document.querySelector(`input[name='ageMode'][value='${mode}']`).checked = true;
  document.getElementById("ageDays").value = saved.days || 7;
  document.getElementById("ageDate").value = saved.date || localDateString(new Date(Date.now() - 7 * DAY_MS));
}

function saveAgeSettings() {
  try {
    localStorage.setItem(AGE_SETTINGS_KEY, JSON.stringify(readAgeSettings()));
  } catch {
    // Settings are a convenience; sorting works without them.
  }
}

// Upload timestamp (ms) a video must be at or after to count as recent.
function recentCutoff() {
  const { mode, days, date } = readAgeSettings();
  if (mode === "date" && date) {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day).getTime();
  }
  return Date.now() - days * DAY_MS;
}

function setStatus(message) {
  document.getElementById("status").innerText = message;
}

function setPlan(plan, sortType) {
  const el = document.getElementById("plan");
  if (!plan || !plan.totalVideos) {
    el.innerText = "Plan: no loaded videos found. Scroll the playlist and retry.";
    return;
  }

  const label = { smart: "Smart", recent: "Recent to Top" }[sortType] || "Strict";
  let warning = plan.zeroDurationCount === plan.totalVideos
    ? " Durations were not detected; reload/scroll the playlist."
    : "";
  let recentInfo = "";
  if (sortType === "recent") {
    recentInfo = ` ${plan.recentCount} recent videos.`;
    warning = plan.unknownDateCount === plan.totalVideos
      ? " Upload dates were not detected; reload/scroll the playlist."
      : plan.unknownDateCount
        ? ` ${plan.unknownDateCount} without readable upload date stay in place.`
        : "";
  }
  el.innerText = `${label} fastest plan: ${plan.movesRequired} moves (${plan.topMoves} top, ${plan.bottomMoves} bottom). Keep ${plan.backboneSize}/${plan.totalVideos} in place.${recentInfo}${warning}`;
}

async function activeWatchLaterTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("youtube.com/playlist") || !tab.url.includes("list=WL")) return null;
  return tab;
}

function isMissingContentScriptError(error) {
  return /receiving end does not exist|could not establish connection/i.test(error?.message || "");
}

async function sendToContent(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!isMissingContentScriptError(error)) throw error;

    setStatus("Loading sorter into this YouTube tab...");
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

async function analyze(sortType = "strict") {
  const tab = await activeWatchLaterTab();
  if (!tab) {
    setPlan(null, sortType);
    setStatus("Open YouTube Watch Later first.");
    return;
  }

  try {
    const response = await sendToContent(tab, {
      action: "ANALYZE_WATCH_LATER",
      sortType,
      cutoff: recentCutoff()
    });
    setPlan(response?.plan, sortType);
    setStatus("Ready");
  } catch (e) {
    setPlan(null, sortType);
    setStatus(`Refresh the YouTube tab and retry. ${e.message}`);
  }
}

async function initiateSort(sortType) {
  const tab = await activeWatchLaterTab();

  if (!tab) {
    setStatus("Open YouTube Watch Later first.");
    return;
  }

  setSortingState(true);
  setStatus("Sorting...");

  try {
    const response = await sendToContent(tab, {
      action: "SORT_WATCH_LATER",
      sortType,
      cutoff: recentCutoff()
    });

    if (!response) setStatus("Refresh the YouTube tab and try again.");
  } catch (e) {
    setStatus(`Error: ${e.message}`);
    setSortingState(false);
    console.error(e);
  }
}

document.getElementById("sortBtn").addEventListener("click", () => initiateSort("strict"));
document.getElementById("smartSortBtn").addEventListener("click", () => initiateSort("smart"));
document.getElementById("recentSortBtn").addEventListener("click", () => initiateSort("recent"));

for (const el of document.querySelectorAll("input[name='ageMode'], #ageDays, #ageDate")) {
  el.addEventListener("change", () => {
    saveAgeSettings();
    analyze("recent");
  });
}

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "UPDATE_PLAN") {
    setPlan(request.plan, request.sortType);
    return;
  }

  if (request.action === "UPDATE_STATUS") {
    setStatus(request.message);
    if (request.completed) {
      setSortingState(false);
      document.getElementById("sortBtn").innerText = "Strict Sort (All) \u2191";
      document.getElementById("smartSortBtn").innerText = "Smart Sort (New Only) \u2191";
      document.getElementById("recentSortBtn").innerText = "Recent to Top \u2191";
    }
  }
});

loadAgeSettings();
analyze("strict");
