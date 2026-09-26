// Camera setup guide shown before upload. The diagram is a top-down view of
// where the phone goes relative to the lifter.

function PlacementDiagram({ view, distance }) {
  const side = view === 'side';
  // Person at center, facing right. Camera below (side view) or to the right (front view).
  const cam = side ? { x: 170, y: 160, rot: 0 } : { x: 300, y: 84, rot: -90 };
  const person = side ? { x: 170, y: 70 } : { x: 150, y: 84 };
  return (
    <svg className="guide-diagram" viewBox="0 0 340 190" role="img" aria-label={side ? 'Top-down diagram: camera placed at your side, pointing at you' : 'Top-down diagram: camera placed in front of you, pointing at you'}>
      <defs>
        <linearGradient id="fov-h" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id="fov-v" x1="0" x2="0" y1="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="339" height="189" rx="14" className="guide-floor" />
      {/* field of view */}
      {side ? (
        <path d="M170 150 L104 14 L236 14 Z" fill="url(#fov-v)" />
      ) : (
        <path d="M288 84 L110 14 L110 154 Z" fill="url(#fov-h)" />
      )}
      {/* person, top-down: shoulders + head, facing right */}
      <g transform={`translate(${person.x} ${person.y})`}>
        <ellipse cx="0" cy="0" rx="13" ry="30" className="guide-body" />
        <circle cx="6" cy="0" r="10" className="guide-head" />
        <path d="M22 0 L38 0 M32 -5 L38 0 L32 5" className="guide-facing" />
      </g>
      <text x={person.x - 32} y={person.y + 4} className="guide-label" textAnchor="end">
        you
      </text>
      {/* camera */}
      <g transform={`translate(${cam.x} ${cam.y}) rotate(${cam.rot})`}>
        <rect x="-15" y="-9" width="30" height="18" rx="4" className="guide-cam" />
        <circle cx="0" cy="-9" r="4" className="guide-lens" />
      </g>
      <text x={side ? 196 : 300} y={side ? 164 : 118} className="guide-label" textAnchor={side ? 'start' : 'middle'}>
        camera
      </text>
      {/* distance marker */}
      {side ? (
        <g className="guide-measure">
          <path d="M252 70 L252 160" />
          <path d="M247 70 L257 70 M247 160 L257 160" />
          <text x="264" y="119" textAnchor="start">
            {distance}
          </text>
        </g>
      ) : (
        <g className="guide-measure">
          <path d="M184 148 L284 148" />
          <path d="M184 143 L184 153 M284 143 L284 153" />
          <text x="234" y="170" textAnchor="middle">
            {distance}
          </text>
        </g>
      )}
    </svg>
  );
}

export default function CameraGuide({ exercise }) {
  const distance = exercise.id === 'squat' ? '3–4 m' : '2–3 m';
  return (
    <section className="guide" aria-labelledby="guide-title">
      <div className="guide-head-row">
        <h3 id="guide-title">Camera setup</h3>
        <span className="tag">{exercise.viewLabel}</span>
      </div>
      <p className="guide-lede">{exercise.guide.headline}</p>
      <PlacementDiagram view={exercise.view} distance={distance} />
      <ul className="guide-points">
        {exercise.guide.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}
