import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePng } from '../extension/lib/png.js';

function readPng(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert.equal(view.getUint32(offset + 8 + length), (crc ^ 0xffffffff) >>> 0, `${type} checksum`);
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  assert.equal(chunks[0].type, 'IHDR');
  assert.equal(chunks.at(-1).type, 'IEND');
  return chunks;
}

test('streamed PNG preserves dimensions and every RGBA pixel across strip boundaries', async () => {
  const first = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
  const second = new Uint8Array([0, 0, 255, 255, 1, 2, 3, 255, 40, 50, 60, 255, 70, 80, 90, 255]);
  const blob = await encodePng(2, 3, [{ height: 1, data: first }, { height: 2, data: second }]);
  assert.equal(blob.type, 'image/png');
  const chunks = readPng(new Uint8Array(await blob.arrayBuffer()));
  const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
  assert.equal(header.getUint32(0), 2);
  assert.equal(header.getUint32(4), 3);
  assert.deepEqual([...chunks[0].data.subarray(8)], [8, 6, 0, 0, 0]);
  const raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)));
  assert.deepEqual([...raw], [0, ...first, 0, ...second.subarray(0, 8), 0, ...second.subarray(8)]);
});

test('PNG can exceed canvas height limits while processing bounded strips', async () => {
  async function* strips() {
    for (let y = 0; y < 40000; y += 100) yield { height: 100, data: new Uint8Array(400).fill(255) };
  }
  const chunks = readPng(new Uint8Array(await (await encodePng(1, 40000, strips())).arrayBuffer()));
  const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
  assert.equal(header.getUint32(4), 40000);
  const raw = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)));
  assert.equal(raw.length, 40000 * 5);
  assert.deepEqual([...raw.subarray(-5)], [0, 255, 255, 255, 255]);
});

test('invalid or missing strips and source failures reject instead of returning a partial PNG', async () => {
  await assert.rejects(encodePng(2, 2, []), /cover the full page/);
  await assert.rejects(encodePng(2, 2, [{ height: 2, data: new Uint8Array(8) }]), /Invalid image strip/);
  async function* broken() {
    yield { height: 1, data: new Uint8Array(8) };
    throw new Error('Missing capture tile');
  }
  await assert.rejects(encodePng(2, 2, broken()), /Missing capture tile/);
});
