// probe.js: Minimal ISO-BMFF (MP4 / MOV) reader. Reads only box headers and the `moov`
// box, never the media data, to find the video track's codec, coded size,
// duration and rotation matrix. iPhone .mov files store portrait orientation
// as a rotation matrix in the track header, which is what we need here.

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);

async function readBytes(file, start, length) {
  const buf = await file.slice(start, start + length).arrayBuffer();
  return new DataView(buf);
}

function fourcc(view, offset) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

// Walk the top-level boxes using only their headers.
async function findTopLevelBox(file, type) {
  let offset = 0;
  const size = file.size;
  for (let guard = 0; offset + 8 <= size && guard < 10000; guard++) {
    const head = await readBytes(file, offset, 16);
    let boxSize = head.getUint32(0);
    const boxType = fourcc(head, 4);
    let headerSize = 8;
    if (boxSize === 1) {
      boxSize = Number(head.getBigUint64(8));
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (boxSize < headerSize) return null;
    if (boxType === type) return { offset, size: boxSize, headerSize };
    offset += boxSize;
  }
  return null;
}

function parseBoxes(view, start, end, visit) {
  let offset = start;
  while (offset + 8 <= end) {
    let size = view.getUint32(offset);
    const type = fourcc(view, offset + 4);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < header || offset + size > end) break;
    visit(type, offset + header, offset + size);
    offset += size;
  }
}

function readFixed16(view, offset) {
  return view.getInt32(offset) / 65536;
}

function parseTkhd(view, start) {
  const version = view.getUint8(start);
  let p = start + 4;
  p += version === 1 ? 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4;
  p += 8 + 2 + 2 + 2 + 2; // reserved, layer, alternate group, volume, reserved
  const a = readFixed16(view, p);
  const b = readFixed16(view, p + 4);
  p += 36;
  const width = readFixed16(view, p);
  const height = readFixed16(view, p + 4);
  const deg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  const rotation = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  return { width, height, rotation };
}

function parseTrak(view, start, end) {
  const track = { handler: null, codec: null, tkhd: null };
  const visit = (type, s, e) => {
    if (type === 'tkhd') track.tkhd = parseTkhd(view, s);
    // The media handler comes first (mdia > hdlr). QuickTime files also have a
    // data-reference handler inside minf (e.g. 'alis') that must not override it.
    else if (type === 'hdlr') track.handler = track.handler || fourcc(view, s + 8);
    else if (type === 'stsd') {
      // version/flags (4) + entry count (4), then the first sample entry.
      if (s + 16 <= e) track.codec = fourcc(view, s + 12);
    } else if (CONTAINERS.has(type)) parseBoxes(view, s, e, visit);
  };
  parseBoxes(view, start, end, visit);
  return track;
}

// ---- WebM / Matroska (EBML), as written by MediaRecorder ----
// Only the header, segment info and track list are read; they come before
// the first cluster of media data.

const EBML_IDS = {
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
};
const EBML_MASTERS = new Set([EBML_IDS.segment, EBML_IDS.info, EBML_IDS.tracks, EBML_IDS.trackEntry, EBML_IDS.video]);

// Element ID: the leading bits mark its length (1-4 bytes); the marker stays in the ID.
function readEbmlId(view, p) {
  const first = view.getUint8(p);
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || p + len > view.byteLength) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + view.getUint8(p + i);
  return { id, len };
}

// Element size: a variable-length integer with the length marker removed.
// All value bits set means "unknown size" (MediaRecorder streams the segment).
function readEbmlSize(view, p) {
  const first = view.getUint8(p);
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > view.byteLength) return null;
  let value = first & (0xff >> len);
  let allOnes = value === 0xff >> len;
  for (let i = 1; i < len; i++) {
    const b = view.getUint8(p + i);
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { size: allOnes ? null : value, len };
}

function readUint(view, p, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + view.getUint8(p + i);
  return v;
}

async function probeWebm(file) {
  const view = await readBytes(file, 0, Math.min(file.size, 512 * 1024));
  const out = { container: 'webm', codec: null, width: null, height: null, rotation: 0, duration: null };
  let scale = 1e6; // default TimecodeScale: 1 ms
  let rawDuration = null;
  let track = null;
  let done = false;
  const walk = (start, end) => {
    let p = start;
    while (!done && p < end && p < view.byteLength - 2) {
      const id = readEbmlId(view, p);
      if (!id) return;
      const sz = readEbmlSize(view, p + id.len);
      if (!sz) return;
      const body = p + id.len + sz.len;
      const stop = sz.size == null ? end : Math.min(end, body + sz.size);
      if (id.id === EBML_IDS.cluster) {
        done = true; // media data starts; everything needed came before it
        return;
      }
      if (EBML_MASTERS.has(id.id)) {
        if (id.id === EBML_IDS.trackEntry) track = { type: null, codec: null, width: null, height: null };
        walk(body, stop);
        if (id.id === EBML_IDS.trackEntry && track?.type === 1 && !out.codec) Object.assign(out, { codec: track.codec, width: track.width, height: track.height });
      } else if (sz.size != null && body + sz.size <= view.byteLength) {
        if (id.id === EBML_IDS.timecodeScale) scale = readUint(view, body, sz.size);
        else if (id.id === EBML_IDS.duration) rawDuration = sz.size === 8 ? view.getFloat64(body) : sz.size === 4 ? view.getFloat32(body) : null;
        else if (track && id.id === EBML_IDS.trackType) track.type = readUint(view, body, sz.size);
        else if (track && id.id === EBML_IDS.codecId) track.codec = String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + body, sz.size)).replace(/\0+$/, '');
        else if (track && id.id === EBML_IDS.pixelWidth) track.width = readUint(view, body, sz.size);
        else if (track && id.id === EBML_IDS.pixelHeight) track.height = readUint(view, body, sz.size);
      }
      if (sz.size == null) return; // unknown size: its children ran to the end
      p = body + sz.size;
    }
  };
  walk(0, view.byteLength);
  if (!out.codec) return null;
  if (Number.isFinite(rawDuration) && rawDuration > 0) out.duration = (rawDuration * scale) / 1e9;
  return out;
}

/**
 * Returns { container, codec, width, height, rotation, duration } for the
 * first video track, or null when the file isn't an MP4/MOV/WebM or can't be
 * parsed. `duration` is null when the file doesn't store one (MediaRecorder
 * WebM recordings).
 */
export async function probeContainer(file) {
  try {
    const head = await readBytes(file, 0, Math.min(4, file.size));
    if (head.byteLength === 4 && head.getUint32(0) === 0x1a45dfa3) return await probeWebm(file);
    const moov = await findTopLevelBox(file, 'moov');
    if (!moov || moov.size > 64 * 1024 * 1024) return null;
    const view = await readBytes(file, moov.offset, moov.size);
    let duration = null;
    const tracks = [];
    parseBoxes(view, moov.headerSize, moov.size, (type, s, e) => {
      if (type === 'trak') tracks.push(parseTrak(view, s, e));
      if (type === 'mvhd') {
        const version = view.getUint8(s);
        const timescale = view.getUint32(s + (version === 1 ? 20 : 12));
        const dur = version === 1 ? Number(view.getBigUint64(s + 24)) : view.getUint32(s + 16);
        if (timescale > 0) duration = dur / timescale;
      }
    });
    const video = tracks.find((t) => t.handler === 'vide');
    if (!video || !video.tkhd) return null;
    return {
      container: 'mp4',
      codec: video.codec,
      width: video.tkhd.width,
      height: video.tkhd.height,
      rotation: video.tkhd.rotation,
      duration,
    };
  } catch {
    return null;
  }
}

export function describeCodec(codec) {
  if (!codec) return 'unknown';
  if (codec === 'hvc1' || codec === 'hev1') return 'HEVC (H.265)';
  if (codec === 'avc1' || codec === 'avc3') return 'H.264';
  if (codec === 'vp09') return 'VP9';
  if (codec === 'av01' || codec === 'V_AV1') return 'AV1';
  if (codec === 'V_VP9') return 'VP9';
  if (codec === 'V_VP8') return 'VP8';
  if (codec.startsWith('V_MPEG4/ISO/AVC')) return 'H.264';
  return codec;
}
