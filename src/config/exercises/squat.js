// squat.js: Bodyweight or barbell squat, filmed from the side.
//
// Every threshold used to analyze a squat lives in this file.
// Units: degrees (°), seconds (s), and "% foot" (heel height as a percentage
// of the heel-to-toe length, independent of camera distance).
// See curl.js for what mode / direction / minAbsChange / weight / maxStatus mean.

export default {
  id: 'squat',
  name: 'Squat',
  shortName: 'Squat',
  view: 'side',
  viewLabel: 'Side view',
  allowBodyweight: true,

  guide: {
    headline: 'Film from the side, level with your hips.',
    diagram: 'side',
    points: [
      'Stand side-on to the camera. Your whole body, including both feet, has to stay in frame at the top and at the bottom.',
      'Camera at hip height, 3 to 4 metres away, level rather than tilted.',
      'Wear something that shows the shape of your hips and knees; very loose clothing hides the joints.',
      'Keep the rack or plates from blocking your hips and knees if you can.',
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
    minTorsoFraction: 0.08,
  },

  viewCheck: { maxShoulderRatio: 0.55 },

  // Rep detection runs on knee flexion (180° minus the knee angle): the
  // signal rises on the way down.
  reps: {
    concentricFirst: false, // the lowering phase comes first
    minAbsProminence: 35,
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
      label: 'Depth (knee bend)',
      short: 'Depth',
      unit: '°',
      decimals: 0,
      direction: 'decrease',
      mode: 'relative',
      notable: 0.1,
      major: 0.2,
      minAbsChange: 8,
      weight: 1,
      reliability: 'high',
      description: 'How far the knee bends from standing to the bottom of the rep.',
      phrase: { worse: 'depth dropped {pct}% ({base} → {value} of knee bend)' },
    },
    forwardLean: {
      label: 'Forward lean at the bottom',
      short: 'Lean',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 6,
      major: 12,
      minAbsChange: 3,
      weight: 1,
      reliability: 'high',
      description: 'Largest forward tilt of the torso from vertical during the rep.',
      phrase: { worse: 'your chest started dropping forward ({base} → {value} of lean)' },
    },
    hipsRiseFirst: {
      label: 'Hips rising first',
      short: 'Hips first',
      unit: '°',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 5,
      major: 10,
      minAbsChange: 3,
      weight: 1,
      reliability: 'medium',
      description: 'Extra forward lean that appears on the way up compared with the bottom position. It grows when the hips rise faster than the chest.',
      phrase: { worse: 'your hips started rising before your chest ({base} → {value} of extra lean)' },
    },
    heelLift: {
      label: 'Heel lift',
      short: 'Heel lift',
      unit: '% foot',
      decimals: 0,
      direction: 'increase',
      mode: 'absolute',
      notable: 8,
      major: 15,
      minAbsChange: 5,
      weight: 0.6,
      reliability: 'low',
      description: 'How far the heel rises relative to the toes, as a percentage of foot length. Foot landmarks are the least stable points the pose model tracks.',
      phrase: { worse: 'your heels started lifting ({base} → {value})' },
    },
    lowerTime: {
      label: 'Descent time',
      short: 'Descent',
      unit: 's',
      decimals: 2,
      direction: 'decrease',
      mode: 'relative',
      notable: 0.3,
      major: 0.5,
      minAbsChange: 0.25,
      weight: 0.6,
      reliability: 'medium',
      description: 'Seconds from standing to the bottom of the squat.',
      phrase: { worse: 'the descent got faster ({base} → {value})' },
    },
    liftTime: {
      label: 'Ascent time',
      short: 'Ascent',
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
      description: 'Seconds from the bottom back to standing. Slowing down is a fatigue signal rather than a form fault.',
      phrase: { worse: 'the ascent slowed down ({base} → {value})' },
    },
  },

  risks: [
    {
      id: 'squat-lean',
      metric: 'forwardLean',
      minLevel: 'notable',
      title: 'Chest dropping forward',
      text: 'More forward lean moves more of the load onto the lower back.',
    },
    {
      id: 'squat-hips',
      metric: 'hipsRiseFirst',
      minLevel: 'notable',
      title: 'Hips rising before the chest',
      text: 'When the hips come up first, the squat turns into more of a hip hinge and the lower back takes over the lift out of the bottom.',
    },
    {
      id: 'squat-heels',
      metric: 'heelLift',
      minLevel: 'notable',
      title: 'Heels coming up',
      text: 'Weight shifting onto the toes increases the load on the front of the knee and makes balance harder.',
    },
    {
      id: 'squat-drop',
      metric: 'lowerTime',
      minLevel: 'notable',
      title: 'Dropping into the bottom',
      text: 'A faster descent means the knees and hips absorb the load more suddenly at the bottom.',
    },
    {
      id: 'squat-depth',
      metric: 'rom',
      minLevel: 'major',
      title: 'Squats getting shallower',
      text: 'A large drop in depth usually shows up close to fatigue, which is when compensation patterns tend to appear.',
    },
  ],

  cues: {
    forwardLean: 'Keep your chest up as you sit down between your hips.',
    hipsRiseFirst: 'Drive up so your hips and chest rise together.',
    heelLift: 'Keep your whole foot, heel included, pressed into the floor.',
    lowerTime: 'Lower yourself at the same controlled speed as your first reps.',
    rom: 'Sit to the same depth on every rep.',
  },
  defaultCue: 'Keep your chest up and let your hips and chest rise together.',

  limitations: [
    'Knees caving inward can only be seen from the front and is not measured from a side view.',
    'Lower-back rounding at the bottom is not measured directly; torso angle is a straight line from hip to shoulder.',
    'Only the leg nearest the camera is measured.',
  ],

  overlay: { joint: 'knee', series: 'kneeAngle', label: 'Knee' },
};
