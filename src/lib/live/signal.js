// Turns live monitor results into the stop signal's sound. Only a red alert
// ever makes a sound; yellow flags are shown as a faint tint at most.
// The sound functions are passed in, so tests can check what would play.

import { LIVE } from '../../config/live.js';

export function createAlertSignal({ playTone, speak, isMuted, speech = LIVE.alerts.speech, schedule = (fn, ms) => setTimeout(fn, ms) }) {
  /** Returns true when this frame raised the stop signal. */
  return function onResult(result) {
    if (!result?.alert) return false;
    if (!isMuted()) {
      playTone();
      // The spoken cue follows the tone once it has faded.
      schedule(() => speak(speech), 650);
    }
    return true;
  };
}
