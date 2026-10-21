import { STORAGE_KEYS } from '../../shared/defaults.js';
import { normalizeText } from '../../shared/text.js';
import {
  durationFromBreakWindow,
  normalizeDurationValue,
  normalizeTimeValue,
} from '../../shared/time.js';
import {
  closeTodayViaApi,
  isFinalizarPage,
} from './finalizarApi.js';
import {
  clearMisRegistrosCache,
  fetchMonthViaMisRegistros,
} from './misRegistrosApi.js';

/**
 * Read month via MisRegistros API only (no DOM calendar scan).
 * @param {{ year?: number, month?: number, force?: boolean }} [opts]
 */
export async function readMonth(opts = {}) {
  const now = new Date();
  const year = Number(opts.year) || now.getFullYear();
  const month = Number(opts.month) || now.getMonth() + 1;

  const api = await fetchMonthViaMisRegistros(year, month, {
    force: Boolean(opts.force),
  });
  if (api.ok) {
    return api;
  }

  return unrecognized(
    api.error ||
      'Could not read My records. Keep the session open and press ↻.',
  );
}

/**
 * Close a day via POST Finalizar (new) or FinalizarAux (edit).
 * @param {{ entry: string, exit: string, pause?: string, breakStart?: string, breakEnd?: string }} schedule
 * @param {Date|string} [date]
 * @param {{ auxUrl?: string, mode?: 'edit' | 'cover' }} [options]
 */
export async function closeToday(schedule, date, options = {}) {
  const stored = await loadStoredSchedule();
  // Prefer the schedule from the side panel (user confirmed values).
  // Stored defaults only fill missing fields.
  const effective = normalizeSchedule({
    ...(stored || {}),
    ...(schedule || {}),
  });
  const result = await closeTodayViaApi(effective, date, options);
  if (result?.ok) {
    clearMisRegistrosCache();
  }
  return result;
}

/**
 * Score how likely this frame is Finalizar (for side-panel routing).
 */
export function scoreWorkdayFormPresence() {
  let score = 0;
  if (isFinalizarPage()) {
    score += 200;
  }
  const text = normalizeText(document.body?.innerText || '').slice(0, 8000);
  if (text.includes('summary of your workday')) score += 60;
  if (text.includes('end my workday')) score += 40;
  if (document.querySelector('input[name="__RequestVerificationToken"]')) {
    score += 40;
  }
  if (
    document.querySelector(
      'input[name*="RhPersonaIdEncrypted"], input[id*="RhPersonaIdEncrypted"]',
    )
  ) {
    score += 40;
  }
  if (
    document.querySelector(
      'input[name*="TipoDiaId"], select[name*="TipoDiaId"], input[id*="TipoDiaId"]',
    )
  ) {
    score += 20;
  }
  return score;
}

function unrecognized(reason) {
  const now = new Date();
  return {
    recognized: false,
    reason,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    mode: 'none',
    days: [],
  };
}

async function loadStoredSchedule() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return stored[STORAGE_KEYS.settings]?.schedule || null;
}

function normalizeSchedule(schedule) {
  const pause =
    normalizeDurationValue(schedule?.pause) ||
    durationFromBreakWindow(
      schedule?.breakStart,
      schedule?.breakEnd,
    ) ||
    '01:00';
  return {
    entry: normalizeTimeValue(schedule?.entry) || '09:00',
    exit: normalizeTimeValue(schedule?.exit) || '18:00',
    pause,
  };
}

