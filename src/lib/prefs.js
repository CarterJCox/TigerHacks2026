// Remembers the last selected exercise and the last weight used for each
// exercise, so the form is pre-filled next time. Stored in this browser only.

const KEY = 'spotter.lastInput.v1';

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export function weightFor(exerciseId) {
  const w = read().weights?.[exerciseId];
  return w && typeof w === 'object' ? w : null;
}

export function rememberInput(input) {
  try {
    const data = read();
    data.exerciseId = input.exerciseId;
    data.weights = data.weights || {};
    const hasWeight = input.bodyweight || (input.weight !== '' && Number(input.weight) > 0);
    if (hasWeight) {
      data.weights[input.exerciseId] = { weight: input.bodyweight ? '' : String(input.weight), unit: input.unit, bodyweight: Boolean(input.bodyweight) };
    }
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode): the form just starts empty.
  }
}

/** Default form input with the remembered exercise and its weight filled in. */
export function initialInput(defaults) {
  const data = read();
  const exerciseId = typeof data.exerciseId === 'string' ? data.exerciseId : defaults.exerciseId;
  const w = data.weights?.[exerciseId];
  return {
    ...defaults,
    exerciseId,
    ...(w ? { weight: w.weight ?? '', unit: w.unit === 'kg' ? 'kg' : 'lb', bodyweight: Boolean(w.bodyweight) } : {}),
  };
}
