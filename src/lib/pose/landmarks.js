// landmarks.js: MediaPipe Pose landmark indices used by Spotter.
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
};

export const NUM_LANDMARKS = 33;

/** side: 'left' | 'right'; part: 'Shoulder', 'Elbow', ... */
export function sided(side, part) {
  return LM[`${side}${part}`];
}

// Body connections drawn on the overlay (face omitted on purpose).
export const SKELETON = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftElbow'],
  ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'],
  ['rightElbow', 'rightWrist'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['leftAnkle', 'leftHeel'],
  ['leftHeel', 'leftFoot'],
  ['leftAnkle', 'leftFoot'],
  ['rightAnkle', 'rightHeel'],
  ['rightHeel', 'rightFoot'],
  ['rightAnkle', 'rightFoot'],
].map(([a, b]) => [LM[a], LM[b]]);

export const BODY_POINTS = Object.values(LM).filter((i) => i !== LM.nose && i !== LM.leftEar && i !== LM.rightEar);
