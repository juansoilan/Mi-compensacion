/**
 * Clock and duration helpers.
 *
 * Parsers stay separate on purpose: the portal POST accepts the first
 * HH:MM it finds, the timeline only accepts a real clock, and a pause
 * may run past 24 hours.
 */

/**
 * First HH:MM in a string. Invalid values count as 0.
 * @param {string} [hhmm]
 * @returns {number} minutes
 */
export function timeToMinutes(hhmm) {
  const match = String(hhmm || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return 0;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Strict clock 00:00–23:59. Invalid → null.
 * @param {string} [value]
 * @returns {number | null}
 */
export function clockToMinutes(value) {
  const match = String(value || '').match(
    /^([01]?\d|2[0-3]):([0-5]\d)$/,
  );
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Duration HH:MM, hours may exceed 24 (e.g. 40:00). Invalid → null.
 * @param {string} [value]
 * @returns {number | null}
 */
export function durationToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * @param {number} minutes
 * @returns {string} HH:MM within 00:00–23:59
 */
export function minutesToClock(minutes) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Side-panel clock. Optional seconds are ignored. Invalid → 09:00.
 * @param {string} [value]
 * @returns {string} HH:MM
 */
export function normalizeClock(value) {
  const match = String(value || '').match(
    /^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/,
  );
  if (!match) {
    return '09:00';
  }
  const h = Math.min(23, Number(match[1]));
  return `${String(h).padStart(2, '0')}:${match[2]}`;
}

/**
 * Portal clock. Clamps hour and minute. Invalid → ''.
 * @param {string} [value]
 * @returns {string}
 */
export function normalizeTimeValue(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return '';
  }
  const h = String(Math.min(23, Number(match[1]))).padStart(2, '0');
  const m = String(Math.min(59, Number(match[2]))).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Pad the hour and leave the rest. No match → the original string.
 * @param {string} [value]
 * @returns {string}
 */
export function normalizeHhMm(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return String(value || '');
  }
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

/**
 * Duration HH:MM with hours clamped to 23. Invalid → ''.
 * @param {string} [value]
 * @returns {string}
 */
export function normalizeDurationValue(value) {
  const match = String(value || '').match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) {
    return '';
  }
  const h = String(Math.min(23, Number(match[1]))).padStart(2, '0');
  return `${h}:${match[2]}`;
}

/**
 * Same as normalizeDurationValue, but invalid values become 01:00.
 * @param {string} [value]
 * @returns {string}
 */
export function normalizePauseDuration(value) {
  return normalizeDurationValue(value) || '01:00';
}

/**
 * @param {string} [pauseHhMm]
 * @returns {number} seconds
 */
export function pauseToSeconds(pauseHhMm) {
  return Math.max(0, timeToMinutes(pauseHhMm)) * 60;
}

/**
 * @param {string} start
 * @param {string} end
 * @returns {number} seconds
 */
export function secondsBetween(start, end) {
  const diff = timeToMinutes(end) - timeToMinutes(start);
  return Math.max(0, diff) * 60;
}

/**
 * Pause minutes from schedule.pause, or a legacy break window.
 * @param {{ pause?: string, breakStart?: string, breakEnd?: string }} schedule
 * @returns {number}
 */
export function pauseMinutesFromSchedule(schedule) {
  if (schedule?.pause) {
    return Math.max(0, timeToMinutes(schedule.pause));
  }
  if (schedule?.breakStart && schedule?.breakEnd) {
    return Math.max(
      0,
      timeToMinutes(schedule.breakEnd) - timeToMinutes(schedule.breakStart),
    );
  }
  return 60;
}

/**
 * @param {{ entry: string, exit: string, pause?: string, breakStart?: string, breakEnd?: string }} schedule
 * @returns {number} seconds
 */
export function effectiveSeconds(schedule) {
  const total = timeToMinutes(schedule.exit) - timeToMinutes(schedule.entry);
  const pause = pauseMinutesFromSchedule(schedule);
  return Math.max(0, total - pause) * 60;
}

/**
 * Break length from two clock times. Empty when the window is invalid.
 * @param {string} [start]
 * @param {string} [end]
 * @returns {string} HH:MM
 */
export function durationFromBreakWindow(start, end) {
  const a = normalizeTimeValue(start);
  const b = normalizeTimeValue(end);
  if (!a || !b) {
    return '';
  }
  const am = Number(a.slice(0, 2)) * 60 + Number(a.slice(3));
  const bm = Number(b.slice(0, 2)) * 60 + Number(b.slice(3));
  if (bm < am) {
    return '';
  }
  const mins = bm - am;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Pause HH:MM from pause, or from a legacy breakStart/breakEnd.
 * @param {object} [rawSchedule]
 * @returns {string}
 */
export function resolvePauseFromSchedule(rawSchedule) {
  if (!rawSchedule || typeof rawSchedule !== 'object') {
    return '01:00';
  }
  if (rawSchedule.pause) {
    return normalizePauseDuration(rawSchedule.pause);
  }
  const start = durationToMinutes(rawSchedule.breakStart);
  const end = durationToMinutes(rawSchedule.breakEnd);
  if (start != null && end != null && end >= start) {
    const mins = end - start;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return '01:00';
}

/**
 * @param {Date} [date]
 * @returns {string} dd/mm/yyyy
 */
export function formatDateDdMmYyyy(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
