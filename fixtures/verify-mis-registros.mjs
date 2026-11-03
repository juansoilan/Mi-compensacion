/**
 * Offline parse check for ObtenerMas HTML fragments.
 * Run: node fixtures/verify-mis-registros.mjs
 */
import {
  buildMonthDaysFromRecords,
  buildObtenerMasBody,
  fetchMonthViaMisRegistros,
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

// Request body: dates must be ISO (portal format), not Date.toString().
const body = buildObtenerMasBody(2026, 10, 0, 5);
const bodyFrom = body.get('FechaDesde');
const bodyTo = body.get('FechaHasta');
assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(bodyFrom), `from ISO ${bodyFrom}`);
assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(bodyTo), `to ISO ${bodyTo}`);
assert(
  new Date(bodyFrom).getTime() === new Date(2026, 9, 1).getTime(),
  'from = local midnight Oct 1',
);
assert(
  new Date(bodyTo).getTime() === new Date(2026, 10, 1).getTime(),
  'to = local midnight Nov 1 (exclusive end)',
);
assert(body.get('CantidadRows') === '5', 'page size in body');
assert(body.get('UltimaRow') === '0', 'offset in body');

// Pagination: a server that ignores UltimaRow returns the same full page.
// The loop must stop after the first repeated page, not walk 30 pages.
function fakeFragment(prefix) {
  let out = '';
  for (let i = 0; i < 40; i += 1) {
    out += `<div class="bloque" onclick="OpenModal('${prefix}${i}',0,0,false,'',false,'/x')">
      <input id="texto_historial_${prefix}${i}" value="${prefix} row ${i}" />
    </div>\n`;
  }
  return out;
}

globalThis.location = { origin: 'https://www.micompensacion.com' };
globalThis.document = {
  querySelector: () => ({ value: 'token-test' }),
};
const requestBodies = [];
globalThis.fetch = async (_url, init) => {
  requestBodies.push(String(init.body));
  return {
    ok: true,
    status: 200,
    text: async () => fakeFragment('same'),
  };
};

const repeated = await fetchMonthViaMisRegistros(2030, 3, { force: true });
assert(repeated.ok === true, 'repeated-page fetch ok');
assert(
  requestBodies.length === 2,
  `expected 2 requests (stop on repeated page), got ${requestBodies.length}`,
);

// Distinct pages keep paginating until a short page.
let call = 0;
requestBodies.length = 0;
globalThis.fetch = async (_url, init) => {
  requestBodies.push(String(init.body));
  call += 1;
  const html = call < 3 ? fakeFragment(`p${call}_`) : '';
  return { ok: true, status: 200, text: async () => html };
};
await fetchMonthViaMisRegistros(2030, 4, { force: true });
assert(
  requestBodies.length === 3,
  `expected 3 requests (2 full pages + empty), got ${requestBodies.length}`,
);
assert(
  new URLSearchParams(requestBodies[1]).get('UltimaRow') === '40',
  'second page offset = 40',
);

console.log('verify-mis-registros.mjs OK');
