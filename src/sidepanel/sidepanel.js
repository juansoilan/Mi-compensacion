import { MSG } from '../shared/messages.js';
import { mergeSettings } from '../shared/defaults.js';
import {
  DAY_STATUS,
  buildMonthGrid,
  isFutureDay,
  todayParts,
} from '../shared/gaps.js';
import {
  clockToMinutes,
  durationToMinutes,
  minutesToClock,
  normalizeClock,
  normalizePauseDuration,
} from '../shared/time.js';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const els = {
  banner: document.getElementById('statusBanner'),
  toast: document.getElementById('toast'),
  monthSelect: document.getElementById('monthSelect'),
  yearSelect: document.getElementById('yearSelect'),
  monthHint: document.getElementById('monthHint'),
  monthGrid: document.getElementById('monthGrid'),
  monthLoader: document.getElementById('monthLoader'),
  calWrap: document.querySelector('.cal-wrap'),
  btnPrevMonth: document.getElementById('btnPrevMonth'),
  btnNextMonth: document.getElementById('btnNextMonth'),
  confirmCard: document.getElementById('confirmCard'),
  confirmText: document.getElementById('confirmText'),
  confirmSchedule: document.getElementById('confirmSchedule'),
  confirmEntry: document.getElementById('confirmEntry'),
  confirmExit: document.getElementById('confirmExit'),
  confirmPause: document.getElementById('confirmPause'),
  batchWarn: document.getElementById('batchWarn'),
  batchWarnTitle: document.getElementById('batchWarnTitle'),
  batchWarnList: document.getElementById('batchWarnList'),
  timelineTrack: document.getElementById('timelineTrack'),
  timelineScale: document.getElementById('timelineScale'),
  timelineWork: document.getElementById('timelineWork'),
  timelineSummary: document.getElementById('timelineSummary'),
  chipEntry: document.getElementById('chipEntry'),
  chipExit: document.getElementById('chipExit'),
  chipPause: document.getElementById('chipPause'),
  btnConfirmSend: document.getElementById('btnConfirmSend'),
  btnConfirmCancel: document.getElementById('btnConfirmCancel'),
  batchConfirmDialog: document.getElementById('batchConfirmDialog'),
  batchDialogTitle: document.getElementById('batchDialogTitle'),
  batchDialogLead: document.getElementById('batchDialogLead'),
  batchDialogList: document.getElementById('batchDialogList'),
  batchDialogSchedule: document.getElementById('batchDialogSchedule'),
  btnBatchDialogConfirm: document.getElementById('btnBatchDialogConfirm'),
  btnBatchDialogCancel: document.getElementById('btnBatchDialogCancel'),
  btnRefresh: document.getElementById('btnRefresh'),
  selectionBar: document.getElementById('selectionBar'),
  selectionCount: document.getElementById('selectionCount'),
  btnClearSelection: document.getElementById('btnClearSelection'),
  calTooltip: document.getElementById('calTooltip'),
};

/** Timeline visible window (minutes from midnight). */
const TIMELINE_START = 7 * 60;
const TIMELINE_END = 21 * 60;
const TIMELINE_SPAN = TIMELINE_END - TIMELINE_START;
const SNAP_MINUTES = 15;
const MIN_SEGMENT = 15;

/** @type {null | { kind: string, startX: number, origin: object }} */
let timelineDrag = null;

/** @type {WeakMap<Element, object>} */
const cellTooltipData = new WeakMap();
/** @type {Element | null} */
let tipAnchor = null;

/** @type {ReturnType<typeof mergeSettings>} */
let settings = mergeSettings(null);
/** @type {null | object} */
let monthState = null;
/** @type {boolean} */
let finalizarReady = false;
/** @type {{ year: number, month: number }} */
let view = (() => {
  const t = todayParts();
  return { year: t.year, month: t.month };
})();
/** @type {Set<string>} */
const selectedIsos = new Set();
/** @type {Set<string>} */
const updatingIsos = new Set();
/**
 * Metadata for selected / clickable days (label + mode).
 * @type {Map<string, { mode: 'edit' | 'cover', label: string, auxUrl: string }>}
 */
const dayMeta = new Map();
/** @type {boolean} */
let isBatchSending = false;
/** @type {boolean} */
let isMonthLoading = false;
/** @type {number} */
let portalReloadTimer = 0;
/** @type {number} */
let toastTimer = 0;
/**
 * Empty selection on the current month selects today.
 * Turns off when the user clears the selection on purpose.
 * @type {boolean}
 */
let preferTodaySelection = true;
/** @type {string | null} Last selection the confirm panel was synced to. */
let confirmSelectionKey = null;

init();

async function init() {
  await loadSettings();
  fillMonthSelectOptions();
  wireEvents();
  syncMonthSelect();
  renderCalendarView();
  await refreshMonth();
}

function wireEvents() {
  els.btnRefresh.addEventListener('click', () => refreshMonth());
  els.btnPrevMonth.addEventListener('click', () => shiftMonth(-1));
  els.btnNextMonth.addEventListener('click', () => shiftMonth(1));
  els.monthSelect.addEventListener('change', () => applyViewFromSelects());
  els.yearSelect.addEventListener('change', () => applyViewFromSelects());
  els.btnConfirmCancel.addEventListener('click', () => {
    resetSelectionToToday();
  });
  els.btnConfirmSend.addEventListener('click', () => onConfirmSendClick());
  els.btnClearSelection.addEventListener('click', () => {
    clearSelection();
    preferTodaySelection = false;
    syncConfirmPanel();
  });
  els.btnBatchDialogConfirm?.addEventListener('click', () => {
    hideBatchConfirmDialog();
    confirmAndClose();
  });
  els.batchConfirmDialog?.addEventListener('click', (event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('[data-batch-dismiss]')
    ) {
      hideBatchConfirmDialog();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      els.batchConfirmDialog &&
      !els.batchConfirmDialog.hidden
    ) {
      hideBatchConfirmDialog();
    }
  });
  wireTimeline();
  watchPortalSession();
  els.monthGrid.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-iso]');
    if (!btn || btn.disabled || isBatchSending) {
      return;
    }
    const iso = btn.dataset.iso;
    if (!iso || updatingIsos.has(iso)) {
      return;
    }
    toggleDaySelection(btn);
  });
  els.monthGrid.addEventListener('pointerover', (event) => {
    const cell = event.target.closest('.cal-cell');
    if (!cell || !els.monthGrid.contains(cell)) {
      return;
    }
    const related = event.relatedTarget;
    if (related instanceof Node && cell.contains(related)) {
      return;
    }
    showCalTooltip(cell);
  });
  els.monthGrid.addEventListener('pointerout', (event) => {
    const cell = event.target.closest('.cal-cell');
    if (!cell || !els.monthGrid.contains(cell)) {
      return;
    }
    const related = event.relatedTarget;
    if (related instanceof Node && cell.contains(related)) {
      return;
    }
    if (tipAnchor === cell) {
      hideCalTooltip();
    }
  });
  els.monthGrid.addEventListener('focusin', (event) => {
    const cell = event.target.closest('.cal-cell');
    if (cell) {
      showCalTooltip(cell);
    }
  });
  els.monthGrid.addEventListener('focusout', (event) => {
    const cell = event.target.closest('.cal-cell');
    const next = event.relatedTarget;
    if (cell && tipAnchor === cell) {
      if (!(next instanceof Node && cell.contains(next))) {
        hideCalTooltip();
      }
    }
  });
  window.addEventListener('scroll', () => hideCalTooltip(), true);
  window.addEventListener('resize', () => hideCalTooltip());
}

function shiftMonth(delta) {
  let { year, month } = view;
  month += delta;
  if (month < 1) {
    month = 12;
    year -= 1;
  } else if (month > 12) {
    month = 1;
    year += 1;
  }
  view = { year, month };
  fillYearOptions();
  fillMonthOptions();
  syncMonthSelect();
  clearSelection();
  preferTodaySelection = true;
  syncConfirmPanel();
  refreshMonth({ keepView: true });
}

/** Years: this year back three years, plus whatever the arrows have reached. */
function fillYearOptions() {
  const t = todayParts();
  const years = new Set();
  for (let year = t.year; year >= t.year - 3; year -= 1) {
    years.add(year);
  }
  years.add(view.year);
  const frag = document.createDocumentFragment();
  for (const year of [...years].sort((a, b) => b - a)) {
    const opt = document.createElement('option');
    opt.value = String(year);
    opt.textContent = String(year);
    frag.appendChild(opt);
  }
  els.yearSelect.replaceChildren(frag);
}

/** Months of the selected year. Future months stay out unless already in view. */
function fillMonthOptions() {
  const t = todayParts();
  let last = 12;
  if (view.year > t.year) {
    last = view.month;
  } else if (view.year === t.year) {
    last = Math.max(t.month, view.month);
  }
  const frag = document.createDocumentFragment();
  for (let month = 1; month <= last; month += 1) {
    if (view.year === t.year && month > t.month && month !== view.month) {
      continue;
    }
    const opt = document.createElement('option');
    opt.value = String(month);
    opt.textContent = MONTH_NAMES[month - 1];
    frag.appendChild(opt);
  }
  els.monthSelect.replaceChildren(frag);
}

function fillMonthSelectOptions() {
  fillYearOptions();
  fillMonthOptions();
  syncMonthSelect();
}

function syncMonthSelect() {
  const year = String(view.year);
  const month = String(view.month);
  if (![...els.yearSelect.options].some((o) => o.value === year)) {
    fillYearOptions();
  }
  if (![...els.monthSelect.options].some((o) => o.value === month)) {
    fillMonthOptions();
  }
  if (els.yearSelect.value !== year) {
    els.yearSelect.value = year;
  }
  if (els.monthSelect.value !== month) {
    els.monthSelect.value = month;
  }
}

function applyViewFromSelects() {
  const year = Number(els.yearSelect.value);
  let month = Number(els.monthSelect.value);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return;
  }
  const t = todayParts();
  if (year === t.year && month > t.month) {
    month = t.month;
  }
  view = { year, month };
  fillMonthOptions();
  syncMonthSelect();
  clearSelection();
  preferTodaySelection = true;
  syncConfirmPanel();
  refreshMonth({ keepView: true });
}

async function loadSettings() {
  const response = await chrome.runtime.sendMessage({ type: MSG.GET_SETTINGS });
  settings = mergeSettings(response?.settings);
  // Drop legacy local overrides — calendar must mirror the portal only.
  await chrome.storage.local.remove('mchClosedDays');
}

/**
 * Persist schedule used on the last send as default for next days.
 * @param {{ entry: string, exit: string, pause: string }} schedule
 */
async function saveScheduleAsDefault(schedule) {
  const next = mergeSettings({
    ...settings,
    schedule,
  });
  const response = await chrome.runtime.sendMessage({
    type: MSG.SAVE_SETTINGS,
    settings: next,
  });
  settings = mergeSettings(response?.settings || next);
}

/**
 * @param {{ keepView?: boolean, automatic?: boolean }} [opts]
 */
async function refreshMonth(opts = {}) {
  if (
    opts.automatic &&
    (isMonthLoading ||
      isBatchSending ||
      (monthState?.recognized && portalMatchesView()))
  ) {
    return;
  }
  isMonthLoading = true;
  if (!opts.keepView) {
    clearSelection();
    preferTodaySelection = true;
  }
  clearBanner();
  setMonthLoading(true);
  try {
    const tab = await findPortalTab();
    if (!tab?.id) {
      monthState = null;
      renderDisconnected(
        'No micompensacion.com tab is open. Sign in with SSO and refresh.',
      );
      return;
    }

    await ensureContentScript(tab);
    finalizarReady = await detectFinalizarFrame(tab.id);
    const month = await sendToTab(tab.id, {
      type: MSG.GET_MONTH,
      year: view.year,
      month: view.month,
      force: true,
    });
    if (!month?.ok && month?.recognized === undefined) {
      throw new Error(month?.error || 'Could not read the month.');
    }
    monthState = month;
    if (
      !opts.keepView &&
      month.recognized &&
      month.year &&
      month.month
    ) {
      view = { year: month.year, month: month.month };
    }
    renderCalendarView();
    if (!month.recognized) {
      showBanner(
        'warn',
        month.reason ||
          (finalizarReady
            ? 'The workday summary is open. Select weekdays to fill them in.'
            : 'Sign in on Mi Compensación, then press refresh.'),
      );
    } else {
      clearBanner();
    }
  } catch (error) {
    monthState = null;
    finalizarReady = false;
    renderDisconnected(friendlyConnectionError(error));
  } finally {
    isMonthLoading = false;
    setMonthLoading(false);
  }
}

/** Reload the month when the portal finishes loading and we still have no data. */
function watchPortalSession() {
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status !== 'complete') {
      return;
    }
    const url = tab?.url || info.url || '';
    if (!isPortalUrl(url)) {
      return;
    }
    window.clearTimeout(portalReloadTimer);
    portalReloadTimer = window.setTimeout(() => {
      refreshMonth({ keepView: true, automatic: true });
    }, 400);
  });
}

/** @param {boolean} isLoading */
function setMonthLoading(isLoading) {
  if (els.monthLoader) {
    els.monthLoader.hidden = !isLoading;
  }
  els.calWrap?.classList.toggle('is-loading', isLoading);
  els.btnPrevMonth.disabled = isLoading;
  els.btnNextMonth.disabled = isLoading;
  els.monthSelect.disabled = isLoading;
  els.yearSelect.disabled = isLoading;
  els.btnRefresh.disabled = isLoading;
  els.btnRefresh.classList.toggle('is-loading', isLoading);
  if (els.btnClearSelection) {
    els.btnClearSelection.disabled = isLoading || isBatchSending;
  }
  if (isLoading) {
    setMonthHint('');
  }
}

/**
 * @param {HTMLElement} btn
 */
function toggleDaySelection(btn) {
  const iso = btn.dataset.iso;
  if (!iso) {
    return;
  }
  dayMeta.set(iso, {
    mode: btn.dataset.mode === 'edit' ? 'edit' : 'cover',
    label: btn.dataset.label || '',
    auxUrl: btn.dataset.auxUrl || '',
  });
  if (selectedIsos.has(iso)) {
    selectedIsos.delete(iso);
  } else {
    selectedIsos.add(iso);
  }
  btn.classList.toggle('is-selected', selectedIsos.has(iso));
  if (selectedIsos.size === 0) {
    preferTodaySelection = false;
  }
  syncSelectionBar();
  syncConfirmPanel({ scroll: selectedIsos.size > 0 });
}

function clearSelection() {
  selectedIsos.clear();
  confirmSelectionKey = null;
  syncSelectionBar();
  for (const cell of els.monthGrid.querySelectorAll('.is-selected')) {
    cell.classList.remove('is-selected');
  }
}

function syncSelectionBar() {
  const count = selectedIsos.size;
  if (!els.selectionBar) {
    return;
  }
  els.selectionBar.hidden = count === 0;
  if (els.selectionCount) {
    els.selectionCount.textContent =
      count === 1 ? '1 day' : `${count} days`;
  }
  if (els.btnClearSelection) {
    els.btnClearSelection.disabled = isBatchSending;
  }
}

function sortedSelectedIsos() {
  return [...selectedIsos].sort();
}

/**
 * Select today when the open month is the current one and nothing is selected.
 * @param {Set<string>} clickableIsos
 */
function selectTodayByDefault(clickableIsos) {
  if (!preferTodaySelection || selectedIsos.size > 0) {
    return;
  }
  const today = todayParts();
  if (!clickableIsos.has(today.iso)) {
    return;
  }
  selectedIsos.add(today.iso);
  const cell = els.monthGrid.querySelector(`[data-iso="${today.iso}"]`);
  cell?.classList.add('is-selected');
}

/** Restore the default: today selected, confirm panel still visible. */
function resetSelectionToToday() {
  if (isBatchSending) {
    return;
  }
  const today = todayParts();
  const onTodayMonth =
    view.year === today.year && view.month === today.month;
  clearSelection();
  preferTodaySelection = true;
  if (!onTodayMonth) {
    view = { year: today.year, month: today.month };
    fillYearOptions();
    fillMonthOptions();
    syncMonthSelect();
    syncConfirmPanel();
    refreshMonth({ keepView: true });
    return;
  }
  const cell = els.monthGrid.querySelector(`[data-iso="${today.iso}"]`);
  if (cell) {
    selectedIsos.add(today.iso);
    cell.classList.add('is-selected');
  }
  syncSelectionBar();
  syncConfirmPanel({ forceSchedule: true });
}

function syncSubmitEnabled() {
  els.btnConfirmSend.disabled =
    isBatchSending || selectedIsos.size === 0;
}

/**
 * Keep the confirm card visible and aligned with the current selection.
 * @param {{ scroll?: boolean, forceSchedule?: boolean }} [opts]
 */
function syncConfirmPanel({ scroll = false, forceSchedule = false } = {}) {
  const key = sortedSelectedIsos().join(',');
  const selectionChanged = key !== confirmSelectionKey;
  if (!key) {
    showConfirmIdle();
    return;
  }
  showConfirmForSelection({
    scroll: scroll && selectionChanged,
    applySchedule: forceSchedule || selectionChanged,
  });
  confirmSelectionKey = key;
}

/** Confirm card with no days selected. The card itself stays on screen. */
function showConfirmIdle() {
  hideBatchWarn();
  const confirmTitle = els.confirmCard.querySelector('h2');
  if (confirmTitle) {
    confirmTitle.textContent = 'Confirm submission';
  }
  els.confirmText.textContent =
    'Select at least one day on the calendar.';
  els.btnConfirmSend.textContent = 'Submit';
  els.confirmCard.hidden = false;
  if (confirmSelectionKey !== '') {
    setScheduleInputs({
      entry: normalizeClock(settings.schedule.entry),
      exit: normalizeClock(settings.schedule.exit),
      pause: normalizePauseDuration(settings.schedule.pause),
    });
    paintTimeline();
  }
  confirmSelectionKey = '';
  syncSubmitEnabled();
}

/**
 * @param {{ scroll?: boolean, applySchedule?: boolean }} [opts]
 */
function showConfirmForSelection({
  scroll = false,
  applySchedule = true,
} = {}) {
  const isos = sortedSelectedIsos();
  if (!isos.length) {
    showConfirmIdle();
    return;
  }

  if (applySchedule) {
    let entry = settings.schedule.entry;
    let exit = settings.schedule.exit;
    if (isos.length === 1) {
      const meta = dayMeta.get(isos[0]);
      const fromLabel = parseTimeLabel(meta?.label);
      if (fromLabel) {
        entry = fromLabel.entry;
        exit = fromLabel.exit;
      }
    }
    setScheduleInputs({
      entry: normalizeClock(entry),
      exit: normalizeClock(exit),
      pause: normalizePauseDuration(settings.schedule.pause),
    });
    paintTimeline();
  }

  const allEdit = isos.every(
    (iso) => dayMeta.get(iso)?.mode === 'edit',
  );
  const confirmTitle = els.confirmCard.querySelector('h2');
  if (confirmTitle) {
    if (isos.length > 1) {
      confirmTitle.textContent = allEdit
        ? `Update ${isos.length} workdays`
        : `Submit ${isos.length} days`;
    } else {
      confirmTitle.textContent = allEdit
        ? 'Update workday'
        : 'Confirm submission';
    }
  }
  els.btnConfirmSend.textContent =
    isos.length > 1
      ? allEdit
        ? `Update ${isos.length} days`
        : `Submit ${isos.length} days`
      : allEdit
        ? 'Update'
        : 'Submit';

  if (isos.length === 1) {
    const meta = dayMeta.get(isos[0]);
    els.confirmText.textContent =
      meta?.mode === 'edit'
        ? `${isos[0]} will be updated` +
          (meta.label ? ` (now ${meta.label})` : '') +
          '.'
        : `The record for ${isos[0]} will be submitted.`;
    hideBatchWarn();
  } else {
    const editCount = isos.filter(
      (iso) => dayMeta.get(iso)?.mode === 'edit',
    ).length;
    const coverCount = isos.length - editCount;
    els.confirmText.textContent =
      `You are about to apply one schedule to ${isos.length} days. ` +
      `All of them will be changed.`;
    showBatchWarn(isos, { editCount, coverCount });
  }

  els.confirmCard.hidden = false;
  syncSubmitEnabled();
  if (scroll) {
    els.confirmCard.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }
}

/**
 * @param {string[]} isos
 * @param {{ editCount: number, coverCount: number }} counts
 */
function showBatchWarn(isos, counts) {
  if (!els.batchWarn || !els.batchWarnTitle || !els.batchWarnList) {
    return;
  }
  const parts = [];
  if (counts.editCount) {
    parts.push(
      `${counts.editCount} already recorded ` +
        (counts.editCount === 1 ? 'day' : 'days') +
        ' will be overwritten',
    );
  }
  if (counts.coverCount) {
    parts.push(
      `${counts.coverCount} empty ` +
        (counts.coverCount === 1 ? 'day' : 'days') +
        ' will be filled',
    );
  }
  els.batchWarnTitle.textContent =
    parts.join('. ') + (parts.length ? '.' : '');
  els.batchWarnList.replaceChildren();
  for (const iso of isos) {
    const li = document.createElement('li');
    const meta = dayMeta.get(iso);
    const mode = meta?.mode === 'edit' ? 'update' : 'new';
    li.textContent = meta?.label
      ? `${iso} · ${meta.label} (${mode})`
      : `${iso} (${mode})`;
    els.batchWarnList.appendChild(li);
  }
  els.batchWarn.hidden = false;
}

function hideBatchWarn() {
  if (els.batchWarn) {
    els.batchWarn.hidden = true;
  }
  if (els.batchWarnList) {
    els.batchWarnList.replaceChildren();
  }
}

/** First click on Submit for multi-day → confirmation dialog. */
function onConfirmSendClick() {
  const isos = sortedSelectedIsos();
  if (isos.length <= 1) {
    confirmAndClose();
    return;
  }
  showBatchConfirmDialog(isos);
}

/**
 * @param {string[]} isos
 */
function showBatchConfirmDialog(isos) {
  const dialog = els.batchConfirmDialog;
  if (!dialog) {
    confirmAndClose();
    return;
  }
  const schedule = {
    entry: els.confirmEntry?.value || settings.schedule.entry,
    exit: els.confirmExit?.value || settings.schedule.exit,
    pause:
      els.confirmPause?.value || settings.schedule.pause,
  };
  const editCount = isos.filter(
    (iso) => dayMeta.get(iso)?.mode === 'edit',
  ).length;
  const coverCount = isos.length - editCount;

  if (els.batchDialogTitle) {
    els.batchDialogTitle.textContent =
      `Modify ${isos.length} days?`;
  }
  if (els.batchDialogLead) {
    const bits = [];
    if (editCount) {
      bits.push(
        `${editCount} recorded ` +
          (editCount === 1 ? 'day' : 'days') +
          ' will be overwritten',
      );
    }
    if (coverCount) {
      bits.push(
        `${coverCount} empty ` +
          (coverCount === 1 ? 'day' : 'days') +
          ' will be created',
      );
    }
    els.batchDialogLead.textContent =
      `You are about to change all of the following days with the same schedule. ` +
      bits.join('. ') +
      (bits.length ? '.' : '');
  }
  if (els.batchDialogList) {
    els.batchDialogList.replaceChildren();
    for (const iso of isos) {
      const li = document.createElement('li');
      const meta = dayMeta.get(iso);
      li.textContent = meta?.label
        ? `${iso} · ${meta.label}`
        : iso;
      els.batchDialogList.appendChild(li);
    }
  }
  if (els.batchDialogSchedule) {
    els.batchDialogSchedule.textContent =
      `Schedule: ${schedule.entry}–${schedule.exit}, ` +
      `break ${formatDurationLabel(durationToMinutes(schedule.pause) || 0)}`;
  }
  if (els.btnBatchDialogConfirm) {
    els.btnBatchDialogConfirm.textContent =
      `Yes, update all ${isos.length}`;
  }
  dialog.hidden = false;
  els.btnBatchDialogConfirm?.focus();
}

function hideBatchConfirmDialog() {
  if (els.batchConfirmDialog) {
    els.batchConfirmDialog.hidden = true;
  }
}

/** @param {string} [label] */
function parseTimeLabel(label) {
  const match = String(label || '').match(
    /(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/,
  );
  if (!match) {
    return null;
  }
  return {
    entry: normalizeClock(match[1]),
    exit: normalizeClock(match[2]),
  };
}

function readScheduleInputs() {
  return {
    entry: normalizeClock(els.confirmEntry?.value || settings.schedule.entry),
    exit: normalizeClock(els.confirmExit?.value || settings.schedule.exit),
    pause: normalizePauseDuration(
      els.confirmPause?.value || settings.schedule.pause,
    ),
  };
}

/**
 * @param {{ entry: string, exit: string, pause: string }} schedule
 */
function setScheduleInputs(schedule) {
  if (els.confirmEntry) els.confirmEntry.value = schedule.entry;
  if (els.confirmExit) els.confirmExit.value = schedule.exit;
  if (els.confirmPause) {
    els.confirmPause.value = schedule.pause;
  }
  syncChipInputs(schedule);
}

/**
 * Keep visible time inputs in sync with hidden schedule fields.
 * @param {{ entry: string, exit: string, pause: string }} schedule
 */
function syncChipInputs(schedule) {
  if (els.chipEntry && els.chipEntry !== document.activeElement) {
    els.chipEntry.value = schedule.entry;
  }
  if (els.chipExit && els.chipExit !== document.activeElement) {
    els.chipExit.value = schedule.exit;
  }
  if (els.chipPause && els.chipPause !== document.activeElement) {
    ensurePauseOption(schedule.pause);
    els.chipPause.value = schedule.pause;
  }
}

/** @param {string} pauseHhMm */
function ensurePauseOption(pauseHhMm) {
  const select = els.chipPause;
  if (!select) {
    return;
  }
  const value = normalizePauseDuration(pauseHhMm);
  for (const opt of select.options) {
    if (opt.value === value) {
      return;
    }
  }
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = formatDurationLabel(durationToMinutes(value) || 0);
  select.appendChild(opt);
}

/** @param {number} minutes */
function snapMinutes(minutes) {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** @param {number} minutes */
function minutesToPercent(minutes) {
  const pct =
    ((minutes - TIMELINE_START) / TIMELINE_SPAN) * 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * @param {number} clientX
 * @returns {number} minutes from midnight (snapped)
 */
function clientXToMinutes(clientX) {
  const track = els.timelineTrack;
  if (!track) {
    return TIMELINE_START;
  }
  const rect = track.getBoundingClientRect();
  const ratio = rect.width
    ? (clientX - rect.left) / rect.width
    : 0;
  const raw =
    TIMELINE_START +
    Math.max(0, Math.min(1, ratio)) * TIMELINE_SPAN;
  return snapMinutes(raw);
}

function paintTimelineScale() {
  const marks = els.timelineScale?.querySelectorAll('[data-minutes]');
  if (!marks?.length) {
    return;
  }
  marks.forEach((mark, index) => {
    const minutes = Number(mark.dataset.minutes);
    const pct = minutesToPercent(minutes);
    mark.style.left = `${pct}%`;
    if (index === 0) {
      mark.style.transform = 'none';
    } else if (index === marks.length - 1) {
      mark.style.transform = 'translateX(-100%)';
    } else {
      mark.style.transform = 'translateX(-50%)';
    }
  });
}

function paintTimeline() {
  paintTimelineScale();
  const schedule = readScheduleInputs();
  let entry = clockToMinutes(schedule.entry) ?? 9 * 60;
  let exit = clockToMinutes(schedule.exit) ?? 18 * 60;
  const pauseMin = Math.max(
    0,
    durationToMinutes(schedule.pause) ?? 60,
  );

  if (exit < entry + MIN_SEGMENT) {
    exit = entry + MIN_SEGMENT;
  }

  const fixed = {
    entry: minutesToClock(entry),
    exit: minutesToClock(exit),
    pause: normalizePauseDuration(schedule.pause),
  };
  setScheduleInputs(fixed);

  if (els.timelineWork) {
    const left = minutesToPercent(entry);
    const right = minutesToPercent(exit);
    els.timelineWork.style.left = `${left}%`;
    els.timelineWork.style.width = `${Math.max(0, right - left)}%`;
  }

  const handles = els.timelineTrack?.querySelectorAll('[data-handle]');
  if (handles) {
    for (const handle of handles) {
      const key = handle.getAttribute('data-handle');
      const map = { entry, exit };
      const mins = map[key];
      if (typeof mins === 'number') {
        handle.style.left = `${minutesToPercent(mins)}%`;
      }
    }
  }

  const workMin = Math.max(0, exit - entry - pauseMin);
  if (els.timelineSummary) {
    const work = formatDurationLabel(workMin);
    const pause = formatDurationLabel(pauseMin);
    els.timelineSummary.textContent =
      `Work ${work} · Break ${pause}`;
  }
}

/** @param {number} minutes */
function formatDurationLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) {
    return `${h}h`;
  }
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function wireTimeline() {
  const chipInputs = [
    els.chipEntry,
    els.chipExit,
    els.chipPause,
  ].filter(Boolean);

  for (const input of chipInputs) {
    input.addEventListener('change', applyChipSchedule);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
        applyChipSchedule();
      }
    });
  }

  const track = els.timelineTrack;
  if (!track) {
    return;
  }

  track.addEventListener('pointerdown', (event) => {
    if (isBatchSending || els.confirmCard?.hidden) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const handle = target.closest('[data-handle]');
    if (!handle) {
      return;
    }
    event.preventDefault();
    const schedule = readScheduleInputs();
    timelineDrag = {
      kind: handle.getAttribute('data-handle') || 'entry',
      startX: event.clientX,
      origin: {
        entry: clockToMinutes(schedule.entry) ?? 9 * 60,
        exit: clockToMinutes(schedule.exit) ?? 18 * 60,
        pause: schedule.pause,
      },
    };
    track.setPointerCapture?.(event.pointerId);
  });

  track.addEventListener('pointermove', (event) => {
    if (!timelineDrag) {
      return;
    }
    applyTimelineDrag(event.clientX);
  });

  const endDrag = (event) => {
    if (!timelineDrag) {
      return;
    }
    applyTimelineDrag(event.clientX);
    timelineDrag = null;
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
}

/** Apply values from Start / End / Break controls. */
function applyChipSchedule() {
  if (isBatchSending || els.confirmCard?.hidden) {
    return;
  }
  const entry = normalizeClock(
    els.chipEntry?.value || settings.schedule.entry,
  );
  const exit = normalizeClock(
    els.chipExit?.value || settings.schedule.exit,
  );
  const pause = normalizePauseDuration(
    els.chipPause?.value || settings.schedule.pause,
  );
  setScheduleInputs({ entry, exit, pause });
  paintTimeline();
}

/** @param {number} clientX */
function applyTimelineDrag(clientX) {
  if (!timelineDrag) {
    return;
  }
  const { kind, origin } = timelineDrag;
  let { entry, exit } = origin;
  const minutes = clientXToMinutes(clientX);

  if (kind === 'entry') {
    entry = Math.min(minutes, exit - MIN_SEGMENT);
    entry = Math.max(TIMELINE_START, entry);
  } else if (kind === 'exit') {
    exit = Math.max(minutes, entry + MIN_SEGMENT);
    exit = Math.min(TIMELINE_END, exit);
  }

  setScheduleInputs({
    entry: minutesToClock(entry),
    exit: minutesToClock(exit),
    pause: origin.pause || settings.schedule.pause,
  });
  paintTimeline();
}

/**
 * @param {string} iso
 * @param {boolean} isUpdating
 */
function setCellUpdating(iso, isUpdating) {
  if (isUpdating) {
    updatingIsos.add(iso);
  } else {
    updatingIsos.delete(iso);
  }
  const cell = els.monthGrid.querySelector(`[data-iso="${iso}"]`);
  if (!cell) {
    return;
  }
  cell.classList.toggle('is-updating', isUpdating);
  if (cell instanceof HTMLButtonElement) {
    cell.disabled = isUpdating;
  }
}

async function confirmAndClose() {
  const isos = sortedSelectedIsos();
  if (!isos.length) {
    showToast('danger', 'Select at least one day on the calendar.');
    return;
  }
  const tab = await findPortalTab();
  if (!tab?.id) {
    showToast('danger', 'No portal tab found.');
    return;
  }

  const schedule = {
    entry: els.confirmEntry.value || settings.schedule.entry,
    exit: els.confirmExit.value || settings.schedule.exit,
    pause: els.confirmPause.value || settings.schedule.pause,
  };

  isBatchSending = true;
  syncSubmitEnabled();
  syncSelectionBar();

  let okCount = 0;
  let failCount = 0;
  /** @type {string[]} */
  const failedIsos = [];
  /** @type {string[]} */
  const failReasons = [];

  try {
    await ensureContentScript(tab);

    for (const iso of isos) {
      setCellUpdating(iso, true);
      try {
        const meta = dayMeta.get(iso);
        const mode = meta?.mode === 'edit' ? 'edit' : 'cover';
        const auxUrl = String(meta?.auxUrl || '').trim();
        // Never send an edit as a new Finalizar (Id=0) — that accumulates.
        if (mode === 'edit' && !/FinalizarAux/i.test(auxUrl)) {
          throw new Error(
            'Missing FinalizarAux; edit blocked to avoid accumulating hours.',
          );
        }
        const result = await sendToTab(tab.id, {
          type: MSG.CLOSE_TODAY,
          confirmed: true,
          schedule,
          date: iso,
          mode,
          auxUrl,
        });
        if (!result?.ok) {
          throw new Error(result?.error || 'The portal rejected the submission.');
        }
        selectedIsos.delete(iso);
        okCount += 1;
      } catch (error) {
        failCount += 1;
        failedIsos.push(iso);
        failReasons.push(
          `${iso}: ${String(error?.message || error).slice(0, 120)}`,
        );
      } finally {
        setCellUpdating(iso, false);
      }
    }

    if (okCount > 0) {
      await saveScheduleAsDefault(schedule);
    }

    syncSelectionBar();

    /** @type {{ kind: string, text: string } | null} */
    let resultBanner = null;
    if (failCount === 0) {
      resultBanner = {
        kind: 'ok',
        text:
          okCount === 1
            ? 'Submitted successfully.'
            : `${okCount} days recorded successfully.`,
      };
    } else if (okCount === 0) {
      resultBanner = {
        kind: 'danger',
        text:
          `Could not record any day (${failCount} failed).` +
          (failReasons[0] ? ` ${failReasons[0]}` : ''),
      };
    } else {
      resultBanner = {
        kind: 'warn',
        text:
          `${okCount} ok, ${failCount} failed` +
          (failedIsos.length ? `: ${failedIsos.join(', ')}` : '') +
          (failReasons[0] ? ` — ${failReasons[0]}` : '') +
          '.',
      };
    }

    await refreshMonth({ keepView: true });
    if (resultBanner) {
      showToast(resultBanner.kind, resultBanner.text);
    }
  } catch (error) {
    showToast('danger', friendlyConnectionError(error));
  } finally {
    isBatchSending = false;
    for (const iso of [...updatingIsos]) {
      setCellUpdating(iso, false);
    }
    syncSelectionBar();
    syncSubmitEnabled();
  }
}

/**
 * Inject the content script if the tab has no listener yet
 * (common after loading/reloading the unpacked extension).
 */
async function ensureContentScript(tab) {
  try {
    const ping = await sendToBestFrame(tab.id, { type: MSG.PING });
    if (ping?.ok) {
      return;
    }
  } catch {
    // Fall through to programmatic injection.
  }

  if (!tab.url || !isPortalUrl(tab.url)) {
    throw new Error(
      'The active tab is not micompensacion.com. Open the portal with SSO.',
    );
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ['src/content/boot.js'],
  });

  const ping = await sendToBestFrame(tab.id, { type: MSG.PING });
  if (!ping?.ok) {
    throw new Error(
      'Could not connect to the portal tab after injecting the script.',
    );
  }
}

function sendToTab(tabId, message) {
  return sendToBestFrame(tabId, message);
}

/**
 * Talk to every portal frame (Compensa often puts the timesheet in an iframe).
 * Prefer the frame that recognizes the month calendar.
 */
async function sendToBestFrame(tabId, message) {
  const frameIds = await listPortalFrameIds(tabId);

  // Mis registros API only needs one same-origin frame (shared cookies).
  if (message.type === MSG.GET_MONTH) {
    const target = await pickMonthFrame(tabId, frameIds);
    try {
      return await chrome.tabs.sendMessage(tabId, message, {
        frameId: target,
      });
    } catch {
      return chrome.tabs.sendMessage(tabId, message);
    }
  }

  // A close must be delivered once. Broadcasting it posts Finalizar in
  // every matching frame, and a second send to the winner posts again.
  // Compensa adds durations on each new record.
  if (message.type === MSG.CLOSE_TODAY) {
    return sendCloseOnce(tabId, message, frameIds);
  }

  const results = [];

  for (const frameId of frameIds) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message, {
        frameId,
      });
      if (response) {
        results.push({ frameId, response });
      }
    } catch {
      // Frame without content script or restricted.
    }
  }

  if (!results.length) {
    return chrome.tabs.sendMessage(tabId, message);
  }

  return results[0].response;
}

/**
 * Ping every frame, then POST the close to exactly one of them.
 * Do not retry on another frame: the first request may already have
 * been accepted, and a second new record would accumulate hours.
 * @param {number} tabId
 * @param {object} message
 * @param {number[]} frameIds
 */
async function sendCloseOnce(tabId, message, frameIds) {
  const ranked = [];
  for (const frameId of frameIds) {
    try {
      const ping = await chrome.tabs.sendMessage(
        tabId,
        { type: MSG.PING },
        { frameId },
      );
      const href = ping?.href || '';
      const isFinalizar = /RegistroHorario\/Finalizar/i.test(href);
      ranked.push({
        frameId,
        score: (ping?.workdayScore || 0) + (isFinalizar ? 1000 : 0),
      });
    } catch {
      // Frame without a listener.
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  const target = ranked[0];
  // Edits via FinalizarAux only need any same-origin portal frame.
  const canEditViaAux =
    Boolean(message.auxUrl) || message.mode === 'edit';
  if (!target || (!canEditViaAux && target.score < 25)) {
    return {
      ok: false,
      error:
        'Finalizar (“Summary of your workday”) not found. Open it in the portal and try again.',
    };
  }
  return chrome.tabs.sendMessage(tabId, message, {
    frameId: target.frameId,
  });
}

/**
 * Prefer Finalizar or any RegistroHorario frame for month API.
 */
async function pickMonthFrame(tabId, frameIds) {
  const ranked = [];
  for (const frameId of frameIds) {
    try {
      const ping = await chrome.tabs.sendMessage(
        tabId,
        { type: MSG.PING },
        { frameId },
      );
      const href = ping?.href || '';
      let score = ping?.workdayScore || 0;
      if (/RegistroHorario/i.test(href)) {
        score += 50;
      }
      if (/MisRegistros/i.test(href)) {
        score += 80;
      }
      if (/Finalizar/i.test(href)) {
        score += 40;
      }
      ranked.push({ frameId, score });
    } catch {
      // skip
    }
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.frameId ?? frameIds[0] ?? 0;
}

async function listPortalFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const portal = (frames || [])
      .filter((frame) => frame.url && isPortalUrl(frame.url))
      .sort((a, b) => {
        if (a.frameId === 0 && b.frameId !== 0) {
          return 1;
        }
        if (b.frameId === 0 && a.frameId !== 0) {
          return -1;
        }
        return b.frameId - a.frameId;
      });
    if (portal.length) {
      return portal.map((frame) => frame.frameId);
    }
  } catch {
    // Missing permission or restricted page.
  }
  return [0];
}

function isPortalUrl(url) {
  try {
    const host = new URL(url).hostname;
    return (
      host === 'micompensacion.com' ||
      host.endsWith('.micompensacion.com')
    );
  } catch {
    return false;
  }
}

function friendlyConnectionError(error) {
  const text = String(error?.message || error);
  if (/Receiving end does not exist|Could not establish connection/i.test(text)) {
    return (
      'No connection to the portal tab. ' +
      'Reload the extension at chrome://extensions, reload the Mi Compensación tab, and press ↻.'
    );
  }
  return text;
}

function setMonthHint(text) {
  if (!els.monthHint) {
    return;
  }
  const message = String(text || '').trim();
  els.monthHint.hidden = !message;
  els.monthHint.textContent = message;
}

function renderDisconnected(message) {
  renderCalendarView();
  setMonthHint(message);
  showBanner('warn', message);
}

function portalMatchesView() {
  return (
    monthState?.recognized &&
    monthState.year === view.year &&
    monthState.month === view.month
  );
}

function renderCalendarView() {
  hideCalTooltip();
  syncMonthSelect();

  const matched = portalMatchesView();

  if (matched) {
    setMonthHint('');
  } else if (monthState && !monthState.recognized) {
    setMonthHint(
      finalizarReady
        ? 'No month data yet. Select weekdays to fill them in.'
        : 'Sign in on Mi Compensación, open My records, then press refresh.',
    );
  } else if (!monthState) {
    setMonthHint(
      'Sign in on Mi Compensación, open My records, then press refresh.',
    );
  } else {
    setMonthHint('');
  }

  const cells = buildMonthGrid(
    view.year,
    view.month,
    matched ? monthState.days : [],
    { applyPortal: matched },
  );
  const today = todayParts();
  els.monthGrid.innerHTML = '';

  /** @type {Set<string>} */
  const clickableIsos = new Set();

  for (const cell of cells) {
    if (cell.isPadding) {
      const pad = document.createElement('div');
      pad.className = 'cal-cell empty-slot';
      pad.setAttribute('aria-hidden', 'true');
      els.monthGrid.appendChild(pad);
      continue;
    }

    const isToday =
      cell.day === today.day &&
      view.year === today.year &&
      view.month === today.month;

    const future = isFutureDay(view.year, view.month, cell.day);
    const offline = !matched;
    const pendingToday =
      !offline &&
      isToday &&
      !cell.isWeekend &&
      (cell.status === DAY_STATUS.empty ||
        cell.status === DAY_STATUS.unknown) &&
      isWorkdayStillOpen();
    // Empty → cover; recorded (past/today) → edit.
    // Without portal data, days stay neutral and cannot be selected.
    const canClick =
      !offline &&
      !pendingToday &&
      !cell.isWeekend &&
      !future &&
      (cell.isCloseable || cell.isEditable);

    if (canClick) {
      clickableIsos.add(cell.iso);
    }

    const isSelected = canClick && selectedIsos.has(cell.iso);
    const isUpdating = updatingIsos.has(cell.iso);
    const anomalous = isScheduleAnomaly(cell);

    const el = document.createElement(canClick ? 'button' : 'div');
    if (canClick) {
      el.type = 'button';
    }
    el.className = [
      'cal-cell',
      offline
        ? 'offline'
        : pendingToday
          ? 'pending'
          : future && cell.status === DAY_STATUS.empty
            ? 'future'
            : statusClass(cell.status),
      isToday ? 'is-today' : '',
      canClick ? 'is-clickable' : '',
      isSelected ? 'is-selected' : '',
      isUpdating ? 'is-updating' : '',
      anomalous ? 'is-anomaly' : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (!offline) {
      const tipModel = buildCellTooltipModel(cell, {
        isToday,
        canClick,
        anomalous,
        future,
        pending: pendingToday,
      });
      if (tipModel) {
        cellTooltipData.set(el, tipModel);
      }
    }

    if (canClick) {
      el.dataset.year = String(view.year);
      el.dataset.month = String(view.month);
      el.dataset.day = String(cell.day);
      el.dataset.iso = cell.iso;
      el.dataset.mode = cell.isEditable ? 'edit' : 'cover';
      if (cell.label) {
        el.dataset.label = cell.label;
      }
      if (cell.auxUrl) {
        el.dataset.auxUrl = cell.auxUrl;
      }
      dayMeta.set(cell.iso, {
        mode: cell.isEditable ? 'edit' : 'cover',
        label: cell.label || '',
        auxUrl: cell.auxUrl || '',
      });
      if (isUpdating) {
        el.disabled = true;
      }
    }

    const head = document.createElement('div');
    head.className = 'cal-cell-head';

    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(cell.day);
    head.appendChild(num);

    if (isToday) {
      const todayDot = document.createElement('span');
      todayDot.className = 'today-dot';
      todayDot.setAttribute('aria-label', 'Today');
      head.appendChild(todayDot);
    }

    if (!offline && anomalous) {
      const warn = document.createElement('span');
      warn.className = 'cal-anomaly';
      warn.textContent = '!';
      warn.setAttribute('aria-label', 'Review schedule');
      head.appendChild(warn);
    }

    el.appendChild(head);

    if (!offline) {
      const times = recordedTimeLines(cell);
      if (times) {
        el.appendChild(times);
      } else {
        const summaryText = cellSummaryText(cell, future, pendingToday);
        if (summaryText) {
          const summary = document.createElement('div');
          summary.className = 'summary';
          summary.textContent = summaryText;
          el.appendChild(summary);
        }
      }
    }

    els.monthGrid.appendChild(el);
  }

  // Drop selection for days no longer selectable (e.g. after month change).
  for (const iso of [...selectedIsos]) {
    if (!clickableIsos.has(iso)) {
      selectedIsos.delete(iso);
    }
  }
  selectTodayByDefault(clickableIsos);
  syncSelectionBar();
  syncConfirmPanel();
}

function isWorkdayStillOpen(now = new Date()) {
  const exitMin = clockToMinutes(
    normalizeClock(settings.schedule.exit),
  );
  if (exitMin == null) {
    return false;
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin < exitMin;
}

function statusClass(status) {
  switch (status) {
    case DAY_STATUS.recorded:
      return 'recorded';
    case DAY_STATUS.covered:
      return 'covered';
    case DAY_STATUS.empty:
      return 'empty';
    case DAY_STATUS.weekend:
      return 'weekend';
    case DAY_STATUS.unknown:
      return 'unknown';
    default:
      return '';
  }
}

/**
 * Flag portal days whose play/pause don't match entry–exit (or >12h).
 * @param {{ entry?: string, exit?: string, effective?: string, pause?: string, status?: string }} cell
 */
function isScheduleAnomaly(cell) {
  if (cell.status !== DAY_STATUS.recorded) {
    return false;
  }
  const effective = durationToMinutes(cell.effective);
  if (effective == null) {
    return false;
  }
  if (effective > 12 * 60) {
    return true;
  }
  const entry = clockToMinutes(cell.entry);
  const exit = clockToMinutes(cell.exit);
  const pause = durationToMinutes(cell.pause);
  if (entry == null || exit == null || pause == null) {
    return false;
  }
  const expected = Math.max(0, exit - entry - pause);
  return Math.abs(expected - effective) > 30;
}

/**
 * Entry and exit on two lines. Other statuses stay a single text line.
 * @param {{ status?: string, entry?: string, exit?: string }} cell
 * @returns {HTMLElement | null}
 */
function recordedTimeLines(cell) {
  const entry = String(cell.entry || '').trim();
  const exit = String(cell.exit || '').trim();
  if (cell.status !== DAY_STATUS.recorded || !entry || !exit) {
    return null;
  }
  const block = document.createElement('div');
  block.className = 'cal-times';
  block.append(
    timeLine('in', 'Start', entry),
    timeLine('out', 'End', exit),
  );
  return block;
}

/**
 * @param {'in' | 'out'} kind
 * @param {string} label
 * @param {string} value
 */
function timeLine(kind, label, value) {
  const row = document.createElement('div');
  row.className = `cal-time is-${kind}`;
  const icon = document.createElement('span');
  icon.className = 'cal-time-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.appendChild(arrowIcon(kind));
  const text = document.createElement('span');
  text.textContent = value;
  row.append(icon, text);
  row.setAttribute('aria-label', `${label} ${value}`);
  return row;
}

/** @param {'in' | 'out'} kind */
function arrowIcon(kind) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 10');
  svg.setAttribute('width', '8');
  svg.setAttribute('height', '8');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    kind === 'in'
      ? 'M1.5 5h6M5.5 2.5 8 5 5.5 7.5'
      : 'M8.5 5h-6M4.5 2.5 2 5l2.5 2.5',
  );
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

/**
 * Visible cell text: schedule or short cover / gap — no play/pause.
 * @param {{ status: string, label?: string }} cell
 * @param {boolean} future
 * @param {boolean} [pendingToday]
 */
function cellSummaryText(cell, future, pendingToday = false) {
  if (pendingToday) {
    return 'Today';
  }
  if (future && cell.status === DAY_STATUS.empty) {
    return '';
  }
  if (cell.status === DAY_STATUS.recorded) {
    return cell.label || '';
  }
  if (cell.status === DAY_STATUS.covered) {
    return cell.label || 'Off';
  }
  if (cell.status === DAY_STATUS.empty) {
    return 'Gap';
  }
  return cell.label || '';
}

/**
 * @param {{ pause?: string }} cell
 * @returns {string}
 */
function formatBreakValue(cell) {
  return String(cell.pause || '').trim();
}

/**
 * Structured tooltip model (custom tip UI — not native title).
 * @param {object} cell
 * @param {{ isToday: boolean, canClick: boolean, anomalous: boolean, future: boolean, pending?: boolean }} opts
 */
function buildCellTooltipModel(cell, opts) {
  /** @type {{ icon: string, label: string, value: string }[]} */
  const rows = [];
  let warn = '';
  let hint = '';
  let subtitle = '';

  if (opts.isToday) {
    subtitle = 'Today';
  }

  if (cell.status === DAY_STATUS.recorded) {
    const journey =
      cell.entry && cell.exit
        ? `${cell.entry}–${cell.exit}`
        : cell.label || '';
    if (journey) {
      rows.push({ icon: 'clock', label: 'Workday', value: journey });
    }
    if (cell.effective) {
      rows.push({ icon: 'work', label: 'Work', value: cell.effective });
    }
    const breakValue = formatBreakValue(cell);
    if (breakValue) {
      rows.push({
        icon: 'break',
        label: 'Break',
        value: breakValue,
      });
    }
    if (opts.anomalous) {
      warn = 'Durations do not match the schedule';
    }
  } else if (cell.status === DAY_STATUS.covered) {
    rows.push({
      icon: 'off',
      label: 'Status',
      value: cell.label || 'Off',
    });
    if (cell.detail && cell.detail !== cell.label) {
      rows.push({ icon: 'info', label: 'Detail', value: cell.detail });
    }
  } else if (opts.pending) {
    rows.push({
      icon: 'clock',
      label: 'Status',
      value: 'Workday still open',
    });
    hint = 'You can record it after the workday ends.';
  } else if (cell.status === DAY_STATUS.empty && !opts.future) {
    rows.push({ icon: 'gap', label: 'Status', value: 'Not recorded' });
  } else if (cell.status === DAY_STATUS.weekend) {
    rows.push({ icon: 'off', label: 'Status', value: 'Weekend' });
  } else {
    return null;
  }

  if (opts.canClick) {
    hint = cell.isEditable
      ? 'Click to select and edit'
      : 'Click to select';
  }

  if (!cell.iso && !rows.length && !warn) {
    return null;
  }

  return {
    title: cell.iso || '',
    subtitle,
    rows,
    warn,
    hint,
  };
}

/**
 * @param {Element} cellEl
 */
function showCalTooltip(cellEl) {
  const tip = els.calTooltip;
  const model = cellTooltipData.get(cellEl);
  if (!tip || !model) {
    hideCalTooltip();
    return;
  }

  tip.replaceChildren();

  const head = document.createElement('div');
  head.className = 'cal-tip-head';

  const title = document.createElement('div');
  title.className = 'cal-tip-title';
  title.textContent = model.title || 'Day';
  head.appendChild(title);

  if (model.subtitle) {
    const sub = document.createElement('span');
    sub.className = 'cal-tip-badge';
    sub.textContent = model.subtitle;
    head.appendChild(sub);
  }
  tip.appendChild(head);

  if (model.rows?.length) {
    const list = document.createElement('div');
    list.className = 'cal-tip-rows';
    for (const row of model.rows) {
      const item = document.createElement('div');
      item.className = 'cal-tip-row';

      const icon = document.createElement('span');
      icon.className = `cal-tip-icon is-${row.icon}`;
      icon.setAttribute('aria-hidden', 'true');
      item.appendChild(icon);

      const body = document.createElement('div');
      body.className = 'cal-tip-body';

      const label = document.createElement('div');
      label.className = 'cal-tip-label';
      label.textContent = row.label;
      body.appendChild(label);

      const value = document.createElement('div');
      value.className = 'cal-tip-value';
      value.textContent = row.value;
      body.appendChild(value);

      item.appendChild(body);
      list.appendChild(item);
    }
    tip.appendChild(list);
  }

  if (model.warn) {
    const warn = document.createElement('div');
    warn.className = 'cal-tip-warn';
    warn.textContent = model.warn;
    tip.appendChild(warn);
  }

  if (model.hint) {
    const hint = document.createElement('div');
    hint.className = 'cal-tip-hint';
    hint.textContent = model.hint;
    tip.appendChild(hint);
  }

  tip.hidden = false;
  tipAnchor = cellEl;
  positionCalTooltip(cellEl);
}

function hideCalTooltip() {
  const tip = els.calTooltip;
  if (tip) {
    tip.hidden = true;
    tip.replaceChildren();
  }
  tipAnchor = null;
}

/**
 * @param {Element} cellEl
 */
function positionCalTooltip(cellEl) {
  const tip = els.calTooltip;
  if (!tip || tip.hidden) {
    return;
  }
  const rect = cellEl.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const gap = 10;
  const pad = 8;

  let top = rect.top - tipRect.height - gap;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;

  if (top < pad) {
    top = rect.bottom + gap;
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - tipRect.width - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - tipRect.height - pad));

  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
}

async function detectFinalizarFrame(tabId) {
  const frameIds = await listPortalFrameIds(tabId);
  for (const frameId of frameIds) {
    try {
      const ping = await chrome.tabs.sendMessage(
        tabId,
        { type: MSG.PING },
        { frameId },
      );
      if (
        ping?.ok &&
        (/RegistroHorario\/Finalizar/i.test(ping.href || '') ||
          (ping.workdayScore || 0) >= 100)
      ) {
        return true;
      }
    } catch {
      // skip
    }
  }
  return false;
}

async function findPortalTab() {
  const tabs = await chrome.tabs.query({
    url: [
      'https://*.micompensacion.com/*',
      'https://micompensacion.com/*',
    ],
  });
  if (!tabs.length) {
    return null;
  }
  const currentWindow = await chrome.windows.getCurrent();
  const inWindow = tabs.filter((tab) => tab.windowId === currentWindow.id);
  const pool = inWindow.length ? inWindow : tabs;
  const active = pool.find((tab) => tab.active);
  const ranked = [...pool].sort((a, b) => scorePortalTab(b) - scorePortalTab(a));
  return active && scorePortalTab(active) >= 1 ? active : ranked[0];
}

function scorePortalTab(tab) {
  const url = tab.url || '';
  if (/saml\.micompensacion\.com/i.test(url)) {
    return 0;
  }
  if (/www\.|max\./i.test(url)) {
    return 2;
  }
  return 1;
}

function showBanner(kind, text) {
  els.banner.hidden = false;
  els.banner.className = `banner ${kind}`;
  els.banner.textContent = text;
}

function showToast(kind, text) {
  const toast = els.toast;
  if (!toast) {
    return;
  }
  window.clearTimeout(toastTimer);
  toast.hidden = false;
  toast.className = `toast ${kind}`;
  toast.textContent = text;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
    toast.textContent = '';
    toast.className = 'toast';
  }, 4000);
}

function clearBanner() {
  els.banner.hidden = true;
  els.banner.textContent = '';
  els.banner.className = 'banner';
}
