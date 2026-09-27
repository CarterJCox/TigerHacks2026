// Camera and MediaRecorder helpers for the Record view.

// What MediaRecorder writes: WebM (VP9, then VP8) where supported, MP4
// (H.264) otherwise, which is what Safari records. Both go through the same
// loading, probing and decoding as an uploaded file.
const TYPES = [
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
  { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
];

export function pickRecordingType() {
  const supported = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
  return (supported && TYPES.find((t) => MediaRecorder.isTypeSupported(t.mimeType))) || { mimeType: '', extension: 'webm' };
}

export function recordingFileName(extension, date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `spotter-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.${extension}`;
}

/** Whether this browser can record at all, and why not. */
export function recordingSupport() {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' };
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'unsupported' };
  if (typeof MediaRecorder === 'undefined') return { ok: false, reason: 'unsupported' };
  return { ok: true };
}

/** A title and a what-to-do line for a camera failure. */
export function cameraErrorMessage(errOrReason) {
  const name = typeof errOrReason === 'string' ? errOrReason : errOrReason?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Camera access is blocked',
        message: "Allow camera access for this site in your browser's address bar or site settings, then try again. You can also upload a video instead.",
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
      return { title: 'No camera found', message: 'Connect a camera and try again, or record on your phone and upload the video.' };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        title: 'The camera is in use',
        message: 'Another app or browser tab is using the camera. Close video calls or other camera apps, then try again.',
      };
    case 'insecure':
      return { title: 'Recording needs a secure connection', message: 'Open Spotter over https (or on localhost) to use the camera, or upload a video instead.' };
    case 'unsupported':
      return { title: "This browser can't record video", message: 'Use a current version of Chrome, Edge, Firefox or Safari, or upload a video instead.' };
    default:
      return { title: "The camera couldn't start", message: 'Try again, or upload a video instead.' };
  }
}
