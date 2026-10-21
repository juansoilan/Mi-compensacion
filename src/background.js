import { MSG } from './shared/messages.js';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  mergeSettings,
} from './shared/defaults.js';

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  if (!stored[STORAGE_KEYS.settings]) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.settings]: { ...DEFAULT_SETTINGS },
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({ ok: false, error: String(error?.message || error) }),
    );
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case MSG.GET_SETTINGS:
      return { ok: true, settings: await loadSettings() };
    case MSG.SAVE_SETTINGS: {
      const settings = mergeSettings(message.settings);
      await chrome.storage.local.set({
        [STORAGE_KEYS.settings]: settings,
      });
      return { ok: true, settings };
    }
    default:
      return { ok: false, error: 'Unknown message in background' };
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return mergeSettings(stored[STORAGE_KEYS.settings]);
}
