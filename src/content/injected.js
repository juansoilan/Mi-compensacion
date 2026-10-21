import { MSG } from '../shared/messages.js';
import { isFinalizarPage } from './_modules/finalizarApi.js';
import {
  closeToday,
  readMonth,
  scoreWorkdayFormPresence,
} from './_modules/portalAdapter.js';

if (!globalThis.__MCH_CONTENT_LOADED__) {
  globalThis.__MCH_CONTENT_LOADED__ = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handle(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          ok: false,
          error: String(error?.message || error),
        }),
      );
    return true;
  });
}

async function handle(message) {
  switch (message?.type) {
    case MSG.PING:
      return {
        ok: true,
        href: location.href,
        title: document.title,
        frame: window === window.top ? 'top' : 'iframe',
        workdayScore: scoreWorkdayFormPresence(),
        isFinalizar: isFinalizarPage(),
      };
    case MSG.GET_MONTH:
      return {
        ok: true,
        ...(await readMonth({
          year: message.year,
          month: message.month,
          force: Boolean(message.force),
        })),
      };
    case MSG.CLOSE_TODAY: {
      if (!message.confirmed) {
        return {
          ok: false,
          error: 'Explicit confirmation is required before submitting.',
        };
      }
      if (!message.schedule) {
        return { ok: false, error: 'Schedule is missing.' };
      }
      return closeToday(message.schedule, message.date, {
        auxUrl: message.auxUrl || '',
        mode: message.mode === 'edit' ? 'edit' : 'cover',
      });
    }
    default:
      return { ok: false, error: 'Unknown message in content script' };
  }
}
