'use strict';

/**
 * Website Tab Sorter (Invariant)
 * - Sorts pinned tabs independently
 * - Groups by host+port (URL.host without leading "www.")
 * - chrome-extension:// tabs grouped as ext:<extension-id>
 * - Internal pages clustered under "internal"
 * - Within host: sorts by URL components (host + path + search + hash)
 * - Moves tab groups left, ordered by title (descending)
 */

const WWW_RE = /^www\./i;

chrome.action.onClicked.addListener(() => {
  sortAllTabs().catch(err => console.error("Sort failed:", err));
});

async function sortAllTabs() {
  const { id: windowId } = await chrome.windows.getLastFocused();

  /* ========= 1) PINNED TABS ========= */
  const pinnedTabs = await chrome.tabs.query({ windowId, pinned: true });
  let nextPosition = pinnedTabs.length;

  if (pinnedTabs.length) {
    await sortTabsScope(pinnedTabs, 0, pinnedTabs[0].groupId);
    await Promise.all(
      pinnedTabs.map(t => chrome.tabs.update(t.id, { pinned: true }))
    );
  }

  /* ========= 2) TAB GROUPS ========= */
  const tabGroups = await chrome.tabGroups.query({ windowId });
  tabGroups.sort((a, b) => (b.title || "").localeCompare(a.title || ""));

  for (const group of tabGroups) {
    await chrome.tabGroups.move(group.id, { index: nextPosition });

    const tabs = await chrome.tabs.query({
      windowId,
      groupId: group.id
    });

    if (tabs.length) {
      await sortTabsScope(tabs, minIndex(tabs), group.id);
      nextPosition += tabs.length;
    }
  }

  /* ========= 3) UNGROUPED / UNPINNED ========= */
  const ungroupedTabs = await chrome.tabs.query({
    windowId,
    pinned: false,
    groupId: -1
  });

  if (ungroupedTabs.length) {
    await sortTabsScope(ungroupedTabs, minIndex(ungroupedTabs), -1);
  }
}

/* =========================
   SORT ONE SCOPE
   ========================= */
async function sortTabsScope(tabs, startIndex, groupId) {
  if (!tabs.length) return;

  const decorated = tabs.map((tab, originalIndex) => {
    const url = resolveTabUrl(tab);

    const hostKey =
      url.protocol === "chrome-extension:"
        ? `ext:${url.host}`                         // 👈 extension ID bucket
        : url.protocol === "http:" || url.protocol === "https:"
          ? url.host.replace(WWW_RE, "").toLowerCase()
          : "internal";

    const sortKey =
      hostKey +
      url.pathname +
      url.search +
      url.hash;

    return {
      id: tab.id,
      originalIndex,
      hostKey,
      sortKey
    };
  });

  decorated.sort((a, b) => {
    const h = a.hostKey.localeCompare(b.hostKey);
    if (h !== 0) return h;

    const k = a.sortKey.localeCompare(b.sortKey);
    if (k !== 0) return k;

    return a.originalIndex - b.originalIndex;
  });

  const sortedIds = decorated.map(t => t.id);
  await chrome.tabs.move(sortedIds, { index: startIndex });

  if (groupId > -1) {
    await chrome.tabs.group({ groupId, tabIds: sortedIds });
  }
}

/* =========================
   URL RESOLUTION
   ========================= */
function resolveTabUrl(tab) {
  const raw = tab.pendingUrl || tab.url;

  // chrome-extension pages
  if (raw.startsWith("chrome-extension://")) {
    return new URL(raw);
  }

  // internal browser pages
  if (
    raw.startsWith("chrome://") ||
    raw.startsWith("about:") ||
    raw.startsWith("edge://") ||
    raw.startsWith("brave://")
  ) {
    return new URL("http://internal/" + encodeURIComponent(raw));
  }

  try {
    return new URL(raw);
  } catch {
    return new URL("http://invalid/" + encodeURIComponent(raw));
  }
}

/* =========================
   HELPERS
   ========================= */
function minIndex(tabs) {
  let min = tabs[0].index;
  for (let i = 1; i < tabs.length; i++) {
    if (tabs[i].index < min) min = tabs[i].index;
  }
  return min;
}
