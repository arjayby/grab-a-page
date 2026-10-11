// Encode bounded RGBA strips as one PNG without allocating a full-page canvas.
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function chunk(type, data) {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < bytes.length - 4; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 255];
  view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

export async function encodePng(width, height, strips) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0x7fffffff)) {
    throw new Error('Invalid image size.');
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // Eight bits per channel.
  header[9] = 6; // RGBA, with standard compression, filtering, and no interlacing.
  const output = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header)];
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let readError;
  // Drain concurrently so the compressor's backpressure never blocks a write.
  const drained = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      output.push(chunk('IDAT', value));
    }
  })().catch(error => { readError = error; });
  try {
    let rows = 0;
    const rowBytes = width * 4;
    for await (const strip of strips) {
      if (!Number.isSafeInteger(strip.height) || strip.height < 1 || rows + strip.height > height || strip.data.length !== rowBytes * strip.height) {
        throw new Error('Invalid image strip.');
      }
      const scanlines = new Uint8Array((rowBytes + 1) * strip.height);
      for (let y = 0; y < strip.height; y++) {
        // Filter zero: each scanline contains its original RGBA pixels.
        scanlines.set(strip.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
      }
      await writer.write(scanlines);
      rows += strip.height;
    }
    if (rows !== height) throw new Error('The image strips do not cover the full page.');
    await writer.close();
    await drained;
    if (readError) throw readError;
    output.push(chunk('IEND', new Uint8Array()));
    return new Blob(output, { type: 'image/png' });
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await drained;
    throw error;
  } finally {
    writer.releaseLock();
    reader.releaseLock();
  }
}
