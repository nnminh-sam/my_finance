import assert from 'node:assert/strict';
import test from 'node:test';
import { getHeatmapColor } from '../src/lib/heatmap';

function opacity(color: string) {
  return Number(color.slice(color.lastIndexOf(',') + 1, -1));
}

test('heatmap is empty for no spending or an unavailable peak', () => {
  for (const theme of ['light', 'dark'] as const) {
    assert.equal(getHeatmapColor(0, 100, theme), '');
    assert.equal(getHeatmapColor(0, 0, theme), '');
    assert.equal(getHeatmapColor(100, 0, theme), '');
    assert.equal(getHeatmapColor(-1, 100, theme), '');
    assert.equal(getHeatmapColor(100, -1, theme), '');
    assert.equal(getHeatmapColor(NaN, 100, theme), '');
    assert.equal(getHeatmapColor(100, Infinity, theme), '');
  }
});

test('heatmap uses one theme-aware blue with increasing relative-volume intensity', () => {
  for (const theme of ['light', 'dark'] as const) {
    const low = getHeatmapColor(10, 100, theme);
    const middle = getHeatmapColor(50, 100, theme);
    const peak = getHeatmapColor(100, 100, theme);
    const blue = theme === 'dark' ? '96, 165, 250' : '59, 130, 246';
    for (const color of [low, middle, peak]) {
      assert.ok(color.startsWith(`rgba(${blue}, `));
      assert.ok(opacity(color) > 0 && opacity(color) <= 1);
    }
    assert.ok(opacity(low) < opacity(middle));
    assert.ok(opacity(middle) < opacity(peak));
    assert.equal(getHeatmapColor(1000, 100, theme), peak);
    assert.equal(getHeatmapColor(5, 10, theme), middle);
  }
  assert.equal(getHeatmapColor(50, 100), getHeatmapColor(50, 100, 'light'));
  assert.ok(opacity(getHeatmapColor(50, 100, 'dark')) > opacity(getHeatmapColor(50, 100, 'light')));
});
