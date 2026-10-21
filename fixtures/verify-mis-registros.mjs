/**
 * Offline parse check for ObtenerMas HTML fragments.
 * Run: node fixtures/verify-mis-registros.mjs
 */
import {
  buildMonthDaysFromRecords,
  parseMisRegistrosHtml,
  parseRegistroDateText,
} from '../src/content/_modules/misRegistrosApi.js';
import { DAY_STATUS } from '../src/shared/gaps.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sample = `
<div class="bloque" onclick="OpenModal('x',0,1,false,'',true,'/_rhapp/RegistroHorario/FinalizarAux?data=abc')">
  <input type="hidden" id="texto_historial_a" value="Thursday, 01 Of October Normal Day" />
  <i class="fal fa-hourglass-start"></i><span class="tiempo_registro"> 09:00</span>
  <i class="fal fa-hourglass-end"></i><span class="tiempo_registro"> 18:00</span>
  <i class="fas fa-play colorplay"></i><span class="tiempo_registro"> 08:00</span>
  <i class="fas fa-pause colorpause"></i><span class="tiempo_registro"> 01:00</span>
</div>
<div class="bloque" onclick="OpenModal('y',0,1,false,'',true,'/_rhapp/RegistroHorario/FinalizarAux?data=def')">
  <input type="hidden" id="texto_historial_b" value="Wednesday, 30 Of September Normal Day" />
  <i class="fal fa-hourglass-start"></i><span class="tiempo_registro"> 09:00</span>
  <i class="fal fa-hourglass-end"></i><span class="tiempo_registro"> 18:00</span>
</div>
`;

assert(
  parseRegistroDateText('Thursday, 01 Of October Normal Day', 2026)?.day === 1,
  'parse day',
);
assert(
  parseRegistroDateText('Thursday, 01 Of October Normal Day', 2026)?.month ===
    10,
  'parse month',
);
assert(
  parseRegistroDateText('Thursday, 01 Of October Normal Day', 2026)?.year ===
    2026,
  'parse year via weekday',
);

const records = parseMisRegistrosHtml(sample, 2026);
assert(records.length === 2, `records ${records.length}`);
assert(records[0].status === DAY_STATUS.recorded, 'recorded');
assert(
  records[0].label === '09:00–18:00',
  `label ${JSON.stringify(records[0].label)}`,
);
assert(records[0].effective === '08:00', 'effective field');
assert(records[0].pause === '01:00', 'pause field');
assert(
  records[0].auxUrl.includes('FinalizarAux'),
  'auxUrl from FinalizarAux',
);

// Planned/open card: times but no FinalizarAux → not recorded
const openCard = parseMisRegistrosHtml(
  `<div class="bloque" onclick="OpenModal('z',0,0,false,'',false,'/_rhapp/RegistroHorario/Finalizar')">
    <input id="texto_historial_t" value="Monday, 19 Of October Normal Day" />
    <i class="fal fa-hourglass-start"></i><span class="tiempo_registro">09:00</span>
    <i class="fal fa-hourglass-end"></i><span class="tiempo_registro">18:00</span>
  </div>`,
  2026,
);
assert(openCard.length === 0, 'open/planned today not recorded');

const october = buildMonthDaysFromRecords(
  2026,
  10,
  records,
  new Date('2026-10-19T12:00:00'),
);
const day1 = october.find((d) => d.day === 1);
assert(day1?.status === DAY_STATUS.recorded, 'oct 1 recorded');

// Today from portal FinalizarAux is trusted (no local override).
const todayRec = [
  {
    day: 19,
    month: 10,
    year: 2026,
    status: DAY_STATUS.recorded,
    label: '08:30–17:30',
  },
];
const withToday = buildMonthDaysFromRecords(
  2026,
  10,
  todayRec,
  new Date('2026-10-19T19:00:00'),
);
assert(
  withToday.find((d) => d.day === 19)?.label === '08:30–17:30',
  'today label from portal',
);

const parsedInvalid = parseMisRegistrosHtml(
  `<div class="bloque" onclick="'/RegistroHorario/FinalizarAux?data=x'">
    <input id="texto_historial_x" value="Monday, 12 Of October Normal Day" />
    <i class="fal fa-hourglass-start"></i><span class="tiempo_registro">00:00</span>
    <i class="fal fa-hourglass-end"></i><span class="tiempo_registro">00:00</span>
  </div>`,
  2026,
);
assert(parsedInvalid.length === 0, 'skip 00:00 placeholder');

const holiday = parseMisRegistrosHtml(
  `<div class="bloque" onclick="OpenModal('h',0,0,false,'',false,'/_rhapp/RegistroHorario/Algo')">
    <input id="texto_historial_h" value="Monday, 12 Of October Holiday" />
  </div>`,
  2026,
);
assert(holiday.length === 1, 'holiday record');
assert(holiday[0].status === DAY_STATUS.covered, 'holiday covered');
assert(holiday[0].label === 'Off', `holiday label ${holiday[0].label}`);

console.log('verify-mis-registros.mjs OK');
