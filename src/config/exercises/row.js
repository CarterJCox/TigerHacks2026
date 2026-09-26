// row.js: Seated cable row, filmed from the side.
//
// Every threshold used to analyze a seated cable row lives in this file.
// Units: degrees (°), seconds (s), and "% torso" (distance as a percentage of
// torso length, which makes numbers independent of camera distance).
// See curl.js for what mode / direction / minAbsChange / weight / maxStatus mean.

export default {
  id: 'row',
  name: 'Seated cable row',
  shortName: 'Cable row',
  view: 'side',
  viewLabel: 'Side view',
  allowBodyweight: false,

  guide: {
    headline: 'Film from the side, level with the seat.',
    diagram: 'side',
    points: [
      'Place the camera directly to your side so your body and the cable run left to right across the frame.',
      'Keep your head, hands at full reach, hips and knees in frame for the whole set.',
      'Camera at about seat-to-shoulder height, 2 to 3 metres away and level.',
      'The machine should not block your torso or the arm nearest the camera.',
      'Start recording before the first rep and stop after the last one.',
    ],
  },

  pose: {
    minLandmarkVisibility: 0.5,
    maxGapSec: 0.4,
    smoothingSigmaSec: 0.07,
    minPoseFraction: 0.6,
    minKeyFraction: 0.6,
    minRepConfidence: 0.7,
    minTorsoFraction: 0.1,
  },

  viewCheck: { maxShoulderRatio: 0.55 },

  // Rep detection runs on elbow flexion (180° minus the elbow angle): the
  // signal rises as the handle is pulled in.
  reps: {
    concentricFirst: true,
    minAbsProminence: 25, // the elbow must bend at least 25° (real rows move 60°+; resting jitter is about ±5°)
    minProminenceFrac: 0.35,
    partialFrac: 0.65,
    restTolFrac: 0.12,
    peakTolFrac: 0.1,
    minRepSec: 0.6,
    maxRepSec: 12,
    minReps: 2,
  },

  camera: { maxJumpTorso: 0.6, maxTorsoSpread: 1.28 },

  baseline: { maxReps: 3, threeRepMinSet: 6 },

  scoring: { penaltyPerMajor: 30, yellowBelow: 85, redBelow: 60, sustainReps: 2 },

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
      description: 'How far the elbow bends between full reach and the end of the pull.',
      phrase: { worse: 'range of motion dropped {pct}% ({base} → {value})' },
    },
    torsoSwing: {
      label: 'Torso rocking',
      short: 'Torso rock',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 6,
      major: 12,
      minAbsChange: 3,
      weight: 1,
      reliability: 'high',
      description: 'How far the torso rocks forward and back during the rep (range of the hip-to-shoulder angle).',
      phrase: { worse: 'your torso started rocking ({base} → {value} of movement)' },
    },
    leanBack: {
      label: 'Lean-back at the finish',
      short: 'Lean back',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 5,
      major: 10,
      minAbsChange: 3,
      weight: 0.8,
      reliability: 'high',
      description: 'How far behind vertical the torso leans at its furthest point in the rep. Negative means it stayed in front of vertical.',
      phrase: { worse: 'you started leaning back to finish the pull ({base} → {value})' },
    },
    shrug: {
      label: 'Shoulder shrug',
      short: 'Shrug',
      unit: '% torso',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 4,
      major: 8,
      minAbsChange: 2.5,
      weight: 0.6,
      reliability: 'low',
      description: 'How much the gap between ear and shoulder closes during the pull. Head movement also changes this, so treat it as approximate.',
      phrase: { worse: 'your shoulders started creeping up (shrug {range})' },
    },
    lowerTime: {
      label: 'Return time',
      short: 'Return',
      unit: 's',
      decimals: 2,
      direction: 'decrease',
      mode: 'relative',
      notable: 0.3,
      major: 0.5,
      minAbsChange: 0.25,
      weight: 0.6,
      reliability: 'medium',
      description: 'Seconds from the end of the pull back to full reach.',
      phrase: { worse: 'the return got faster ({base} → {value})' },
    },
    liftTime: {
      label: 'Pulling time',
      short: 'Pulling',
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
      description: 'Seconds from full reach to the end of the pull. Slowing down is a fatigue signal rather than a form fault.',
      phrase: { worse: 'the pull slowed down ({base} → {value})' },
    },
  },

  risks: [
    {
      id: 'row-rock',
      metric: 'torsoSwing',
      minLevel: 'notable',
      title: 'Lower back doing the pulling',
      text: 'Rocking the torso to move the handle shifts work from the upper back onto the lower back.',
    },
    {
      id: 'row-lean',
      metric: 'leanBack',
      minLevel: 'notable',
      title: 'Leaning back to finish reps',
      text: 'Leaning further back to complete the pull uses body weight as a lever and loads the lower back.',
    },
    {
      id: 'row-shrug',
      metric: 'shrug',
      minLevel: 'notable',
      title: 'Shoulders creeping toward the ears',
      text: 'Shrugging during the pull shifts work to the upper traps and neck.',
    },
    {
      id: 'row-snap',
      metric: 'lowerTime',
      minLevel: 'notable',
      title: 'Handle pulling you forward',
      text: 'A faster return means the cable is pulling the shoulders and lower back forward into the stretched position rather than you controlling it.',
    },
  ],

  cues: {
    torsoSwing: 'Keep your torso still and upright; let your arms and shoulder blades do the pulling.',
    leanBack: 'Keep your torso still and upright; let your arms and shoulder blades do the pulling.',
    shrug: 'Keep your shoulders down away from your ears as you pull.',
    lowerTime: 'Let the handle travel back slowly instead of letting it pull you forward.',
    rom: 'Reach your arms fully forward and bring the handle all the way to your stomach each rep.',
  },
  defaultCue: 'Keep your torso still and bring the handle to your stomach under control.',

  limitations: [
    'Only the arm nearest the camera is measured.',
    'Rounding of the lower back is not measured directly; torso angle is a straight line from hip to shoulder.',
    'Left/right differences need a front view and are not measured for this exercise.',
  ],

  overlay: { joint: 'elbow', series: 'elbowAngle', label: 'Elbow' },
};
