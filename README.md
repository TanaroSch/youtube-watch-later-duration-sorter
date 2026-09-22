# YouTube Watch Later Sorter

Sort your YouTube **Watch Later** playlist by video duration.

This is a small Chrome/Edge extension that automates YouTube's own playlist menu actions. It does not use a backend server and does not collect data.

## What It Does

- Sorts loaded Watch Later videos from shortest to longest.
- Supports a **Strict Sort** mode for the full loaded list.
- Supports a **Smart Sort** mode that keeps an already sorted older block and merges newer videos into it.
- Supports a **Recent to Top** mode that moves only recently uploaded videos to the top (shortest first) and leaves all older videos in their current order, regardless of their duration. "Recent" defaults to younger than 7 days; set any number of days or a fixed date in the popup.
- Computes the fastest available plan using YouTube's `Move to top` and `Move to bottom` menu actions.
- Shows the planned number of moves before sorting.
- Supports English and German YouTube menu labels.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.
6. Open `https://www.youtube.com/playlist?list=WL`.

After updating the extension, reload it on the extensions page. If a YouTube tab was already open, reload that tab too.

## Usage

1. Open your Watch Later playlist.
2. Scroll until all videos you want to sort are loaded.
3. Click the extension icon.
4. Review the move plan.
5. Click **Strict Sort (All)**, **Smart Sort (New Only)**, or **Recent to Top**.

The extension performs the same kind of menu operations a user would do manually, so large playlists can take a while.

## Sorting Strategy

YouTube exposes convenient menu actions for moving an item to the top or bottom of the playlist. The extension minimizes the number of these actions.

It finds the longest contiguous segment of the target sorted order that is already in the correct relative order in the current playlist. That segment stays untouched. Items before it are moved to the top in reverse order, and items after it are moved to the bottom in forward order.

## Limitations

- Only currently loaded playlist rows can be sorted. Scroll first.
- YouTube changes its DOM and menu labels regularly, so this can break.
- Watch Later is a system-managed playlist; the official YouTube Data API is not a reliable fit for reordering it.
- This extension currently targets Chrome-compatible Manifest V3 browsers.
- Recent to Top uses the upload date, not the date a video was added to Watch Later: YouTube does not expose the added date. The upload date is only shown relative ("3 days ago", "vor 3 Tagen"), so it is approximate — "1 month ago" is treated as 30 days. Videos without a readable upload date stay in place.
- Sorting depends on readable video duration badges. If YouTube has not loaded durations yet, reload or scroll the playlist and retry.

## Privacy

- No server.
- No analytics.
- No tracking.
- No data collection.
- Runs only on `https://www.youtube.com/*`.

The extension needs `activeTab` and `scripting` so the popup can talk to, or reload into, the currently open YouTube Watch Later tab after an extension reload.

## Development

There is no build step.

Useful checks:

```bash
node --check content.js
node --check popup.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest ok')"
```

## License

MIT
