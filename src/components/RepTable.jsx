import { getExercise } from '../config/exercises/index.js';
import { fmtNum, fmtDelta, listReps } from '../lib/report/format.js';
import { STATUS } from './status.js';
import { useMetricHover } from './highlight.js';

function unitHeader(def) {
  if (def.unit === '°') return '°';
  if (def.unit === 's') return 's';
  return def.unit;
}

export default function RepTable({ analysis, selectedRep, onRep }) {
  const cfg = getExercise(analysis.exerciseId);
  const keys = Object.keys(cfg.metrics);
  const hover = useMetricHover();
  return (
    <div className="table-wrap" role="region" aria-label="Rep-by-rep measurements" tabIndex={0}>
      <table className="rep-table">
        <thead>
          <tr>
            <th scope="col" className="sticky">
              Rep
            </th>
            <th scope="col">Result</th>
            <th scope="col" className="num">
              Score
            </th>
            {keys.map((k) => (
              <th scope="col" key={k} className="num th-metric" tabIndex={0} {...hover(k)}>
                <span className="th-label">{cfg.metrics[k].short}</span>
                <span className="th-unit">{unitHeader(cfg.metrics[k])}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="row-baseline">
            <th scope="row" className="sticky">
              Base
            </th>
            <td>
              <span className="muted">{listReps(analysis.baselineReps)}</span>
            </td>
            <td className="num muted">–</td>
            {keys.map((k) => {
              const s = analysis.stats[k];
              const def = cfg.metrics[k];
              return (
                <td key={k} className="num" {...hover(k)}>
                  <span className="cell-value">{fmtNum(s.mean, def)}</span>
                  {s.n > 1 && (
                    <span className="cell-delta muted">
                      {fmtNum(s.min, def)}–{fmtNum(s.max, def)}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
          {analysis.reps.map((r) => {
            const s = STATUS[r.status] || STATUS.unknown;
            return (
              <tr
                key={r.index}
                className={`${selectedRep === r.index ? 'is-selected' : ''} ${r.index === analysis.breakdown?.rep ? 'is-breakdown' : ''}`}
                onClick={() => onRep(r.index)}
              >
                <th scope="row" className="sticky">
                  <button type="button" className="rep-link" onClick={(e) => {
                    e.stopPropagation();
                    onRep(r.index);
                  }} aria-label={`Play rep ${r.index}`}>
                    {r.index}
                  </button>
                </th>
                <td>
                  <span className={`status-pill s-${r.status}`}>
                    <i aria-hidden="true" />
                    {r.isBaseline ? 'Baseline' : s.label}
                  </span>
                  {r.partial && <span className="tag tag-small">Partial</span>}
                  {r.truncated && <span className="tag tag-small">Cut off</span>}
                  {!r.truncated && r.lowConfidence && <span className="tag tag-small">Unclear</span>}
                </td>
                <td className="num">{r.score ?? '–'}</td>
                {keys.map((k) => {
                  const def = cfg.metrics[k];
                  const d = r.deviations[k];
                  const flagged = d?.level === 'notable' || d?.level === 'major';
                  return (
                    <td key={k} className={`num ${flagged ? `lvl-${d.level}` : ''}`} {...hover(k)}>
                      <span className="cell-value">{fmtNum(r.metrics[k], def)}</span>
                      {!r.isBaseline && d && Number.isFinite(d.delta) && <span className="cell-delta">{fmtDelta(d, def)}</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
