// Service worker: opens the side panel and adds a right-click entry.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'plain-terms-selection',
    title: 'Explain "%s" in plain terms',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'plain-terms-selection' || !tab) return;
  // Open first: sidePanel.open must run synchronously inside the user gesture.
  const opened = chrome.sidePanel.open({ tabId: tab.id });
  await chrome.storage.session.set({
    pendingSelection: { text: info.selectionText || '', title: tab.title || '', at: Date.now() },
  });
  await opened.catch(() => {});
});
