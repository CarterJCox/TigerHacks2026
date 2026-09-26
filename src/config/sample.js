// The bundled demo clip behind "Try a sample". Swap the file in
// public/demo/ and update these fields to use your own footage.
// Source: Pexels (free to use), "Man doing seated row exercise",
// https://www.pexels.com/video/man-doing-seated-row-exercise-6022753/

const BASE = import.meta.env.BASE_URL || '/';

export const SAMPLE = {
  url: `${BASE}demo/seated-row.mp4`,
  fileName: 'seated-row.mp4',
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
