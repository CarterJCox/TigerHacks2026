// press.js: Dumbbell shoulder press, filmed from the front.
//
// Every threshold used to analyze a shoulder press lives in this file.
// Units: degrees (°) for angles, seconds (s) for time, and "% torso" for
// distances expressed as a percentage of the user's torso length (shoulder
// midpoint to hip midpoint). Normalizing by torso length makes the numbers
// independent of how far the camera is.
// See curl.js for what mode / direction / minAbsChange / weight / maxStatus mean.

export default {
  id: 'press',
  name: 'Dumbbell shoulder press',
  shortName: 'Shoulder press',
  view: 'front',
  viewLabel: 'Front view',
  allowBodyweight: false,

  guide: {
    headline: 'Film from straight in front, at chest height.',
    diagram: 'front',
    points: [
      'Face the camera squarely. Both shoulders, elbows and wrists need to be visible the whole time.',
      'Frame yourself from above the dumbbells at full lockout down to your knees (or the bench if seated).',
      'Put the camera at chest height, 2 to 3 metres away, level rather than tilted.',
      'Avoid mirrors or other people directly behind you; the pose model can latch onto them.',
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

  // Facing the camera, the shoulder span is large relative to torso length.
  // Below this ratio the camera is too far to the side for left/right comparison.
  viewCheck: {
    minShoulderRatio: 0.45,
  },

  camera: { maxJumpTorso: 0.6, maxTorsoSpread: 1.28 },

  // Rep detection runs on average wrist height above the shoulders (% torso),
  // so the signal rises as the dumbbells go up.
  reps: {
    concentricFirst: true,
    minAbsProminence: 20, // wrists must travel at least 20% of torso length
    minProminenceFrac: 0.35,
    partialFrac: 0.65,
    restTolFrac: 0.12,
    peakTolFrac: 0.1,
    minRepSec: 0.6,
    maxRepSec: 12,
    minReps: 2,
  },

  baseline: { maxReps: 3, threeRepMinSet: 6 },

  scoring: { penaltyPerMajor: 30, yellowBelow: 85, redBelow: 60, sustainReps: 2 },

  metrics: {
    rom: {
      label: 'Pressing range',
      short: 'Range',
      unit: '% torso',
      decimals: 0,
      direction: 'decrease',
      mode: 'relative',
      notable: 0.12,
      major: 0.25,
      minAbsChange: 6,
      weight: 1,
      reliability: 'high',
      description: 'How far the wrists travel from the bottom of the rep to lockout, as a percentage of torso length.',
      phrase: { worse: 'pressing range dropped {pct}% ({range})' },
    },
    heightAsym: {
      label: 'Left/right height gap at the top',
      short: 'Height gap',
      unit: '% torso',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 7,
      major: 14,
      minAbsChange: 4,
      weight: 1,
      reliability: 'medium',
      description: 'Difference in wrist height between the two arms at the top of the rep.',
      phrase: { worse: 'one arm started finishing lower than the other (height gap {range})' },
    },
    elbowAsym: {
      label: 'Left/right lockout gap',
      short: 'Lockout gap',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 10,
      major: 20,
      minAbsChange: 6,
      weight: 0.7,
      reliability: 'low',
      description: 'Difference between the two elbow angles at the top. Front-on elbow angles are foreshortened when the elbows move forward, so treat this as approximate.',
      phrase: { worse: 'the arms stopped locking out evenly ({base} → {value} difference)' },
    },
    lateralLean: {
      label: 'Side lean',
      short: 'Side lean',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 4,
      major: 8,
      minAbsChange: 2.5,
      weight: 1,
      reliability: 'high',
      description: 'Largest sideways tilt of the torso (hip midpoint to shoulder midpoint) during the rep.',
      phrase: { worse: 'your torso started leaning to one side ({base} → {value})' },
    },
    legDrive: {
      label: 'Leg drive',
      short: 'Leg drive',
      unit: '% torso',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 5,
      major: 10,
      minAbsChange: 3,
      weight: 0.8,
      reliability: 'medium',
      description: 'How far the hips dip and rise during the rep. Near zero when seated or when the press comes only from the arms.',
      phrase: { worse: 'your legs started helping the press (hip dip {range})' },
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
      description: 'Seconds from lockout back down to the shoulders.',
      phrase: { worse: 'the lowering got faster ({base} → {value})' },
    },
    liftTime: {
      label: 'Pressing time',
      short: 'Pressing',
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
      description: 'Seconds from the shoulders to lockout. Slowing down is a fatigue signal rather than a form fault.',
      phrase: { worse: 'the press slowed down ({base} → {value})' },
    },
  },

  risks: [
    {
      id: 'press-lean',
      metric: 'lateralLean',
      minLevel: 'notable',
      title: 'Side bend under load',
      text: 'Leaning to one side while pressing loads the lower back and one shoulder more than the other.',
    },
    {
      id: 'press-asym',
      metric: 'heightAsym',
      minLevel: 'notable',
      title: 'Arms finishing unevenly',
      text: 'When one arm finishes lower, the two shoulders are no longer sharing the load evenly, and the weaker side is working closer to its limit.',
    },
    {
      id: 'press-lockout',
      metric: 'elbowAsym',
      minLevel: 'major',
      title: 'Uneven lockout',
      text: 'One elbow stopping short of the other is another sign that one side is working harder than the other.',
    },
    {
      id: 'press-legs',
      metric: 'legDrive',
      minLevel: 'notable',
      title: 'Legs adding momentum',
      text: 'Dipping and driving with the legs gets the weight moving, but the shoulders then have to catch and control a load they did not press.',
    },
    {
      id: 'press-drop',
      metric: 'lowerTime',
      minLevel: 'notable',
      title: 'Faster lowering to the shoulders',
      text: 'Dropping the dumbbells quickly puts a sudden load on the shoulder joint at the bottom of the rep.',
    },
  ],

  cues: {
    heightAsym: 'Press both dumbbells up together and finish them at the same height.',
    elbowAsym: 'Press both dumbbells up together and finish them at the same height.',
    lateralLean: 'Brace your midsection and keep your ribs stacked over your hips as you press.',
    legDrive: 'Keep your knees still so the press comes from your arms.',
    lowerTime: 'Lower the dumbbells back to your shoulders under control.',
    rom: 'Bring the dumbbells all the way down to shoulder height and press to full extension.',
  },
  defaultCue: 'Press both dumbbells together and keep your ribs stacked over your hips.',

  limitations: [
    'Arching the lower back happens front-to-back and cannot be seen from a front view.',
    'Elbow angles seen from the front shrink when the elbows move forward, so the lockout gap is approximate.',
  ],

  overlay: { joint: 'elbow', series: 'elbowAngleMean', label: 'Elbows' },
};
