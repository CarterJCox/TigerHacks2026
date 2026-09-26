import curl from './curl.js';
import press from './press.js';
import row from './row.js';
import squat from './squat.js';

export const EXERCISES = { curl, press, row, squat };
export const EXERCISE_ORDER = ['curl', 'press', 'row', 'squat'];

export function getExercise(id) {
  const cfg = EXERCISES[id];
  if (!cfg) {
    throw new Error(`Unknown exercise: ${id}`);
  }
  return cfg;
}
