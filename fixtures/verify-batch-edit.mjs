/**
 * Guardrails for multi-day edit: never fall back to Id=0 / RegistroNuevo=True.
 * Run: node fixtures/verify-batch-edit.mjs
 */
import {
  buildFinalizarBody,
  resolveCloseKind,
} from '../src/content/_modules/finalizarApi.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const schedule = {
  entry: '09:00',
  exit: '18:00',
  pause: '01:00',
};

const batch = [
  {
    iso: '2026-10-14',
    mode: 'edit',
    auxUrl: '/_rhapp/RegistroHorario/FinalizarAux?data=aaa',
    id: '1001',
  },
  {
    iso: '2026-10-15',
    mode: 'edit',
    auxUrl: '/_rhapp/RegistroHorario/FinalizarAux?data=bbb',
    id: '1002',
  },
  {
    iso: '2026-10-16',
    mode: 'edit',
    auxUrl: '/_rhapp/RegistroHorario/FinalizarAux?data=ccc',
    id: '1003',
  },
  { iso: '2026-10-07', mode: 'cover', auxUrl: '', id: '0' },
];

for (const day of batch) {
  const kind = resolveCloseKind({ mode: day.mode, auxUrl: day.auxUrl });
  assert(kind.ok, `kind ok ${day.iso}`);
  if (day.mode === 'edit') {
    assert(kind.kind === 'edit', `edit kind ${day.iso}`);
    assert(kind.auxUrl.includes('FinalizarAux'), `aux ${day.iso}`);
    const body = buildFinalizarBody(
      schedule,
      {
        token: 't',
        rhPersonaIdEncrypted: 'p',
        tipoDiaId: '389',
        id: day.id,
        isNew: false,
      },
      new Date(`${day.iso}T12:00:00`),
    );
    assert(body.get('Id') === day.id, `Id ${day.iso}`);
    assert(body.get('RegistroNuevo') === 'False', `not new ${day.iso}`);
    assert(body.get('Id') !== '0', `no zero Id ${day.iso}`);
  } else {
    assert(kind.kind === 'cover', `cover kind ${day.iso}`);
    const body = buildFinalizarBody(
      schedule,
      {
        token: 't',
        rhPersonaIdEncrypted: 'p',
        tipoDiaId: '389',
        id: '0',
        isNew: true,
      },
      new Date(`${day.iso}T12:00:00`),
    );
    assert(body.get('Id') === '0', `new Id ${day.iso}`);
    assert(body.get('RegistroNuevo') === 'True', `new flag ${day.iso}`);
  }
}

const blocked = resolveCloseKind({ mode: 'edit', auxUrl: '' });
assert(!blocked.ok, 'edit without auxUrl blocked');
assert(/accumulat/i.test(blocked.error || ''), 'blocked mentions accumulate');

const blocked2 = resolveCloseKind({
  mode: 'edit',
  auxUrl: '/_rhapp/RegistroHorario/Finalizar',
});
assert(!blocked2.ok, 'edit with Finalizar (not Aux) blocked');

console.log('verify-batch-edit.mjs OK');
console.log(`  checked ${batch.length} days + 2 blocked edit cases`);
