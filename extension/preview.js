import { getSession, getTile, deleteSession } from './lib/db.js';
import { tileSlice, planParts, safeFilename, MAX_PART_PIXELS } from './lib/geometry.js';
import { encodePng } from './lib/png.js';
import { normalizeSettings } from './lib/settings.js';
const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
let exports = [];
let session;
const release = () => { for (const item of exports) URL.revokeObjectURL(item.url); exports = []; };
window.addEventListener('pagehide', release);
function notice(text) {
  const line = document.createElement('p');
  line.textContent = text;
  $('warnings').append(line);
  $('warnings').hidden = false;
}
function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode this image.')), 'image/png'); }
    catch (error) { reject(error); }
  });
}
async function renderPart(part, slices, pixels = false) {
  const canvas = document.createElement('canvas');
  canvas.width = part.width;
  canvas.height = part.height;
  try {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The browser could not allocate the image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, part.width, part.height);
    for (const { tile, slice } of slices) {
      const top = Math.max(part.y, slice.destinationY);
      const bottom = Math.min(part.y + part.height, slice.destinationY + slice.height);
      if (bottom <= top) continue;
      const record = await getTile(tile.key);
      if (!record?.blob) throw new Error('A captured section is no longer in local storage.');
      const bitmap = await createImageBitmap(record.blob);
      try {
        context.drawImage(bitmap, part.x, slice.sourceY + top - slice.destinationY, part.width, bottom - top,
          0, top - part.y, part.width, bottom - top);
      } finally { bitmap.close(); }
    }
    return pixels ? context.getImageData(0, 0, part.width, part.height).data : await canvasBlob(canvas);
  } finally { canvas.width = 0; canvas.height = 0; }
}
async function* renderStrips(width, height, slices) {
  const stripHeight = Math.max(1, Math.min(256, Math.floor(2000000 / width)));
  for (let y = 0; y < height; y += stripHeight) {
    const rows = Math.min(stripHeight, height - y);
    $('status').textContent = `Stitching full-page image… ${Math.round(y / height * 100)}%`;
    // Horizontal parts also keep exceptionally wide captures within canvas limits.
    const parts = planParts(width, rows);
    const data = new Uint8Array(width * rows * 4);
    for (const part of parts) {
      const pixels = await renderPart({ ...part, y: y + part.y }, slices, true);
      for (let row = 0; row < part.height; row++) {
        data.set(pixels.subarray(row * part.width * 4, (row + 1) * part.width * 4),
          ((part.y + row) * width + part.x) * 4);
      }
    }
    yield { data, height: rows };
  }
}
function showPart(item, index, count, part) {
  const article = document.createElement('article');
  article.className = 'part';
  const header = document.createElement('div');
  header.className = 'part-header';
  const label = document.createElement('span');
  label.textContent = count > 1 ? `Part ${index + 1} of ${count}` : 'Full resolution';
  const link = document.createElement('a');
  link.href = item.url;
  link.download = item.name;
  link.textContent = 'Download PNG';
  header.append(label, link);
  const figure = document.createElement('figure');
  const img = document.createElement('img');
  img.alt = `Screenshot of ${session.title}${count > 1 ? `, part ${index + 1}` : ''}`;
  img.src = item.url;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.width = part.width;
  img.height = part.height;
  figure.append(img);
  const caption = document.createElement('figcaption');
  caption.textContent = `${part.width.toLocaleString()} × ${part.height.toLocaleString()} pixels${count > 1 ? ` · starts at x=${part.x}, y=${part.y}` : ''}`;
  article.append(header, figure, caption);
  $('parts').append(article);
}
async function main() {
  session = await getSession(id);
  if (!session) throw new Error('This capture was deleted or expired. Return to the webpage and capture it again.');
  $('title').textContent = session.title;
  document.title = `${session.title} · Grab a Page`;
  $('meta').textContent = `${session.mode === 'full' ? 'Full page' : 'Visible area'} · ${new Date(session.createdAt).toLocaleString()}${session.url ? ` · ${session.url}` : ''}`;
  $('badge').textContent = session.status === 'complete' ? 'Complete' : session.status === 'cancelled' ? 'Cancelled' : 'Incomplete';
  $('badge').classList.toggle('partial', session.status !== 'complete');
  $('badge').hidden = false;
  $('delete').hidden = false;
  for (const text of session.warnings) notice(text);
  if (!session.endedAt) notice('This capture was interrupted before it finished. Only the sections saved before the interruption are included.');
  if (!session.tiles.length) { $('empty').hidden = false; $('status').textContent = 'Nothing to export.'; return; }
  const width = Math.round(session.width * session.scale);
  const height = Math.round(session.height * session.scale);
  const slices = [];
  let covered = 0;
  for (const tile of session.tiles) {
    const slice = tileSlice(tile, covered, session.height, session.scale);
    if (slice) { slices.push({ tile, slice }); covered = slice.coveredCss; }
  }
  const single = normalizeSettings(session).imageOutput === 'single';
  if (single) {
    const blob = await encodePng(width, height, renderStrips(width, height, slices));
    const item = { url: URL.createObjectURL(blob), name: safeFilename(session.title, session.createdAt, 0, 1) };
    exports.push(item);
    showPart(item, 0, 1, { x: 0, y: 0, width, height });
  } else {
    let budget = MAX_PART_PIXELS;
    for (;;) {
      const parts = planParts(width, height, budget);
      try {
        for (let index = 0; index < parts.length; index++) {
          $('status').textContent = `Preparing image ${index + 1} of ${parts.length}…`;
          const blob = await renderPart(parts[index], slices);
          const item = { url: URL.createObjectURL(blob), name: safeFilename(session.title, session.createdAt, index, parts.length) };
          exports.push(item);
          showPart(item, index, parts.length, parts[index]);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        break;
      } catch (error) {
        release();
        $('parts').replaceChildren();
        if (budget <= 1500000 || /no longer/.test(error.message)) throw error;
        budget = Math.floor(budget / 2);
        $('status').textContent = 'Retrying with smaller image parts…';
      }
    }
  }
  if (exports.length > 1) notice('This capture was split into numbered PNGs to preserve resolution within browser image and memory limits. Download each part below, or use Download all.');
  $('status').textContent = `${width.toLocaleString()} × ${height.toLocaleString()} pixels · ${session.tiles.length} captured section${session.tiles.length === 1 ? '' : 's'} · ${exports.length} PNG${exports.length === 1 ? '' : 's'}`;
  $('download').textContent = exports.length > 1 ? `Download all (${exports.length})` : 'Download PNG';
  $('download').disabled = false;
}
$('download').addEventListener('click', async () => {
  $('download').disabled = true;
  for (const item of exports) {
    const link = document.createElement('a');
    link.href = item.url;
    link.download = item.name;
    document.body.append(link);
    link.click();
    link.remove();
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  $('download').disabled = false;
});
$('delete').addEventListener('click', async () => {
  $('delete').disabled = true;
  await deleteSession(id);
  release();
  $('parts').replaceChildren();
  $('download').disabled = true;
  $('delete').hidden = true;
  $('empty').hidden = false;
  $('empty').querySelector('h2').textContent = 'Capture deleted';
  $('status').textContent = 'The saved sections have been removed from this device.';
});
main().catch(error => {
  $('title').textContent = 'Unable to prepare this capture';
  notice(error.message);
  $('status').textContent = 'Return to the page and try capturing again.';
});
