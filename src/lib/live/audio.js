// Sounds for recording: countdown beeps and the stop-signal chime (Web
// Audio), and the spoken cue (Web Speech). Browsers block audio until the
// user interacts with the page, so unlockAudio() runs on the Record tap.
// Everything is soft on purpose: a sudden loud sound while someone holds a
// heavy weight is its own hazard.

let ac = null;

export function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !ac) ac = new Ctx();
    ac?.resume?.();
  } catch {
    ac = null;
  }
  try {
    // Speaking an empty utterance inside the tap unlocks speech on Safari.
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    }
  } catch {
    // Speech unavailable: the chime and the on-screen message still work.
  }
}

function note(freq, start, dur, peak) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.03); // soft attack, no click
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Short soft beep for the countdown. */
export function beep(high = false) {
  if (!ac) return;
  note(high ? 880 : 587, ac.currentTime, high ? 0.35 : 0.18, 0.12);
}

/** The stop-signal chime: two calm descending notes. */
export function chime() {
  if (!ac) return;
  const t = ac.currentTime;
  note(659, t, 0.45, 0.2);
  note(494, t + 0.28, 0.6, 0.2);
}

export function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = 0.9;
    const voice = synth.getVoices().find((v) => /^en(-|_|$)/i.test(v.lang) && v.localService) ?? synth.getVoices().find((v) => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    synth.speak(u);
  } catch {
    // No speech: the chime and the message carry the signal.
  }
}
