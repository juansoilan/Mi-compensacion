/**
 * Close the workday via POST /_rhapp/RegistroHorario/Finalizar
 * (form-urlencoded), matching the Compensa portal request.
 */

import {
  effectiveSeconds,
  formatDateDdMmYyyy,
  normalizeHhMm,
  pauseMinutesFromSchedule,
} from '../../shared/time.js';

const FINALIZAR_PATH = '/_rhapp/RegistroHorario/Finalizar';

/** Identical successful closes inside this window are not posted again. */
const CLOSE_REPLAY_MS = 60_000;

/**
 * Per-page guard. A second new record for the same day accumulates hours
 * on the portal, so a successful cover is remembered for this session.
 * @returns {{
 *   covers: Set<string>,
 *   recent: Map<string, { at: number, result: object }>,
 *   inflight: Map<string, Promise<object>>,
 * }}
 */
function closeGuard() {
  if (!globalThis.__MCH_CLOSE_GUARD__) {
    globalThis.__MCH_CLOSE_GUARD__ = {
      covers: new Set(),
      recent: new Map(),
      inflight: new Map(),
    };
  }
  return globalThis.__MCH_CLOSE_GUARD__;
}

/**
 * @param {Date} date
 * @returns {string}
 */
function sessionDayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Read antiforgery token and Compensa meta from the Finalizar page.
 * @param {Document} [doc]
 * @returns {{ ok: true, meta: object } | { ok: false, error: string }}
 */
export function collectFinalizarMeta(doc = document) {
  const tokenEl =
    doc.querySelector('input[name="__RequestVerificationToken"]') ||
    doc.querySelector('input[name*="RequestVerificationToken"]');
  const token = tokenEl?.value?.trim() || '';

  const rhPersonaIdEncrypted = findNamedValue(doc, [
    'RhPersonaIdEncrypted',
    'rhPersonaIdEncrypted',
  ]);

  const tipoDiaId =
    findNamedValue(doc, ['TipoDiaId', 'tipoDiaId']) ||
    readSelectValue(doc, ['TipoDiaId', 'tipoDiaId', 'Day type']);

  const missing = [];
  if (!token) {
    missing.push('__RequestVerificationToken');
  }
  if (!rhPersonaIdEncrypted) {
    missing.push('RhPersonaIdEncrypted');
  }
  if (!tipoDiaId) {
    missing.push('TipoDiaId');
  }

  if (missing.length) {
    return {
      ok: false,
      error:
        `Missing ${missing.join(', ')} on this page. ` +
        'Open “Summary of your workday” / Finalizar and try again.',
    };
  }

  // Exact name only — findNamedValue('Id') would also match TipoDiaId.
  const id = findExactNamedValue(doc, ['Id']) || '0';

  return {
    ok: true,
    meta: {
      token,
      rhPersonaIdEncrypted,
      tipoDiaId: String(tipoDiaId),
      id: String(id),
    },
  };
}

/**
 * Load an existing closed-day form (FinalizarAux) to get the real record Id.
 * Re-posting with Id=0 / RegistroNuevo=True accumulates durations on Compensa.
 * @param {string} auxPath path like /_rhapp/RegistroHorario/FinalizarAux?data=...
 * @returns {Promise<{ ok: true, meta: object, postUrl: string } | { ok: false, error: string }>}
 */
export async function loadFinalizarAuxMeta(auxPath) {
  const path = String(auxPath || '').trim();
  if (!/FinalizarAux/i.test(path)) {
    return { ok: false, error: 'Missing FinalizarAux URL for this record.' };
  }
  let postUrl;
  try {
    postUrl = new URL(path, location.origin).toString();
  } catch {
    return { ok: false, error: 'Invalid FinalizarAux URL.' };
  }

  try {
    const response = await fetch(postUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const html = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: `FinalizarAux responded ${response.status}.`,
      };
    }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const collected = collectFinalizarMeta(doc);
    if (!collected.ok) {
      return collected;
    }
    const id = String(collected.meta.id || '0');
    if (!id || id === '0') {
      return {
        ok: false,
        error:
          'Could not find the record Id in FinalizarAux. Open it in the portal and try again.',
      };
    }
    // Browser form usually posts to Finalizar (or form[action]), not Aux.
    // Posting to Aux + follow redirects often throws "Failed to fetch".
    const submitUrl = resolveFinalizarSubmitUrl(doc);
    return {
      ok: true,
      meta: {
        ...collected.meta,
        id,
        isNew: false,
      },
      postUrl: submitUrl,
    };
  } catch (error) {
    return {
      ok: false,
      error: `Error opening FinalizarAux: ${String(error?.message || error)}`,
    };
  }
}

/**
 * @param {{ entry: string, exit: string, pause?: string, breakStart?: string, breakEnd?: string }} schedule
 * @param {{ token: string, rhPersonaIdEncrypted: string, tipoDiaId: string, id?: string, isNew?: boolean }} meta
 * @param {Date} [date]
 * @returns {URLSearchParams}
 */
export function buildFinalizarBody(schedule, meta, date = new Date()) {
  const fecha = formatDateDdMmYyyy(date);
  const pausa = pauseMinutesFromSchedule(schedule) * 60;
  const efectivo = effectiveSeconds(schedule);
  const id = String(meta.id || '0');
  const isNew = meta.isNew !== false && id === '0';

  const params = new URLSearchParams();
  params.set('FechaHoraFin', fecha);
  params.set('FechaHoraInicio', fecha);
  params.set('FechaRegistroProcesoAutomatico', '');
  params.set('GuardandoRegistroAnterior', 'true');
  params.set('HoraFin', normalizeHhMm(schedule.exit));
  params.set('HoraInicio', normalizeHhMm(schedule.entry));
  params.set('Id', id);
  params.set('InformaTeletrabajo', 'True');
  params.set('MotivoHorasExtra', '');
  params.set('MotivoNuevo', '');
  params.set('RegistroManual', 'True');
  params.set('RegistroNuevo', isNew ? 'True' : 'False');
  params.set('RegistroProcesoAutomatico', '');
  params.set('RhPersonaIdEncrypted', meta.rhPersonaIdEncrypted);
  params.set('TiempoEfectivo', String(efectivo));
  params.set('TiempoPausa', String(pausa));
  params.set('TipoDiaId', meta.tipoDiaId);
  params.set('__RequestVerificationToken', meta.token);
  return params;
}

/**
 * POST the finalize payload using the current page session cookies.
 * @param {URLSearchParams|string} body
 * @param {string} [pageUrl]
 * @returns {Promise<{ ok: boolean, status?: number, message?: string, error?: string }>}
 */
export async function postFinalizar(body, pageUrl = location.href) {
  const url = buildFinalizarUrl(pageUrl);
  /** @type {Response} */
  let response;
  try {
    // Compensa uses Post-Redirect-Get. Following the redirect (esp. to SSO
    // or another host) makes fetch throw TypeError: Failed to fetch.
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual',
      headers: {
        'Content-Type':
          'application/x-www-form-urlencoded;charset=UTF-8',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      body: typeof body === 'string' ? body : body.toString(),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Network error on Finalizar POST: ${String(
        error?.message || error,
      )}`,
    };
  }

  // 3xx / opaque redirect = PRG success (do not follow).
  if (
    response.type === 'opaqueredirect' ||
    response.status === 0 ||
    (response.status >= 300 && response.status < 400)
  ) {
    return {
      ok: true,
      status: response.status,
      message: 'Workday submitted via Finalizar API.',
    };
  }

  const text = await response.text();
  const snippet = text.slice(0, 8000);
  const lower = snippet.toLowerCase();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error:
        `Server responded ${response.status}. ` +
        truncate(stripTags(text), 240),
    };
  }

  if (
    /the provided anti-forgery token|antiforgery token was meant|antiforgery/i.test(
      snippet,
    ) &&
    /error|exception|invalid/i.test(snippet)
  ) {
    return {
      ok: false,
      status: response.status,
      error:
        'Antiforgery token rejected. Reload Finalizar and close the day again.',
    };
  }

  if (/validation.*error|error de validaci/i.test(lower)) {
    return {
      ok: false,
      status: response.status,
      error: `Portal validation: ${truncate(stripTags(text), 240)}`,
    };
  }

  return {
    ok: true,
    status: response.status,
    message: 'Workday submitted via Finalizar API.',
  };
}

/**
 * Decide cover vs edit. Editing without FinalizarAux must never fall back to
 * Id=0 / RegistroNuevo=True (that accumulates durations on Compensa).
 * @param {{ auxUrl?: string, mode?: 'edit' | 'cover' }} [options]
 * @returns {{ ok: true, kind: 'edit', auxUrl: string } | { ok: true, kind: 'cover' } | { ok: false, error: string }}
 */
export function resolveCloseKind(options = {}) {
  const auxUrl = String(options.auxUrl || '').trim();
  const mode =
    options.mode === 'edit' || options.mode === 'cover'
      ? options.mode
      : auxUrl
        ? 'edit'
        : 'cover';

  if (mode === 'edit') {
    if (!auxUrl || !/FinalizarAux/i.test(auxUrl)) {
      return {
        ok: false,
        error:
          'Edit without FinalizarAux URL: blocked to avoid accumulating hours. Press ↻ and try again.',
      };
    }
    return { ok: true, kind: 'edit', auxUrl };
  }

  if (auxUrl) {
    // Cover requested but aux present → treat as edit (safer).
    return { ok: true, kind: 'edit', auxUrl };
  }
  return { ok: true, kind: 'cover' };
}

/**
 * Full close flow for the content script.
 * @param {{ entry: string, exit: string, pause?: string, breakStart?: string, breakEnd?: string }} schedule
 * @param {Date|string} [date] Date instance or YYYY-MM-DD
 * @param {{ auxUrl?: string, mode?: 'edit' | 'cover' }} [options]
 */
export async function closeTodayViaApi(
  schedule,
  date = new Date(),
  options = {},
) {
  const targetDate = resolveCloseDate(date);
  if (!targetDate) {
    return { ok: false, error: 'Invalid date for closing the day.' };
  }

  const kind = resolveCloseKind(options);
  if (!kind.ok) {
    return kind;
  }

  const dayKey = sessionDayKey(targetDate);
  const guard = closeGuard();
  const pending = guard.inflight.get(dayKey);
  if (pending) {
    return pending;
  }

  const task = performClose(schedule, targetDate, kind, dayKey);
  guard.inflight.set(dayKey, task);
  try {
    return await task;
  } finally {
    if (guard.inflight.get(dayKey) === task) {
      guard.inflight.delete(dayKey);
    }
  }
}

/**
 * @param {{ entry: string, exit: string, pause?: string, breakStart?: string, breakEnd?: string }} schedule
 * @param {Date} targetDate
 * @param {{ kind: 'edit', auxUrl: string } | { kind: 'cover' }} kind
 * @param {string} dayKey
 */
async function performClose(schedule, targetDate, kind, dayKey) {
  /** @type {{ token: string, rhPersonaIdEncrypted: string, tipoDiaId: string, id?: string, isNew?: boolean }} */
  let meta;
  /** @type {string} */
  let postUrl;

  if (kind.kind === 'edit') {
    const loaded = await loadFinalizarAuxMeta(kind.auxUrl);
    if (!loaded.ok) {
      return loaded;
    }
    meta = loaded.meta;
    postUrl = loaded.postUrl;
    if (meta.isNew !== false || !meta.id || meta.id === '0') {
      return {
        ok: false,
        error:
          'FinalizarAux did not return a record Id. Not sending to avoid accumulating hours.',
      };
    }
  } else {
    if (!isFinalizarPage()) {
      return {
        ok: false,
        error:
          'Open Finalizar (“Summary of your workday”) in the portal and try again.',
      };
    }
    const collected = collectFinalizarMeta(document);
    if (!collected.ok) {
      return collected;
    }
    meta = { ...collected.meta, id: '0', isNew: true };
    postUrl = buildFinalizarUrl(location.href);
  }

  const body = buildFinalizarBody(schedule, meta, targetDate);
  // Hard stop: never POST an "edit" shaped as a new record.
  if (
    kind.kind === 'edit' &&
    (body.get('RegistroNuevo') !== 'False' || body.get('Id') === '0')
  ) {
    return {
      ok: false,
      error:
        'Invalid edit payload (Id/RegistroNuevo). Submission cancelled to avoid accumulation.',
    };
  }

  const payloadKey = [
    dayKey,
    kind.kind,
    meta.id || '0',
    schedule.entry || '',
    schedule.exit || '',
    schedule.pause || '',
  ].join('|');
  const guard = closeGuard();

  const replay = guard.recent.get(payloadKey);
  if (replay && Date.now() - replay.at < CLOSE_REPLAY_MS) {
    return replay.result;
  }

  if (kind.kind === 'cover' && guard.covers.has(dayKey)) {
    return {
      ok: false,
      error:
        'This day was already created in this session. Refresh and edit it instead of submitting it again.',
    };
  }

  return submitClose({
    body,
    postUrl,
    schedule,
    meta,
    targetDate,
    dayKey,
    payloadKey,
    isCover: kind.kind === 'cover',
  });
}

/**
 * @param {{
 *   body: URLSearchParams,
 *   postUrl: string,
 *   schedule: { entry: string, exit: string, pause?: string },
 *   meta: { id?: string, isNew?: boolean },
 *   targetDate: Date,
 *   dayKey: string,
 *   payloadKey: string,
 *   isCover: boolean,
 * }} input
 */
async function submitClose(input) {
  const {
    body,
    postUrl,
    schedule,
    meta,
    targetDate,
    dayKey,
    payloadKey,
    isCover,
  } = input;
  try {
    const result = await postFinalizar(body, postUrl);
    if (result.ok) {
      result.message =
        `Recorded ${formatDateDdMmYyyy(targetDate)} ` +
        `${schedule.entry}–${schedule.exit} ` +
        `(efectivo ${body.get('TiempoEfectivo')}s / pausa ${body.get(
          'TiempoPausa',
        )}s` +
        (meta.isNew === false ? `, Id ${meta.id}` : '') +
        ').';
      const guard = closeGuard();
      if (isCover) {
        guard.covers.add(dayKey);
      }
      guard.recent.set(payloadKey, { at: Date.now(), result });
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: `Network error on Finalizar POST: ${String(
        error?.message || error,
      )}`,
    };
  }
}

/**
 * @param {Date|string|undefined|null} value
 * @returns {Date | null}
 */
export function resolveCloseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        12,
        0,
        0,
      );
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (value == null) {
    return new Date();
  }
  return null;
}

export function isFinalizarPage() {
  return /RegistroHorario\/Finalizar/i.test(location.pathname);
}

function buildFinalizarUrl(pageUrl) {
  try {
    const current = new URL(pageUrl, location.origin);
    // Prefer an already-resolved Finalizar submit URL as-is.
    if (/RegistroHorario\/Finalizar(?!Aux)/i.test(current.pathname)) {
      return current.toString();
    }
    // Never POST to FinalizarAux — use the main Finalizar endpoint.
    if (/RegistroHorario\/FinalizarAux/i.test(current.pathname)) {
      return new URL(FINALIZAR_PATH, current.origin).toString();
    }
    const target = new URL(FINALIZAR_PATH, current.origin);
    // Keep encrypted context from the open Finalizar tab when present.
    if (current.search) {
      target.search = current.search;
    }
    return target.toString();
  } catch {
    return `${location.origin}${FINALIZAR_PATH}${location.search || ''}`;
  }
}

/**
 * Resolve where the FinalizarAux form would submit.
 * @param {Document} doc
 * @returns {string}
 */
function resolveFinalizarSubmitUrl(doc) {
  const form =
    doc.querySelector('form[action*="Finalizar"]') ||
    doc.querySelector('form[method="post" i]') ||
    doc.querySelector('form');
  const action = String(form?.getAttribute('action') || '').trim();
  if (action) {
    try {
      const url = new URL(action, location.origin);
      if (/RegistroHorario\/Finalizar/i.test(url.pathname)) {
        // Prefer plain Finalizar over Aux for the actual POST.
        if (/FinalizarAux/i.test(url.pathname)) {
          return new URL(FINALIZAR_PATH, location.origin).toString();
        }
        return url.toString();
      }
    } catch {
      // fall through
    }
  }
  return new URL(FINALIZAR_PATH, location.origin).toString();
}

function findExactNamedValue(doc, names) {
  for (const name of names) {
    const needle = name.toLowerCase();
    const nodes = doc.querySelectorAll('input, select, textarea');
    for (const el of nodes) {
      const id = String(el.id || '').toLowerCase();
      const nm = String(el.name || '').toLowerCase();
      if (id === needle || nm === needle) {
        const value = String(el.value || '').trim();
        if (value) {
          return value;
        }
      }
    }
  }
  return '';
}

function findNamedValue(doc, names) {
  for (const name of names) {
    const needle = name.toLowerCase();
    const nodes = doc.querySelectorAll('input, select, textarea');
    for (const el of nodes) {
      const id = String(el.id || '').toLowerCase();
      const nm = String(el.name || '').toLowerCase();
      if (
        id === needle ||
        nm === needle ||
        id.endsWith(`$${needle}`) ||
        nm.endsWith(`$${needle}`) ||
        id.endsWith(`_${needle}`) ||
        nm.endsWith(`_${needle}`)
      ) {
        const value = String(el.value || '').trim();
        if (value) {
          return value;
        }
      }
    }
  }
  return '';
}

function readSelectValue(doc, names) {
  for (const name of names) {
    const needle = name.toLowerCase();
    for (const el of doc.querySelectorAll('select')) {
      const id = String(el.id || '').toLowerCase();
      const nm = String(el.name || '').toLowerCase();
      const label = (
        el.getAttribute('aria-label') ||
        el.previousElementSibling?.textContent ||
        ''
      ).toLowerCase();
      if (
        id.includes(needle) ||
        nm.includes(needle) ||
        label.includes(needle) ||
        label.includes('day type') ||
        label.includes('tipo')
      ) {
        const value = String(el.value || '').trim();
        if (value) {
          return value;
        }
      }
    }
  }
  return '';
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
