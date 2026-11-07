import assert from 'node:assert/strict';
import test from 'node:test';
import { placeLabels, runwayModel } from '../src/lib/runway';

const period = { start: '2026-11-05', end: '2026-12-04' };
const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('splits income into spent, committed, estimates and left, early in a pay cycle', () => {
  const model = runwayModel({ ...period, today: '2026-11-07', income: 13_552_583, spent: 8_197_000, committed: 0, estimates: 1_320_000 });
  assert.equal(model.left, 4_035_583);
  assert.equal(model.out, 9_517_000);
  assert.equal(model.status, 'current');
  assert.equal(model.totalDays, 30);
  assert.equal(model.day, 3);
  assert.equal(model.daysLeft, 28);
  assert.equal(model.perDay, 144_127.96);
  assert.deepEqual(model.segments.map(s => s.key), ['spent', 'committed', 'estimates', 'left']);
  close(model.segments.reduce((sum, s) => sum + s.width, 0), 100);
  close(model.segments[2].start, (8_197_000 / 13_552_583) * 100);
  close(model.paceAt, 10);
  assert.equal(model.incomeAt, null);
});

test('when plans go over income the bar spans the total out and marks where income ends', () => {
  const model = runwayModel({ ...period, today: '2026-11-20', income: 1000, spent: 900, committed: 200, estimates: 100 });
  assert.equal(model.left, -200);
  assert.equal(model.perDay, null);
  assert.equal(model.paceAt, null);
  close(model.incomeAt, (1000 / 1200) * 100);
  assert.equal(model.segments[3].width, 0);
  close(model.segments.reduce((sum, s) => sum + s.width, 0), 100);
});

test('past and upcoming periods have no day count, pace or per-day amount', () => {
  for (const today of ['2026-10-30', '2026-12-05']) {
    const model = runwayModel({ ...period, today, income: 1000, spent: 100, committed: 0, estimates: 0 });
    assert.equal(model.status, today < period.start ? 'upcoming' : 'past');
    assert.equal(model.day, null);
    assert.equal(model.perDay, null);
    assert.equal(model.paceAt, null);
  }
});

test('no income and no spending gives an empty bar, not NaN', () => {
  const model = runwayModel({ ...period, today: '2026-11-07', income: 0, spent: 0, committed: 0, estimates: 0 });
  assert.ok(model.segments.every(s => s.width === 0 && s.start === 0));
  assert.equal(model.paceAt, null);
  assert.equal(model.incomeAt, null);
});

test('sums in cents, so fractional amounts do not drift', () => {
  const model = runwayModel({ ...period, today: '2026-11-07', income: 0.3, spent: 0.1, committed: 0.1, estimates: 0.1 });
  assert.equal(model.left, 0);
});

test('labels start under their segment when there is room', () => {
  assert.deepEqual(placeLabels([0, 600, 700], [100, 100, 100], 1000, 18), [0, 600, 718]);
});

test('labels pushed past the row end are pulled back left', () => {
  assert.deepEqual(placeLabels([0, 850, 900], [100, 100, 100], 1000, 10), [0, 790, 900]);
});

test('labels that cannot share one row return null', () => {
  assert.equal(placeLabels([0, 100, 200], [150, 150, 150], 400, 18), null);
  assert.deepEqual(placeLabels([], [], 400, 18), []);
});
