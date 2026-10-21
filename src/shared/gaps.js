/**
 * Weekday gap helpers. A day is missing when it is Mon–Fri in the visible
 * month and the portal has neither a time record nor an absence / holiday.
 */

export const DAY_STATUS = Object.freeze({
  empty: 'empty',
  recorded: 'recorded',
  covered: 'covered',
  weekend: 'weekend',
  otherMonth: 'otherMonth',
  unknown: 'unknown',
});

/**
 * @param {number} year
 * @param {number} month 1–12
 * @returns {number} days in month
 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * @param {number} year
 * @param {number} month 1–12
 * @param {number} day
 * @returns {boolean}
 */
export function isWeekday(year, month, day) {
  const dow = new Date(year, month - 1, day).getDay();
  return dow >= 1 && dow <= 5;
}

/**
 * @typedef {{
 *   day: number,
 *   status: string,
 *   label?: string,
 *   auxUrl?: string,
 *   entry?: string,
 *   exit?: string,
 *   effective?: string,
 *   pause?: string,
 *   detail?: string,
 * }} PortalDay
 */

/**
 * @param {PortalDay[]} portalDays
 * @param {number} year
 * @param {number} month 1–12
 * @returns {{ day: number, date: string, status: string, label?: string }[]}
 */
export function listMissingWeekdays(portalDays, year, month) {
  const byDay = new Map(
    (portalDays || []).map((d) => [Number(d.day), d]),
  );
  const missing = [];
  const total = daysInMonth(year, month);

  for (let day = 1; day <= total; day += 1) {
    if (!isWeekday(year, month, day)) {
      continue;
    }
    const info = byDay.get(day);
    const status = info?.status || DAY_STATUS.empty;
    if (
      status === DAY_STATUS.recorded ||
      status === DAY_STATUS.covered
    ) {
      continue;
    }
    if (
      status === DAY_STATUS.empty ||
      status === DAY_STATUS.unknown
    ) {
      missing.push({
        day,
        date: formatIsoDate(year, month, day),
        status,
        label: info?.label,
      });
    }
  }
  return missing;
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {string} YYYY-MM-DD
 */
export function formatIsoDate(year, month, day) {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

/**
 * Local midnight for the given instant.
 * @param {Date} [now]
 * @returns {Date}
 */
export function startOfToday(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * @param {Date} [now]
 * @returns {{ year: number, month: number, day: number, iso: string, isWeekday: boolean }}
 */
export function todayParts(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  return {
    year,
    month,
    day,
    iso: formatIsoDate(year, month, day),
    isWeekday: isWeekday(year, month, day),
  };
}

/**
 * True when the calendar day is after today (local midnight).
 * Future days cannot be closed yet in Compensa.
 */
export function isFutureDay(year, month, day, now = new Date()) {
  const today = startOfToday(now);
  const target = new Date(year, month - 1, day);
  return target.getTime() > today.getTime();
}

/**
 * @param {PortalDay[]} portalDays
 * @param {number} day
 * @returns {boolean}
 */
export function isDayCloseable(portalDays, day) {
  const info = (portalDays || []).find((d) => Number(d.day) === day);
  if (!info) {
    return true;
  }
  return (
    info.status === DAY_STATUS.empty ||
    info.status === DAY_STATUS.unknown
  );
}

/**
 * @typedef {{
 *   day: number | null,
 *   status: string,
 *   label?: string,
 *   auxUrl?: string,
 *   entry?: string,
 *   exit?: string,
 *   effective?: string,
 *   pause?: string,
 *   detail?: string,
 *   iso?: string,
 *   isPadding: boolean,
 *   isWeekend: boolean,
 *   isCloseable: boolean,
 *   isEditable: boolean,
 * }} MonthGridCell
 */

/**
 * Build a Mon–Sun month grid with leading padding cells.
 * @param {number} year
 * @param {number} month 1–12
 * @param {PortalDay[]|null|undefined} portalDays
 * @param {{ applyPortal?: boolean }} [options]
 * @returns {MonthGridCell[]}
 */
export function buildMonthGrid(year, month, portalDays, options = {}) {
  const applyPortal = options.applyPortal !== false;
  const byDay = new Map(
    (applyPortal ? portalDays || [] : []).map((d) => [Number(d.day), d]),
  );
  const total = daysInMonth(year, month);
  /** Monday-based index: Mon=0 … Sun=6 */
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  /** @type {MonthGridCell[]} */
  const cells = [];

  for (let i = 0; i < firstDow; i += 1) {
    cells.push({
      day: null,
      status: DAY_STATUS.otherMonth,
      isPadding: true,
      isWeekend: false,
      isCloseable: false,
      isEditable: false,
    });
  }

  for (let day = 1; day <= total; day += 1) {
    const weekend = !isWeekday(year, month, day);
    const info = byDay.get(day);
    let status;
    if (weekend) {
      status = DAY_STATUS.weekend;
    } else if (!applyPortal) {
      status = DAY_STATUS.unknown;
    } else {
      status = info?.status || DAY_STATUS.empty;
    }
    const pastOrToday = !isFutureDay(year, month, day);
    const closeable =
      !weekend &&
      applyPortal &&
      pastOrToday &&
      (status === DAY_STATUS.empty || status === DAY_STATUS.unknown);
    // Already closed weekdays can be updated (same Finalizar POST).
    const editable =
      !weekend &&
      applyPortal &&
      pastOrToday &&
      status === DAY_STATUS.recorded;
    cells.push({
      day,
      status,
      label: info?.label,
      auxUrl: info?.auxUrl || '',
      entry: info?.entry || '',
      exit: info?.exit || '',
      effective: info?.effective || '',
      pause: info?.pause || '',
      detail: info?.detail || '',
      iso: formatIsoDate(year, month, day),
      isPadding: false,
      isWeekend: weekend,
      isCloseable: closeable,
      isEditable: editable,
    });
  }

  return cells;
}

/**
 * Parse YYYY-MM-DD into a local Date at noon (avoids TZ edge cases).
 * @param {string} iso
 * @returns {Date | null}
 */
export function parseIsoDate(iso) {
  const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    12,
    0,
    0,
  );
}
