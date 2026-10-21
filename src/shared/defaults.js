/** Default fixed weekday schedule and extension settings. */

import { resolvePauseFromSchedule } from './time.js';

export const DEFAULT_SCHEDULE = Object.freeze({
  entry: '09:00',
  exit: '18:00',
  /** Break duration HH:MM (the portal stores the pause in seconds). */
  pause: '01:00',
});

export const DEFAULT_SETTINGS = Object.freeze({
  schedule: { ...DEFAULT_SCHEDULE },
});

export const STORAGE_KEYS = Object.freeze({
  settings: 'mchSettings',
});

export function mergeSettings(raw) {
  const base = {
    schedule: { ...DEFAULT_SCHEDULE },
  };
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  return {
    schedule: {
      entry: raw.schedule?.entry || base.schedule.entry,
      exit: raw.schedule?.exit || base.schedule.exit,
      pause: resolvePauseFromSchedule(raw.schedule),
    },
  };
}
