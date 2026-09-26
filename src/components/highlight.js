import { createContext, useContext } from 'react';

// Lets any metric label in the results tell the players which joints to
// highlight while it is hovered or focused.
export const HighlightContext = createContext(() => {});

export function useMetricHover() {
  const setHighlight = useContext(HighlightContext);
  return (metricKey) => ({
    onMouseEnter: () => setHighlight(metricKey),
    onMouseLeave: () => setHighlight(null),
    onFocus: () => setHighlight(metricKey),
    onBlur: () => setHighlight(null),
  });
}
