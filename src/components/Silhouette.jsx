// A faint outline of where to stand in the camera view: side-on for curls,
// rows and squats, facing the camera for the press. Drawn in a 100 x 100
// box that the parent scales over the video.

export default function Silhouette({ view, pose = 'stand' }) {
  const seated = pose === 'seated';
  return (
    <svg className="silhouette" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {view === 'front' ? (
        <g>
          <circle cx="50" cy="15" r="5.2" />
          <path d="M40 24 Q50 21 60 24 L62 50 Q56 52 50 52 Q44 52 38 50 Z" />
          <path d="M40 25 L31 29 L29 16 M60 25 L69 29 L71 16" />
          <path d="M44 52 L42 72 L42 91 M56 52 L58 72 L58 91" />
        </g>
      ) : seated ? (
        <g>
          <circle cx="42" cy="30" r="5.2" />
          <path d="M40 37 L38 64 L52 64 L48 38 Z" />
          <path d="M44 42 L58 50 L70 50" />
          <path d="M40 64 L64 64 L84 66" />
        </g>
      ) : (
        <g>
          <circle cx="50" cy="15" r="5.2" />
          <path d="M47 23 Q53 22 54 26 L55 51 L46 51 L45 26 Z" />
          <path d="M50 27 L49 40 L50 52" />
          <path d="M48 51 L48 72 L47 91 M53 51 L52 72 L53 91" />
          <path d="M46 91 L56 91" />
        </g>
      )}
    </svg>
  );
}
