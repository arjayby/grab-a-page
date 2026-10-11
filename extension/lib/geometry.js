export const MAX_PART_DIMENSION = 16000;
export const MAX_PART_PIXELS = 24000000;

// Crop each tile at the next tile's start so later captures own overlapping rows.
// All coordinates are converted using the actual screenshot scale, including browser zoom.
export function tileSlice(tile, coveredCss, targetCss, scale) {
  const from = Math.max(coveredCss, tile.y);
  const to = Math.min(targetCss, tile.y + tile.height);
  if (to <= from) return null;
  const destinationY = Math.round(from * scale);
  const end = Math.round(to * scale);
  return { sourceY: destinationY - Math.round(tile.y * scale), destinationY, height: end - destinationY, coveredCss: to };
}

export function planTileSlices(tiles, targetCss, scale) {
  const slices = [];
  let covered = 0;
  for (let index = 0; index < tiles.length; index++) {
    const tile = tiles[index];
    const end = Math.min(targetCss, tiles[index + 1]?.y ?? targetCss);
    const slice = tileSlice(tile, covered, end, scale);
    if (slice) { slices.push({ tile, slice }); covered = slice.coveredCss; }
  }
  return slices;
}

export function planParts(width, height, pixelBudget = MAX_PART_PIXELS) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw new Error('Invalid image size.');
  const partWidth = Math.min(width, MAX_PART_DIMENSION, pixelBudget);
  const partHeight = Math.max(1, Math.min(MAX_PART_DIMENSION, Math.floor(pixelBudget / partWidth)));
  const parts = [];
  for (let y = 0; y < height; y += partHeight) {
    for (let x = 0; x < width; x += partWidth) {
      parts.push({ x, y, width: Math.min(partWidth, width - x), height: Math.min(partHeight, height - y) });
    }
  }
  return parts;
}

export function safeFilename(title, createdAt, index, count) {
  const stem = (title || 'page').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'page';
  const timestamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
  return `${stem}-${timestamp}${count > 1 ? `-part-${String(index + 1).padStart(2, '0')}` : ''}.png`;
}
