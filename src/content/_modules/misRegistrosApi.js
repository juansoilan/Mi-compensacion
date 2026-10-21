/**
 * Read month records via POST ObtenerMas?tipo=MisRegistros
 * (HTML fragments), using the open SSO session.
 */

import {
  DAY_STATUS,
  daysInMonth,
  isWeekday,
  startOfToday,
} from '../../shared/gaps.js';
import { normalizeText } from '../../shared/text.js';

/** Entry/exit placeholders that are not a real closed day. */
function isInvalidTimePair(entry, exit) {
  const a = String(entry || '').trim();
  const b = String(exit || '').trim();
  if (!a || !b) {
    return true;
  }
  if (a === '00:00' && b === '00:00') {
    return true;
  }
  return false;
}

const OBTENER_MAS_PATH =
  '/_rhapp/RegistroHorario/ObtenerMas?tipo=MisRegistros';
const MIS_REGISTROS_PATH = '/_rhapp/RegistroHorario/MisRegistros';

const MIS_COVERED_KEYWORDS = [
  'vacaciones',
  'ausencia',
  'festivo',
  'permiso',
  'baja',
  'holiday',
  'absence',
  'vacation',
  'leave',
];

const MONTH_INDEX = Object.freeze({
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
});

/** Drop cached Mis registros months (call after a successful Finalizar). */
export function clearMisRegistrosCache() {
  const store = globalThis.__MCH_MIS_REG__;
  if (store) {
    store.done = {};
  }
}

/**
 * @param {number} year
 * @param {number} month 1–12
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<{
 *   ok: true,
 *   recognized: true,
 *   year: number,
 *   month: number,
 *   mode: string,
 *   days: object[],
 * } | { ok: false, error: string }>}
 */
export async function fetchMonthViaMisRegistros(year, month, opts = {}) {
  const cacheKey = `${year}-${month}`;
  const store = (globalThis.__MCH_MIS_REG__ =
    globalThis.__MCH_MIS_REG__ || { inflight: {}, done: {} });
  if (
    !opts.force &&
    store.done[cacheKey] &&
    Date.now() - store.done[cacheKey].at < 8000
  ) {
    return store.done[cacheKey].value;
  }
  if (store.inflight[cacheKey]) {
    return store.inflight[cacheKey];
  }

  store.inflight[cacheKey] = (async () => {
    const token = await resolveAntiforgeryToken();
    if (!token) {
      return {
        ok: false,
        error:
          'Sign in on Mi Compensación, then press refresh.',
      };
    }

    const htmlChunks = [];
    let ultimaRow = 0;
    const pageSize = 40;
    for (let page = 0; page < 30; page += 1) {
      const body = buildObtenerMasBody(year, month, ultimaRow, pageSize);
      const result = await postObtenerMas(body, token);
      if (!result.ok) {
        return result;
      }
      const blocks = countBloques(result.html);
      htmlChunks.push(result.html);
      if (blocks === 0) {
        break;
      }
      ultimaRow += blocks;
      if (blocks < pageSize) {
        break;
      }
    }

    const records = parseMisRegistrosHtml(htmlChunks.join('\n'), year);
    const days = buildMonthDaysFromRecords(year, month, records, new Date());
    return {
      ok: true,
      recognized: true,
      year,
      month,
      mode: 'mis-registros-api',
      days,
      calendarScore: 100,
    };
  })();

  try {
    const value = await store.inflight[cacheKey];
    if (value.ok) {
      store.done[cacheKey] = { at: Date.now(), value };
    }
    return value;
  } finally {
    delete store.inflight[cacheKey];
  }
}

/**
 * @param {string} chunk
 * @returns {string} path+query for FinalizarAux, or ''
 */
export function extractFinalizarAuxUrl(chunk) {
  const match = String(chunk || '').match(
    /\/_rhapp\/RegistroHorario\/FinalizarAux\?[^"'\\\s)]+/i,
  );
  if (!match) {
    return '';
  }
  return match[0].replace(/&amp;/g, '&');
}

/**
 * @param {string} html
 * @param {number} fallbackYear
 * @returns {{ day: number, month: number, year: number, status: string, label?: string, auxUrl?: string }[]}
 */
export function parseMisRegistrosHtml(html, fallbackYear) {
  const records = [];
  const chunks = String(html || '').split(/(?=<div[^>]*\bbloque\b)/i);

  for (const chunk of chunks) {
    if (!/\bbloque\b/i.test(chunk)) {
      continue;
    }
    // Only trust the historial hidden input (fecha-may is noisier).
    const histMatch =
      chunk.match(
        /id="texto_historial_[^"]*"\s+value="([^"]+)"/i,
      ) ||
      chunk.match(
        /value="([^"]+)"\s+id="texto_historial_[^"]*"/i,
      );
    const hist = histMatch?.[1] || '';
    const parsed = parseRegistroDateText(hist, fallbackYear);
    if (!parsed) {
      continue;
    }

    // Mirror portal card: hourglass = entry/exit, play/pause = durations.
    const entry = chunk.match(
      /fa-hourglass-start[\s\S]{0,160}?class="tiempo_registro"[^>]*>\s*([0-9]{1,3}:[0-5]\d)/i,
    )?.[1];
    const exit = chunk.match(
      /fa-hourglass-end[\s\S]{0,160}?class="tiempo_registro"[^>]*>\s*([0-9]{1,3}:[0-5]\d)/i,
    )?.[1];
    const effective = chunk.match(
      /fa-play[\s\S]{0,160}?class="tiempo_registro"[^>]*>\s*([0-9]{1,3}:[0-5]\d)/i,
    )?.[1];
    const pause = chunk.match(
      /fa-pause[\s\S]{0,160}?class="tiempo_registro"[^>]*>\s*([0-9]{1,3}:[0-5]\d)/i,
    )?.[1];
    const auxUrl = extractFinalizarAuxUrl(chunk);
    const blob = normalizeText(`${hist} ${chunk.replace(/<[^>]+>/g, ' ')}`);
    const isCovered = MIS_COVERED_KEYWORDS.some((k) => blob.includes(k));
    // Closed days in Compensa open via FinalizarAux; drafts/open days do not.
    const isClosedRecord = Boolean(auxUrl);

    if (isCovered && !isClosedRecord) {
      records.push({
        ...parsed,
        status: DAY_STATUS.covered,
        label: shortCoverLabel(hist),
        detail: hist.replace(/\s+/g, ' ').trim().slice(0, 80),
      });
    } else if (
      isClosedRecord &&
      entry &&
      exit &&
      !isInvalidTimePair(entry, exit)
    ) {
      // Cell shows entry–exit only; play/pause live in tooltip via fields.
      records.push({
        ...parsed,
        status: DAY_STATUS.recorded,
        label: `${entry}–${exit}`,
        auxUrl,
        entry,
        exit,
        effective: effective || '',
        pause: pause || '',
      });
    }
    // Skip open/planned cards (times without FinalizarAux).
  }

  return records;
}

/** Short label for absences and holidays. The portal reason stays in `detail`. */
export function shortCoverLabel() {
  return 'Off';
}

/**
 * @param {string} text
 * @param {number} fallbackYear
 */
export function parseRegistroDateText(text, fallbackYear) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return null;
  }

  const dowEn = raw.match(
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i,
  )?.[1];
  const dowEs = raw.match(
    /^(Lunes|Martes|Miércoles|Miercoles|Jueves|Viernes|Sábado|Sabado|Domingo)\b/i,
  )?.[1];

  let candidate = null;

  const en = raw.match(
    /(\d{1,2})\s+Of\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?/i,
  );
  if (en) {
    candidate = {
      day: Number(en[1]),
      month: MONTH_INDEX[en[2].toLowerCase()],
      year: en[3] ? Number(en[3]) : fallbackYear,
      yearInferred: !en[3],
    };
  }

  const es = raw.match(
    /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?/i,
  );
  if (!candidate && es) {
    candidate = {
      day: Number(es[1]),
      month: MONTH_INDEX[es[2].toLowerCase()],
      year: es[3] ? Number(es[3]) : fallbackYear,
      yearInferred: !es[3],
    };
  }

  const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!candidate && iso) {
    candidate = {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      yearInferred: false,
    };
  }

  if (!candidate) {
    return null;
  }

  if (candidate.yearInferred && (dowEn || dowEs)) {
    const resolved = resolveYearByWeekday(
      candidate.month,
      candidate.day,
      fallbackYear,
      dowEn || dowEs,
    );
    if (!resolved) {
      return null;
    }
    candidate.year = resolved;
  }

  return {
    day: candidate.day,
    month: candidate.month,
    year: candidate.year,
  };
}

const DOW_INDEX = Object.freeze({
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6,
});

/**
 * When the HTML omits the year, pick fallbackYear or fallbackYear-1
 * so the weekday name matches.
 * @returns {number | null}
 */
function resolveYearByWeekday(month, day, fallbackYear, dowName) {
  const want = DOW_INDEX[normalizeText(dowName)];
  if (want == null) {
    return fallbackYear;
  }
  for (const year of [fallbackYear, fallbackYear - 1, fallbackYear + 1]) {
    const got = new Date(year, month - 1, day).getDay();
    if (got === want) {
      return year;
    }
  }
  return null;
}

/**
 * Build calendar days strictly from Mis registros records.
 * Open/planned cards are already filtered out by the parser
 * (only FinalizarAux / covered absences remain).
 *
 * @param {number} year
 * @param {number} month
 * @param {{ day: number, month: number, year: number, status: string, label?: string }[]} records
 * @param {Date} [now]
 */
export function buildMonthDaysFromRecords(
  year,
  month,
  records,
  now = new Date(),
) {
  const today = startOfToday(now);
  const byDay = new Map();
  for (const rec of records) {
    if (rec.year !== year || rec.month !== month) {
      continue;
    }
    const recDate = new Date(rec.year, rec.month - 1, rec.day);
    // Future rows from the API are never closed yet.
    if (recDate.getTime() > today.getTime()) {
      continue;
    }
    byDay.set(rec.day, {
      day: rec.day,
      status: rec.status,
      label: rec.label,
      auxUrl: rec.auxUrl || '',
      entry: rec.entry || '',
      exit: rec.exit || '',
      effective: rec.effective || '',
      pause: rec.pause || '',
      detail: rec.detail || '',
    });
  }

  const total = daysInMonth(year, month);
  const days = [];
  for (let day = 1; day <= total; day += 1) {
    if (!isWeekday(year, month, day)) {
      days.push({ day, status: DAY_STATUS.weekend });
      continue;
    }
    days.push(
      byDay.get(day) || { day, status: DAY_STATUS.empty },
    );
  }
  return days;
}

function buildObtenerMasBody(year, month, ultimaRow, cantidadRows) {
  const from = new Date(year, month - 1, 1, 0, 0, 0);
  const to = new Date(year, month, 0, 23, 59, 59);
  const params = new URLSearchParams();
  params.set('UltimaRow', String(ultimaRow));
  params.set('FechaDesde', from.toString());
  params.set('FechaHasta', to.toString());
  params.set('HorasExtra', 'false');
  params.set('CantidadRows', String(cantidadRows));
  params.set('PersonaId', '');
  params.set('RegistrosDenegados', 'false');
  return params;
}

async function postObtenerMas(body, token) {
  const url = new URL(OBTENER_MAS_PATH, location.origin).toString();
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'text/html, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        __RequestVerificationToken: token,
        Referer: new URL(MIS_REGISTROS_PATH, location.origin).toString(),
      },
      body: body.toString(),
    });
    const html = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `ObtenerMas responded ${response.status}.`,
      };
    }
    if (
      /anti-forgery|antiforgery/i.test(html) &&
      /error|exception|invalid/i.test(html)
    ) {
      return {
        ok: false,
        error:
          'The portal session expired. Reload Mi Compensación, then press refresh.',
      };
    }
    return { ok: true, html };
  } catch (error) {
    return {
      ok: false,
      error: `ObtenerMas network error: ${String(error?.message || error)}`,
    };
  }
}

function countBloques(html) {
  const matches = String(html || '').match(/class="[^"]*\bbloque\b/gi);
  return matches?.length || 0;
}

async function resolveAntiforgeryToken() {
  const fromDom =
    document.querySelector(
      'input[name="__RequestVerificationToken"]',
    )?.value?.trim() ||
    document.querySelector(
      'input[name*="RequestVerificationToken"]',
    )?.value?.trim();
  if (fromDom) {
    return fromDom;
  }

  try {
    const url = new URL(MIS_REGISTROS_PATH, location.origin).toString();
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'text/html' },
    });
    const html = await response.text();
    const match = html.match(
      /name="__RequestVerificationToken"[^>]*value="([^"]+)"/i,
    ) || html.match(
      /value="([^"]+)"[^>]*name="__RequestVerificationToken"/i,
    );
    return match?.[1] || '';
  } catch {
    return '';
  }
}
