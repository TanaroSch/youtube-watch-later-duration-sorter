(() => {
if (globalThis.__WL_SORTER_CONTENT_LOADED__) {
  return;
}
globalThis.__WL_SORTER_CONTENT_LOADED__ = true;

// YouTube Watch Later Sorter - menu based persistent reorder.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ACTION_LABELS = {
  top: [
    "move to top",
    "move to the top",
    "an den anfang verschieben",
    "an den playlistanfang verschieben",
    "an erste stelle verschieben",
    "nach ganz oben verschieben",
    "ganz nach oben",
    "nach oben verschieben"
  ],
  bottom: [
    "move to bottom",
    "move to the bottom",
    "ans ende verschieben",
    "an das ende verschieben",
    "an letzte stelle verschieben",
    "nach ganz unten verschieben",
    "ganz nach unten",
    "nach unten verschieben"
  ]
};

function normalizeText(value) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseDuration(timeStr) {
  if (!timeStr) return 0;
  if (timeStr.toUpperCase().includes("SHORT")) return 60;

  const parts = timeStr.replace(/\s+/g, "").split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function sendStatus(message, completed = false) {
  chrome.runtime.sendMessage({
    action: "UPDATE_STATUS",
    message,
    completed
  });
  console.log(`[WL Sorter] ${message}`);
}

function sendPlan(plan, sortType) {
  chrome.runtime.sendMessage({
    action: "UPDATE_PLAN",
    sortType,
    plan: summarizePlan(plan)
  });
}

function summarizePlan(plan) {
  return {
    totalVideos: plan.totalVideos,
    backboneSize: plan.maxLen,
    movesRequired: plan.movesRequired,
    topMoves: plan.topMoves,
    bottomMoves: plan.bottomMoves,
    zeroDurationCount: plan.zeroDurationCount
  };
}

function getVideoIdFromHref(href) {
  if (!href) return null;
  try {
    return new URLSearchParams(new URL(href, window.location.href).search).get("v");
  } catch {
    return null;
  }
}

function getVideoRows() {
  return Array.from(document.querySelectorAll("ytd-playlist-video-renderer"));
}

function pickDurationText(...values) {
  for (const value of values) {
    const text = (value || "").replace(/\s+/g, " ").trim();
    const match = text.match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/);
    if (match) return match[0];
    if (/short/i.test(text)) return "SHORT";
  }
  return "0:00";
}

function extractDurationText(item) {
  const overlays = Array.from(
    item.querySelectorAll("ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer")
  );
  const overlayTexts = overlays.flatMap((el) => [
    el.getAttribute("aria-label"),
    el.textContent,
    el.innerText
  ]);
  const labelledTexts = Array.from(item.querySelectorAll("[aria-label]")).flatMap((el) => [
    el.getAttribute("aria-label"),
    el.textContent,
    el.innerText
  ]);

  return pickDurationText(...overlayTexts, ...labelledTexts, item.textContent);
}

function collectVideos() {
  const seenVideoIds = new Map();

  return getVideoRows()
    .map((item, index) => {
      const titleEl = item.querySelector("#video-title");
      const title = titleEl?.title || titleEl?.textContent?.trim() || "Unknown";
      const durationStr = extractDurationText(item);
      const videoId = getVideoIdFromHref(titleEl?.getAttribute("href") || titleEl?.href);
      const duplicateIndex = seenVideoIds.get(videoId) || 0;
      seenVideoIds.set(videoId, duplicateIndex + 1);

      return {
        title,
        videoId,
        key: `${videoId}:${duplicateIndex}`,
        originalIndex: index,
        durationStr,
        duration: parseDuration(durationStr)
      };
    })
    .filter((video) => video.videoId);
}

function buildTargetOrder(videos, sortType) {
  if (sortType !== "smart") {
    return [...videos].sort((a, b) => a.duration - b.duration);
  }

  let maxDuration = -1;
  let splitIndex = -1;

  for (let i = 0; i < videos.length; i++) {
    if (videos[i].duration >= maxDuration) {
      maxDuration = videos[i].duration;
      splitIndex = i;
    }
  }

  const oldVideos = videos.slice(0, splitIndex + 1);
  const newVideos = videos.slice(splitIndex + 1).sort((a, b) => a.duration - b.duration);
  const targetOrder = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldVideos.length || newIndex < newVideos.length) {
    if (oldIndex >= oldVideos.length) {
      targetOrder.push(newVideos[newIndex++]);
    } else if (newIndex >= newVideos.length) {
      targetOrder.push(oldVideos[oldIndex++]);
    } else if (newVideos[newIndex].duration < oldVideos[oldIndex].duration) {
      targetOrder.push(newVideos[newIndex++]);
    } else {
      targetOrder.push(oldVideos[oldIndex++]);
    }
  }

  return targetOrder;
}

function findBackbone(videos, sortedVideos) {
  const currentIdToIndex = new Map();
  videos.forEach((video, index) => currentIdToIndex.set(video.key, index));

  const sortedIndicesInCurrent = sortedVideos.map((video) => currentIdToIndex.get(video.key));
  let maxLen = 0;
  let bestStart = 0;
  let bestEnd = -1;
  let currentStart = 0;

  for (let i = 0; i < sortedIndicesInCurrent.length; i++) {
    if (i > 0 && sortedIndicesInCurrent[i] <= sortedIndicesInCurrent[i - 1]) {
      const len = i - currentStart;
      if (isBetterBackbone(len, currentStart, i - 1, maxLen, bestStart, bestEnd, sortedVideos.length)) {
        maxLen = len;
        bestStart = currentStart;
        bestEnd = i - 1;
      }
      currentStart = i;
    }
  }

  const finalLen = sortedIndicesInCurrent.length - currentStart;
  if (isBetterBackbone(finalLen, currentStart, sortedIndicesInCurrent.length - 1, maxLen, bestStart, bestEnd, sortedVideos.length)) {
    maxLen = sortedIndicesInCurrent.length - currentStart;
    bestStart = currentStart;
    bestEnd = sortedIndicesInCurrent.length - 1;
  }

  return { maxLen, bestStart, bestEnd };
}

function isBetterBackbone(len, start, end, bestLen, bestStart, bestEnd, total) {
  if (len > bestLen) return true;
  if (len < bestLen) return false;

  // Same move count: prefer fewer top moves. This keeps the older behavior of
  // preserving the earliest possible already-correct block.
  const topMoves = start;
  const bestTopMoves = bestStart;
  if (topMoves !== bestTopMoves) return topMoves < bestTopMoves;

  const bottomMoves = total - end - 1;
  const bestBottomMoves = total - bestEnd - 1;
  return bottomMoves < bestBottomMoves;
}

function createSortPlan(sortType) {
  const videos = collectVideos();
  if (videos.length === 0) {
    return { videos, sortedVideos: [], totalVideos: 0, maxLen: 0, bestStart: 0, bestEnd: -1, movesRequired: 0, topMoves: 0, bottomMoves: 0, zeroDurationCount: 0 };
  }

  const sortedVideos = buildTargetOrder(videos, sortType);
  const { maxLen, bestStart, bestEnd } = findBackbone(videos, sortedVideos);
  const topMoves = bestStart;
  const bottomMoves = sortedVideos.length - bestEnd - 1;
  const zeroDurationCount = videos.filter((video) => video.duration === 0).length;

  return {
    videos,
    sortedVideos,
    totalVideos: sortedVideos.length,
    maxLen,
    bestStart,
    bestEnd,
    movesRequired: sortedVideos.length - maxLen,
    topMoves,
    bottomMoves,
    zeroDurationCount
  };
}

function findVideoRenderer(video) {
  const links = Array.from(
    document.querySelectorAll(`ytd-playlist-video-renderer a[href*="${CSS.escape(video.videoId)}"]`)
  );
  return links[0]?.closest("ytd-playlist-video-renderer") || null;
}

function findMenuButton(renderer) {
  return (
    renderer.querySelector("#menu button[aria-label]") ||
    renderer.querySelector("#button button[aria-label]") ||
    renderer.querySelector("button.dropdown-trigger") ||
    renderer.querySelector("#menu button") ||
    renderer.querySelector("yt-icon-button button")
  );
}

function visibleMenuItems() {
  const selectors = [
    "ytd-menu-service-item-renderer",
    "ytd-menu-navigation-item-renderer",
    "tp-yt-paper-item",
    "yt-list-item-view-model",
    "[role='menuitem']"
  ];

  return Array.from(document.querySelectorAll(selectors.join(","))).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function findActionButton(actionKey) {
  const labels = ACTION_LABELS[actionKey];
  const items = visibleMenuItems();

  return items.find((el) => {
    const text = normalizeText(`${el.textContent || ""} ${el.getAttribute("aria-label") || ""}`);
    return labels.some((label) => text.includes(label));
  });
}

async function closeOpenMenu() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.body.click();
  await sleep(250);
}

async function moveVideo(video, actionKey) {
  const renderer = findVideoRenderer(video);
  if (!renderer) {
    console.warn("DOM item lost:", video.title);
    return false;
  }

  const menuBtn = findMenuButton(renderer);
  if (!menuBtn) {
    console.warn("Menu button not found for:", video.title);
    return false;
  }

  menuBtn.click();
  await sleep(700);

  const actionBtn = findActionButton(actionKey);
  if (!actionBtn) {
    const available = visibleMenuItems()
      .map((el) => normalizeText(el.textContent))
      .filter(Boolean);
    console.warn(`Move action '${actionKey}' not found for:`, video.title, available);
    await closeOpenMenu();
    return false;
  }

  actionBtn.click();
  await sleep(1500);
  return true;
}

async function sortWatchLater(sortType) {
  sendStatus("Starting scrape...");

  const plan = createSortPlan(sortType);
  if (plan.videos.length === 0) {
    sendStatus("No videos found. Scroll down and retry.", true);
    return;
  }

  sendPlan(plan, sortType);
  if (sortType === "smart") {
    sendStatus("Smart Sort: preserving the already sorted older block and merging new videos by duration.");
  }

  if (plan.zeroDurationCount === plan.totalVideos) {
    sendStatus("Could not read video durations. Scroll/reload the playlist and try again.", true);
    return;
  }

  sendStatus(`Found ${plan.totalVideos} videos. Fastest plan: ${plan.movesRequired} moves (${plan.topMoves} top, ${plan.bottomMoves} bottom), backbone ${plan.maxLen}/${plan.totalVideos}.`);

  if (plan.movesRequired === 0) {
    sendStatus("Already sorted. No moves required.", true);
    return;
  }

  let moved = 0;
  let failed = 0;

  for (let i = plan.bestStart - 1; i >= 0; i--) {
    const video = plan.sortedVideos[i];
    sendStatus(`Moving to top (${++moved}/${plan.movesRequired}): ${video.durationStr} - ${video.title}`);
    if (!(await moveVideo(video, "top"))) failed++;
  }

  for (let i = plan.bestEnd + 1; i < plan.sortedVideos.length; i++) {
    const video = plan.sortedVideos[i];
    sendStatus(`Moving to bottom (${++moved}/${plan.movesRequired}): ${video.durationStr} - ${video.title}`);
    if (!(await moveVideo(video, "bottom"))) failed++;
  }

  const suffix = failed ? ` Finished with ${failed} failed moves. Check console.` : "Sorting complete.";
  sendStatus(suffix, true);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "SORT_WATCH_LATER") {
    sortWatchLater(request.sortType);
    sendResponse({ status: "started" });
  }
  if (request.action === "ANALYZE_WATCH_LATER") {
    const plan = createSortPlan(request.sortType);
    sendResponse({ status: "ok", plan: summarizePlan(plan) });
  }
});
})();
