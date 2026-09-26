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
    else if (type === 'hdlr') track.handler = fourcc(view, s + 8);
    else if (type === 'stsd') {
      // version/flags (4) + entry count (4), then the first sample entry.
      if (s + 16 <= e) track.codec = fourcc(view, s + 12);
    } else if (CONTAINERS.has(type)) parseBoxes(view, s, e, visit);
  };
  parseBoxes(view, start, end, visit);
  return track;
}

/**
 * Returns { codec, width, height, rotation, duration } for the first video
 * track, or null when the file isn't an MP4/MOV or can't be parsed.
 */
export async function probeContainer(file) {
  try {
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
  if (codec === 'av01') return 'AV1';
  return codec;
}
