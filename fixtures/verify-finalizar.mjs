/**
 * Offline check of Finalizar body construction (Postman shape).
 * Run: node fixtures/verify-finalizar.mjs
 */
import { buildFinalizarBody } from '../src/content/_modules/finalizarApi.js';
import {
  effectiveSeconds,
  pauseMinutesFromSchedule,
} from '../src/shared/time.js';

const schedule = {
  entry: '09:00',
  exit: '18:00',
  pause: '01:00',
};

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(pauseMinutesFromSchedule(schedule) === 60, 'pause minutes');
assert(effectiveSeconds(schedule) === 28800, 'effective seconds');

const body = buildFinalizarBody(
  schedule,
  {
    token: 'test-token',
    rhPersonaIdEncrypted: 'enc-id',
    tipoDiaId: '389',
  },
  new Date('2026-10-19T12:00:00'),
);

assert(body.get('HoraInicio') === '09:00', 'HoraInicio');
assert(body.get('HoraFin') === '18:00', 'HoraFin');
assert(body.get('FechaHoraInicio') === '19/10/2026', 'fecha inicio');
assert(body.get('FechaHoraFin') === '19/10/2026', 'fecha fin');
assert(body.get('TiempoPausa') === '3600', 'TiempoPausa');
assert(body.get('TiempoEfectivo') === '28800', 'TiempoEfectivo');
assert(body.get('TipoDiaId') === '389', 'TipoDiaId');
assert(body.get('RhPersonaIdEncrypted') === 'enc-id', 'persona');
assert(body.get('__RequestVerificationToken') === 'test-token', 'token');
assert(body.get('RegistroManual') === 'True', 'RegistroManual');
assert(body.get('Id') === '0', 'Id');
assert(body.get('RegistroNuevo') === 'True', 'RegistroNuevo new');

const editBody = buildFinalizarBody(
  schedule,
  {
    token: 'test-token',
    rhPersonaIdEncrypted: 'enc-id',
    tipoDiaId: '389',
    id: '12345',
    isNew: false,
  },
  new Date('2026-10-16T12:00:00'),
);
assert(editBody.get('Id') === '12345', 'edit Id');
assert(editBody.get('RegistroNuevo') === 'False', 'RegistroNuevo edit');
assert(editBody.get('FechaHoraInicio') === '16/10/2026', 'edit fecha');

// Legacy break window still maps to pause duration.
const legacy = buildFinalizarBody(
  {
    entry: '09:00',
    exit: '18:00',
    breakStart: '14:00',
    breakEnd: '15:00',
  },
  {
    token: 't',
    rhPersonaIdEncrypted: 'e',
    tipoDiaId: '1',
  },
  new Date('2026-10-19T12:00:00'),
);
assert(legacy.get('TiempoPausa') === '3600', 'legacy pause');

console.log('verify-finalizar.mjs OK');
console.log('  body keys:', [...body.keys()].join(', '));
