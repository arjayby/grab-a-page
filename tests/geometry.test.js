import test from 'node:test';
import assert from 'node:assert/strict';
import { tileSlice, planTileSlices, planParts, safeFilename } from '../extension/lib/geometry.js';
import { normalizeSettings } from '../extension/lib/settings.js';

test('overlapping captures, including the clamped last viewport, form one continuous image', () => {
  const tiles = [{ y: 0, height: 800 }, { y: 640, height: 800 }, { y: 1280, height: 800 }, { y: 1400, height: 800 }];
  let covered = 0;
  let lastPixel = 0;
  for (const tile of tiles) {
    const slice = tileSlice(tile, covered, 2200, 1.25);
    assert.equal(slice.destinationY, lastPixel);
    assert.ok(slice.sourceY >= 0);
    covered = slice.coveredCss;
    lastPixel += slice.height;
  }
  assert.equal(covered, 2200);
  assert.equal(lastPixel, 2750);
});
test('height limit crops the final tile and redundant tiles are skipped', () => {
  const slice = tileSlice({ y: 640, height: 800 }, 800, 1000, 2);
  assert.deepEqual(slice, { sourceY: 320, destinationY: 1600, height: 400, coveredCss: 1000 });
  assert.equal(tileSlice({ y: 0, height: 800 }, 1000, 1000, 2), null);
});
test('later screenshots replace overlap pixels that may contain unrevealed content', () => {
  const tiles = [{ y: 0, height: 800 }, { y: 400, height: 800 }, { y: 800, height: 800 }, { y: 1000, height: 800 }];
  const slices = planTileSlices(tiles, 1800, 1.25);
  assert.deepEqual(slices.map(({ slice }) => [slice.sourceY, slice.destinationY, slice.height]),
    [[0, 0, 500], [0, 500, 500], [0, 1000, 250], [0, 1250, 1000]]);
  assert.equal(slices.reduce((sum, { slice }) => sum + slice.height, 0), 2250);
  const cropped = planTileSlices(tiles, 1100, 2);
  assert.equal(cropped.at(-1).slice.destinationY + cropped.at(-1).slice.height, 2200);
});
test('PNG parts cover every pixel once and respect dimension and allocation limits', () => {
  for (const [width, height] of [[1440, 900], [2880, 60000], [20000, 18000]]) {
    const parts = planParts(width, height);
    assert.equal(parts.reduce((sum, part) => sum + part.width * part.height, 0), width * height);
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i];
      assert.ok(a.width <= 16000 && a.height <= 16000 && a.width * a.height <= 24000000);
      for (const b of parts.slice(i + 1)) assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
  }
});
test('settings remain bounded and invalid inputs use defaults', () => {
  assert.deepEqual(normalizeSettings({ maxDuration: NaN, maxHeight: 1e9, waitMs: -1, loadTimeout: '2000' }),
    { maxDuration: 120, maxHeight: 100000, waitMs: 300, loadTimeout: 2000, imageOutput: 'single' });
});
test('image output defaults to one PNG and preserves an explicit multiple-image choice', () => {
  assert.equal(normalizeSettings().imageOutput, 'single');
  assert.equal(normalizeSettings({ imageOutput: 'multiple' }).imageOutput, 'multiple');
  assert.equal(normalizeSettings({ imageOutput: 'invalid' }).imageOutput, 'single');
});
test('export names cannot introduce paths and parts remain ordered', () => {
  assert.equal(safeFilename('../a:b*', 0, 1, 3), '..-a-b--1970-01-01T00-00-00-000Z-part-02.png');
});
