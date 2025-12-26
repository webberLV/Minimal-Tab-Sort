'use strict';

/**
 * Website Tab Sorter
 * - Sorts pinned tabs independently
 * - Groups by hostname+port (URL.host without leading "www.")
 * - Within host: sorts by URL components (host + path + search + hash)
 * - Moves tab groups left, ordered by title (descending)
 */

const WWW_RE = /^www\./i;

chrome.action.onClicked.addListener(() => {
  sortAllTabs().catch(err => console.error("Sort failed:", err));
});

async function sortAllTabs() {
  const { id: windowId } = await chrome.windows.getLastFocused();

  // 1) Pinned tabs (own universe)
  const pinnedTabs = await chrome.tabs.query({ windowId, pinned: true });
  let nextPosition = pinnedTabs.length;

  if (pinnedTabs.length) {
    await sortTabsScope(pinnedTabs, 0, pinnedTabs[0].groupId);
    await Promise.all(
      pinnedTabs.map(t => chrome.tabs.update(t.id, { pinned: true }))
    );
  }

  // 2) Tab groups (title DESC)
  const tabGroups = await chrome.tabGroups.query({ windowId });
  if (tabGroups.length) {
    tabGroups.sort((a, b) =>
      (b.title || "").localeCompare(a.title || "")
    );

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
  }

  // 3) Ungrouped, unpinned
  const ungroupedTabs = await chrome.tabs.query({
    windowId,
    pinned: false,
    groupId: -1
  });

  if (ungroupedTabs.length) {
    await sortTabsScope(
      ungroupedTabs,
      minIndex(ungroupedTabs),
      -1
    );
  }
}

async function sortTabsScope(tabs, startIndex, groupId) {
  if (!tabs || !tabs.length) return;

  const decorated = tabs.map((tab, originalIndex) => {
    const url = resolveTabUrl(tab);
    const cleanHost = url.host.replace(WWW_RE, "").toLowerCase();

    return {
      id: tab.id,
      originalIndex,
      hostname: cleanHost,
      key: cleanHost + url.pathname + url.search + url.hash
    };
  });

  decorated.sort((a, b) => {
    const hostCmp = a.hostname.localeCompare(b.hostname);
    if (hostCmp) return hostCmp;

    const keyCmp = a.key.localeCompare(b.key);
    if (keyCmp) return keyCmp;

    return a.originalIndex - b.originalIndex;
  });

  const sortedIds = decorated.map(x => x.id);
  await chrome.tabs.move(sortedIds, { index: startIndex });

  if (groupId > -1) {
    await chrome.tabs.group({ groupId, tabIds: sortedIds });
  }
}

function resolveTabUrl(tab) {
  const raw = tab.pendingUrl || tab.url;

  try {
    return new URL(raw);
  } catch {
    return new URL("http://invalid/" + encodeURIComponent(raw));
  }
}

function minIndex(tabs) {
  let m = tabs[0].index;
  for (let i = 1; i < tabs.length; i++) {
    if (tabs[i].index < m) m = tabs[i].index;
  }
  return m;
}
