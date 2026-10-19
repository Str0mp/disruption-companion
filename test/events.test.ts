import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEvents } from '../src/domain/events.ts';
import { EVENTS_ABC123 } from '../src/tools/fixtures.ts';
import { delay, events } from './helpers.ts';

test('A5: el evento ON_TIME se descarta porque su fuente está degradada, no porque sea más viejo', () => {
  const r = resolveEvents(EVENTS_ABC123);
  assert.deepEqual(r.effective.map((e) => e.event_id), ['E-1001', 'E-1007', 'E-2003']);
  const d = r.discarded.find((x) => x.event_id === 'E-1012');
  assert.equal(d?.reason, 'SOURCE_DEGRADED');
  assert.equal(r.uncertain.length, 0);
});

test('A5: un evento más nuevo de una fuente degradada igual pierde', () => {
  const r = resolveEvents(events([
    delay('S1', 160),
    { event_id: 'E-X', segment_id: 'S1', type: 'STATUS', status: 'ON_TIME', source: 'LEGACY_MIRROR', recorded_at: '2026-09-15T11:00:00Z' },
  ]));
  assert.deepEqual(r.effective.map((e) => e.event_id), ['E-S1-160']);
  assert.equal(r.discarded[0]?.reason, 'SOURCE_DEGRADED');
});

test('A5: dentro de una misma fuente, el evento más nuevo reemplaza al anterior', () => {
  const r = resolveEvents(events([
    delay('S1', 90, { event_id: 'old', recorded_at: '2026-09-15T09:00:00Z' }),
    delay('S1', 160, { event_id: 'new', recorded_at: '2026-09-15T10:48:00Z' }),
  ]));
  assert.deepEqual(r.effective.map((e) => e.event_id), ['new']);
  assert.equal(r.discarded.find((d) => d.event_id === 'old')?.reason, 'SUPERSEDED_BY_NEWER');
});

test('A5: fuentes confiables que discrepan en QUÉ pasó dejan el segmento incierto', () => {
  const r = resolveEvents(events([
    delay('S1', 160),
    { event_id: 'E-C', segment_id: 'S1', type: 'CANCELLATION', source: 'AIRPORT_FEED', recorded_at: '2026-09-15T10:50:00Z' },
  ]));
  assert.equal(r.uncertain.length, 1);
  assert.equal(r.uncertain[0]?.segment_id, 'S1');
  assert.equal(r.effective.length, 0);
  assert.ok(r.discarded.every((d) => d.reason === 'CONFLICTING_SOURCES'));
});

test('A5: fuentes confiables que coinciden en qué pasó pero no en el detalle → gana el mayor rango', () => {
  const r = resolveEvents(events([
    delay('S1', 160),
    delay('S1', 150, { event_id: 'E-AF', source: 'AIRPORT_FEED', recorded_at: '2026-09-15T10:58:00Z' }),
  ]));
  assert.deepEqual(r.effective.map((e) => e.event_id), ['E-S1-160']);
  assert.equal(r.discarded.find((d) => d.event_id === 'E-AF')?.reason, 'LOWER_RANK_SOURCE');
});
