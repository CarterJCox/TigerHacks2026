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

  viewCheck: { maxShoulderRatio: 0.5 },

  // Rep detection runs on knee flexion (180° minus the knee angle): the
  // signal rises on the way down.
  reps: {
    concentricFirst: false, // the lowering phase comes first
    minAbsProminence: 30, // the knee must bend at least 30°
    minProminenceFrac: 0.35,
    partialFrac: 0.65,
    restTolFrac: 0.12,
    peakTolFrac: 0.1,
    bridgeGapSec: 1.5,
    minRepSec: 0.6,
    maxRepSec: 12,
    minReps: 2,
  },

  camera: { maxJumpTorso: 0.6, maxTorsoSpread: 1.28 },

  baseline: { maxReps: 3, threeRepMinSet: 6 },

  scoring: { penaltyPerMajor: 30, yellowBelow: 85, redBelow: 60, sustainReps: 2 },

  // Form standards: fixed limits for every rep. See curl.js for the fields.
  // Not checked from a side view:
  //   - Knees caving in: that movement is side to side, so it can only be
  //     seen from the front.
  //   - Heels lifting: heel and toe are the least stable points the pose
  //     model tracks, and the far foot often overlaps the near one, so a red
  //     flag would too often be wrong.
  //   - Bouncing out of the bottom: the rebound lasts 1-3 frames at 15 frames
  //     per second and can't be told apart from a normal turnaround. A fast
  //     drop into the bottom is caught by the descent check.
  standards: {
    holdSec: 0.2,
    minVisibility: 0.7,
    minClearFraction: 0.8,
    // Shown in the Details drawer under the form standards.
    notChecked: [
      'Knees caving in: only visible from the front.',
      'Heels lifting: foot points are the least stable the pose model tracks.',
      'Bouncing out of the bottom: too brief to separate from a normal turnaround at 15 frames per second.',
    ],
    rules: [
      {
        // Torso and shins roughly parallel keeps the load shared between hips
        // and knees. Leaning far past the shin angle turns the squat into a
        // good-morning and moves the load onto the lower back. Comparing with
        // the shins scales the limit to depth: deeper squats tilt both more.
        id: 'excessLean',
        cue: 'forwardLean', // coaching cue shown when this flags (key in `cues`)
        label: 'Forward lean for the depth',
        short: 'chest dropping forward',
        series: 'leanOverShin',
        measure: 'max',
        window: 'rep',
        joints: ['Shoulder', 'Hip', 'Knee', 'Ankle'],
        unit: '°',
        decimals: 0,
        worse: 'above',
        ideal: 0,
        red: 30,
        says: 'Torso leaned {value} further forward than your shins',
      },
      {
        // Stopping well above parallel leaves out the deep part of the squat,
        // where the glutes and quads work hardest.
        id: 'depth',
        cue: 'depth', // coaching cue shown when this flags (key in `cues`)
        label: 'Depth',
        short: 'shallow depth',
        series: 'thighRise',
        measure: 'min',
        window: 'rep',
        joints: ['Hip', 'Knee'],
        unit: '°',
        decimals: 0,
        worse: 'above',
        ideal: 0,
        yellow: 30, // thighs more than 30° above parallel: about a half squat
        says: 'Thighs stayed {value} above parallel at the bottom',
      },
      {
        // Dropping into the bottom much faster than standing up gives up
        // control where the knees and hips are most loaded.
        id: 'lowering',
        cue: 'lowerTime', // coaching cue shown when this flags (key in `cues`)
        label: 'Controlled descent',
        short: 'dropping into the bottom',
        measure: 'tempo',
        window: 'rep',
        joints: ['Hip', 'Knee', 'Ankle'],
        unit: '%',
        decimals: 0,
        worse: 'below',
        ideal: 100,
        yellow: 50,
        says: 'The descent took {value} of the time it took to stand up',
        limitText: 'aim for {limit} or more',
      },
    ],
  },

  metrics: {
    rom: {
      label: 'Depth (knee bend)',
      short: 'Depth',
      body: ['Hip', 'Knee', 'Ankle'],
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
      body: ['Shoulder', 'Hip'],
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
      body: ['Shoulder', 'Hip', 'Knee'],
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
      body: ['Ankle', 'Heel', 'Foot'],
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
      phrase: { worse: 'your heels started lifting ({range})' },
    },
    lowerTime: {
      label: 'Descent time',
      short: 'Descent',
      body: ['Hip', 'Knee', 'Ankle'],
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
      body: ['Hip', 'Knee', 'Ankle'],
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
    depth: 'Sit down until your thighs are close to parallel with the floor, as long as it stays comfortable.',
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
