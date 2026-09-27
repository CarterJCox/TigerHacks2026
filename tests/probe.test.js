import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { probeContainer, describeCodec } from '../src/lib/video/probe.js';

// Builds a minimal QuickTime file shaped like an iPhone portrait recording:
// ftyp, mdat, then moov at the end with a rotated HEVC video track.
function box(type, ...children) {
  const payload = children.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(8 + payload);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 8 + payload);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let o = 8;
  for (const c of children) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
function bytes(n, fill) {
  const b = new Uint8Array(n);
  fill?.(new DataView(b.buffer));
  return b;
}
const fourcc = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const fixed = (v) => Math.round(v * 65536);

function tkhd(matrix, w, h) {
  return box('tkhd', bytes(84, (dv) => {
    dv.setUint32(0, 3); // version 0, flags
    dv.setUint32(12, 1); // track id
    const m = 4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2; // flags, times, id, reserved, duration, reserved, layer, group, volume, reserved
    matrix.forEach((v, i) => dv.setInt32(m + i * 4, v));
    dv.setInt32(m + 36, fixed(w));
    dv.setInt32(m + 40, fixed(h));
  }));
}
function hdlr(kind) {
  const b = bytes(24);
  b.set(fourcc(kind), 8);
  return box('hdlr', b);
}
function stsd(codec) {
  const entry = bytes(16);
  new DataView(entry.buffer).setUint32(0, 16);
  entry.set(fourcc(codec), 4);
  const head = bytes(8, (dv) => dv.setUint32(4, 1));
  return box('stsd', head, entry);
}
function mvhd(timescale, duration) {
  return box('mvhd', bytes(100, (dv) => {
    dv.setUint32(12, timescale);
    dv.setUint32(16, duration);
  }));
}

describe('container probe', () => {
  it('reads codec and rotation from an iPhone-style .mov with moov at the end', async () => {
    const rot90 = [0, fixed(1), 0, fixed(-1), 0, 0, 0, 0, 0x40000000];
    const trak = box('trak', tkhd(rot90, 1920, 1080), box('mdia', hdlr('vide'), box('minf', hdlr('alis'), box('stbl', stsd('hvc1')))));
    const file = new File([box('ftyp', fourcc('qt  ')), box('mdat', bytes(1000)), box('moov', mvhd(600, 6000), trak)], 'IMG_0001.MOV');
    const info = await probeContainer(file);
    expect(info).toEqual({ container: 'mp4', codec: 'hvc1', width: 1920, height: 1080, rotation: 90, duration: 10 });
  });

  it('returns null for files that are not MP4/MOV/WebM', async () => {
    expect(await probeContainer(new File([new Uint8Array(64)], 'x.webm'))).toBeNull();
  });

  it('reads a MediaRecorder WebM recording, which stores no duration', async () => {
    // Recorded in Chromium with MediaRecorder (VP9, 160x90, about 1.3 s).
    const file = new File([readFileSync(new URL('./fixtures/recorded.webm', import.meta.url))], 'recording.webm', { type: 'video/webm' });
    const info = await probeContainer(file);
    expect(info).toEqual({ container: 'webm', codec: 'V_VP9', width: 160, height: 90, rotation: 0, duration: null });
    expect(describeCodec(info.codec)).toBe('VP9');
  });
});
