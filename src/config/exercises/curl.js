// curl.js: Dumbbell bicep curl, filmed from the side.
//
// Every threshold used to analyze a curl lives in this file. Units:
//   degrees (°) for angles, seconds (s) for time.
// Metric thresholds are compared against the user's own baseline reps
// (the first 2-3 clean reps of the same set), never against an ideal. A rep
// only counts as changed by how far it goes beyond the range the baseline reps
// already covered (e.g. below the smallest baseline range of motion).
//   mode 'absolute': notable/major are in the metric's own unit.
//   mode 'relative': notable/major are fractions of the baseline value
//                    (0.25 = a 25% change).
//   minAbsChange:    changes smaller than this (in the metric's unit) are
//                    treated as measurement noise and ignored.
//   direction:       which way counts as worse. Changes in the other
//                    direction are reported but never penalized.
//   weight:          how much this metric pulls down the 0-100 rep score.
//   maxStatus:       'yellow' means this metric alone can never mark a rep red.

export default {
  id: 'curl',
  name: 'Dumbbell bicep curl',
  shortName: 'Bicep curl',
  view: 'side',
  viewLabel: 'Side view',
  allowBodyweight: false,

  guide: {
    headline: 'Film from the side, level with your elbow.',
    diagram: 'side',
    points: [
      'Stand side-on to the camera so the arm you want measured is the one closest to it.',
      'Keep your whole body from head to knees in frame for the entire set, with a little space above your head.',
      'Put the camera at about waist to chest height, 2 to 3 metres away. Don\'t tilt it up or down.',
      'Good, even light. Avoid a bright window behind you.',
      'Start recording before the first rep and stop after the last one.',
    ],
  },

  // Pose-quality gates. If the video fails these, Spotter asks for a better
  // video instead of producing a report.
  pose: {
    minLandmarkVisibility: 0.5, // per-landmark MediaPipe visibility needed to trust a point
    maxGapSec: 0.4, // low-confidence gaps up to this long are interpolated; longer gaps stay empty
    smoothingSigmaSec: 0.07, // Gaussian smoothing width applied to keypoints (about 1 frame at 15 fps)
    minPoseFraction: 0.6, // at least 60% of sampled frames must contain a detected person
    minKeyFraction: 0.6, // ...and the measured arm + torso must be clearly visible in 60% of frames
    minRepConfidence: 0.7, // a rep with less than 70% clear frames is shown but not scored
    minTorsoFraction: 0.1, // torso length must be at least 10% of the frame's long side (person not too far)
  },

  // Camera angle check. Shoulder span is the horizontal distance between the
  // two shoulders divided by torso length. Measured on test clips: side-on
  // about 0.1-0.35, three-quarter about 0.35-0.55, facing the camera 0.55+.
  viewCheck: {
    maxShoulderRatio: 0.5,
  },

  // Camera stability. A still camera is required: joint angles and distances
  // are meaningless if the frame zooms or the shot cuts.
  camera: {
    maxJumpTorso: 0.6, // hips moving more than 0.6 torso lengths in one frame (1/15 s) = a cut or camera jump
    maxTorsoSpread: 1.28, // torso size varying more than 28% across the clip = zoom or camera moved (still-camera clips measured 1.13-1.17)
  },

  // Rep detection runs on elbow flexion (180° minus the elbow angle), so the
  // signal rises as the dumbbell comes up.
  reps: {
    concentricFirst: true, // the lifting phase comes first (curl up, then lower)
    minAbsProminence: 30, // a rep must bend the elbow at least 30°
    minProminenceFrac: 0.35, // ...and at least 35% of the set's full elbow range
    partialFrac: 0.65, // reps under 65% of a typical rep's range are marked partial
    restTolFrac: 0.12, // within 12% of the bottom counts as "at rest" (pauses are excluded from tempo)
    peakTolFrac: 0.1, // within 10% of the top counts as "at the top"
    minRepSec: 0.6,
    maxRepSec: 12,
    minReps: 2, // fewer reps than this and there is nothing to compare
  },

  baseline: {
    maxReps: 3, // use up to the first 3 clean reps as the baseline
    threeRepMinSet: 6, // use 3 baseline reps only if the set has at least 6 scorable reps, else 2 (or 1)
  },

  // Rep colour and score.
  scoring: {
    penaltyPerMajor: 30, // a metric at its "major" threshold costs 30 points x weight
    yellowBelow: 85, // score under 85 -> yellow even if no single metric crossed "notable"
    redBelow: 60, // score under 60 -> red
    sustainReps: 2, // the breakdown point needs 2 off-baseline reps in a row (a red final rep also counts); one-off reps are reported as isolated
  },

  metrics: {
    rom: {
      label: 'Elbow range of motion',
      short: 'Range',
      unit: '°',
      decimals: 0,
      direction: 'decrease',
      mode: 'relative',
      notable: 0.12,
      major: 0.25,
      minAbsChange: 8,
      weight: 1,
      reliability: 'high',
      description: 'How far the elbow bends and straightens in the rep (largest minus smallest elbow angle).',
      phrase: { worse: 'range of motion dropped {pct}% ({base} → {value})', better: 'range of motion grew {pct}%' },
    },
    elbowDrift: {
      label: 'Upper-arm swing',
      short: 'Elbow drift',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 10,
      major: 20,
      minAbsChange: 6,
      weight: 1,
      reliability: 'medium',
      description: 'How far the upper arm swings forward and back relative to the torso during the rep. Pinned elbows keep this small.',
      phrase: { worse: 'your elbow drifted forward ({base} → {value} of upper-arm swing)' },
    },
    torsoSwing: {
      label: 'Torso swing',
      short: 'Torso swing',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 5,
      major: 10,
      minAbsChange: 3,
      weight: 1,
      reliability: 'high',
      description: 'How much the torso rocks forward and back during the rep (range of the hip-to-shoulder angle).',
      phrase: { worse: 'your torso started swinging ({base} → {value} of sway)' },
    },
    lowerTime: {
      label: 'Lowering time',
      short: 'Lowering',
      unit: 's',
      decimals: 2,
      direction: 'decrease',
      mode: 'relative',
      notable: 0.3,
      major: 0.5,
      minAbsChange: 0.25,
      weight: 0.6,
      reliability: 'medium',
      description: 'Seconds from the top of the curl back to a straight arm.',
      phrase: { worse: 'the lowering got faster ({base} → {value})' },
    },
    liftTime: {
      label: 'Lifting time',
      short: 'Lifting',
      unit: 's',
      decimals: 2,
      direction: 'increase',
      mode: 'relative',
      notable: 0.4,
      major: 0.8,
      minAbsChange: 0.3,
      weight: 0.4,
      maxStatus: 'yellow',
      reliability: 'medium',
      description: 'Seconds from a straight arm to the top. Slowing down is a fatigue signal rather than a form fault.',
      phrase: { worse: 'the lift slowed down ({base} → {value})' },
    },
  },

  // Risk factors: movement patterns linked to extra strain. They are tied to
  // the first rep where the metric reached `minLevel`. Not diagnoses.
  risks: [
    {
      id: 'curl-swing',
      metric: 'torsoSwing',
      minLevel: 'notable',
      title: 'Lower back supplying momentum',
      text: 'Rocking the torso to get the weight moving shifts load onto the lower back and makes the rep harder to control.',
    },
    {
      id: 'curl-drift',
      metric: 'elbowDrift',
      minLevel: 'notable',
      title: 'Front of the shoulder taking over',
      text: 'When the upper arm swings forward, the front of the shoulder takes a bigger share of the load and the elbow flexors work through a shorter range.',
    },
    {
      id: 'curl-drop',
      metric: 'lowerTime',
      minLevel: 'notable',
      title: 'Faster, less controlled lowering',
      text: 'A quicker drop means the elbow and biceps tendon take a sharper stretch at the bottom of the rep, where the arm is at its weakest.',
    },
    {
      id: 'curl-rom',
      metric: 'rom',
      minLevel: 'major',
      title: 'Reps getting shorter',
      text: 'A large drop in range usually shows up when the working muscles are close to fatigue, which is when compensation patterns tend to appear.',
    },
  ],

  // Movement cues keyed by the metric that triggered them. At most two are shown.
  cues: {
    elbowDrift: 'Keep your elbows pinned to your sides; only your forearms should move.',
    torsoSwing: 'Keep your chest and hips still, so the curl starts from the elbow and not a lean back.',
    lowerTime: 'Lower the dumbbell as slowly as you did on your first reps.',
    rom: 'Straighten your arm fully at the bottom and curl all the way up on every rep.',
  },
  defaultCue: 'Keep your elbows pinned and lower the weight under control.',

  // Shown on the results page so users know which numbers to trust least.
  limitations: [
    'Only the arm nearest the camera is measured.',
    'Left/right differences need a front view and are not measured for this exercise.',
    'Wrist rotation and grip are not visible to the pose model.',
  ],

  // What the key joint label shows on the video overlay.
  overlay: { joint: 'elbow', series: 'elbowAngle', label: 'Elbow' },
};
