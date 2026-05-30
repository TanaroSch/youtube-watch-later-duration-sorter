function setSortingState(isSorting) {
  const sortBtn = document.getElementById("sortBtn");
  const smartSortBtn = document.getElementById("smartSortBtn");
  if (sortBtn) sortBtn.disabled = isSorting;
  if (smartSortBtn) smartSortBtn.disabled = isSorting;
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

  const label = sortType === "smart" ? "Smart" : "Strict";
  const warning = plan.zeroDurationCount === plan.totalVideos
    ? " Durations were not detected; reload/scroll the playlist."
    : "";
  el.innerText = `${label} fastest plan: ${plan.movesRequired} moves (${plan.topMoves} top, ${plan.bottomMoves} bottom). Keep ${plan.backboneSize}/${plan.totalVideos} in place.${warning}`;
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
      sortType
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
      sortType
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

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "UPDATE_PLAN") {
    setPlan(request.plan, request.sortType);
    return;
  }

  if (request.action === "UPDATE_STATUS") {
    setStatus(request.message);
    if (request.completed) {
      setSortingState(false);
      document.getElementById("sortBtn").innerText = "Strict Sort (All) &uarr;";
      document.getElementById("smartSortBtn").innerText = "Smart Sort (New Only) &uarr;";
    }
  }
});

analyze("strict");
