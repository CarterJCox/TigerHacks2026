// The demo clip behind "Try a sample". To use your own footage:
//   1. Put the video in public/demo/ (MP4 or MOV, one set, filmed from the
//      view the exercise needs: side for curl/row/squat, front for press).
//   2. Set `file` to its file name, and `title` / `description` for the
//      setup screen.
//   3. Set `input.exerciseId` ('curl' | 'press' | 'row' | 'squat'),
//      `plannedReps`, and either `weight` + `unit` or `weightLabel`
//      ("Resistance band") / `bodyweight: true` (squat only).
// Sample runs are never saved to history.
//
// Current clip: Pexels (free to use), "Man doing seated row exercise",
// https://www.pexels.com/video/man-doing-seated-row-exercise-6022753/

const BASE = import.meta.env.BASE_URL || '/';

const file = 'seated-row.mp4';

export const SAMPLE = {
  url: `${BASE}demo/${file}`,
  fileName: file,
  title: 'Seated row, side view',
  description: '15 seconds, about 10 reps with a resistance band.',
  input: {
    exerciseId: 'row',
    weight: 0,
    weightLabel: 'Resistance band',
    unit: 'lb',
    bodyweight: false,
    plannedReps: 10,
    painReported: false,
    notes: '',
    sample: true,
  },
};
