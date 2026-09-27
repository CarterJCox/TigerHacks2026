// Live recording: camera setup, the hands-free start and stop, and the live
// stop signal. The form limits themselves are NOT here: live alerts reuse the
// red limits in each exercise's `standards.rules` (and its holdSec and
// minVisibility), so there is only one set of form thresholds.
// Times are in seconds.

export const LIVE = {
  // Pose detection on the camera feed. Frames arriving faster than this are
  // skipped, so detection never queues up behind the camera.
  targetFps: 15,
  // If detection can't keep up (measured over the first warmUpSec of
  // recording), live alerts switch off with a note and recording continues.
  minFps: 8,
  warmUpSec: 3,
  // Weight of the newest frame when smoothing landmarks (1 = raw). 0.55
  // removes most jitter for about one frame of lag (~65 ms at 15 fps).
  smoothing: 0.55,

  alerts: {
    // Swing, rocking and side-lean rules measure movement against the body's
    // own position a moment earlier: the reference is the steadiest extreme
    // (held for the rule's holdSec) within this rolling window.
    windowSec: 2.5,
    // A red rule must stay crossed this long, on every frame, before the
    // signal fires: about 5 frames at 15 fps. Any frame below the limit,
    // with unclear joints, or with a failed view check restarts the count.
    // A false alarm mid-set is worse than a missed one.
    sustainSec: 0.35,
    minSustainFrames: 4,
    // After an alert, nothing fires again for this long (any rule), and a
    // rule has to be clear for rearmSec before it can fire again, so one
    // continuing pattern never alerts twice.
    cooldownSec: 8,
    rearmSec: 0.6,
    // Shoulder-width-to-torso ratio (the same view check as the quality
    // gate) is taken as the median over this window.
    viewWindowSec: 1,
    // How long the on-screen message stays up.
    showSec: 4,
    // Spoken after the tone. Calm and short; the lifter may be holding a
    // heavy weight, so nothing sudden or loud.
    speech: 'Ease off. Set it down.',
  },

  // Getting into position before recording starts.
  ready: {
    holdSec: 2, // stay ready this long before the countdown starts
    countdownSec: 3,
    minJointVisibility: 0.6, // head, shoulders, hips, knees (and feet for squats) must all be this visible
    edgeMargin: 0.02, // ...and at least 2% of the frame away from its edges
    minBrightness: 45, // mean frame brightness (0-255) below this asks for more light
    smoothSec: 0.5, // readiness checks must hold for most of this window, so the indicator doesn't flicker
  },

  // Hands-free stop.
  autoStop: {
    minRecordSec: 3, // never stop on its own in the first 3 s
    lostSec: 1.2, // out of frame (no shoulders or hips) for 1.2 s
    approachRatio: 1.35, // torso 35% larger than at the start of recording = walking toward the camera
    approachSec: 0.5,
    baselineSec: 1.5, // torso size is measured over the first 1.5 s of recording
    idleSec: 4, // no rep movement for 4 s once at least one rep is done
  },

  // Live rep counter on the exercise's rep signal (elbow or knee flexion,
  // wrist height for the press), relative to the range seen so far.
  reps: {
    upFrac: 0.5, // a rep starts when the signal is half-way up its range
    downFrac: 0.25, // ...and counts when it's back within the bottom quarter
    moveFrac: 0.15, // movement of 15% of the range counts as "still moving" for the idle stop
  },
};
