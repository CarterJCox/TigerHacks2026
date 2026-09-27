// Details drawer: each form standard, its limits, and every rep's result.

import { getExercise } from '../config/exercises/index.js';
import { fmt, fmtNum } from '../lib/report/format.js';

const CELL_CLASS = { yellow: 'lvl-notable', red: 'lvl-major' };

function Limits({ rule }) {
  const word = rule.worse === 'above' ? 'over' : 'under';
  return (
    <span className="th-unit std-limits">
      {word}
      {rule.yellow != null && (
        <span className="std-limit">
          <i className="std-dot std-y" aria-label="less effective" />
          {fmt(rule.yellow, rule)}
        </span>
      )}
      {rule.red != null && (
        <span className="std-limit">
          <i className="std-dot std-r" aria-label="injury risk" />
          {fmt(rule.red, rule)}
        </span>
      )}
    </span>
  );
}

export default function FormStandardsTable({ analysis, selectedRep, onRep }) {
  const cfg = getExercise(analysis.exerciseId);
  const rules = cfg.standards?.rules ?? [];
  return (
    <>
      <p className="muted small">
        Every rep, your first ones included, is checked against these fixed limits. Past a <i className="std-dot std-y" /> limit the rep is less effective for
        building muscle; past a <i className="std-dot std-r" /> limit it's an injury risk (a pattern linked to extra strain). A value has to hold for{' '}
        {cfg.standards.holdSec} s to count, and a check is skipped (–) when its joints weren't clearly visible. Select a row to play that rep.
      </p>
      <div className="table-wrap" role="region" aria-label="Form standards by rep" tabIndex={0}>
        <table className="rep-table std-table">
          <thead>
            <tr>
              <th scope="col" className="sticky">
                Rep
              </th>
              {rules.map((rule) => (
                <th scope="col" key={rule.id} className="num">
                  <span className="th-label">{rule.label}</span>
                  <Limits rule={rule} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.reps.map((r) => (
              <tr key={r.index} className={selectedRep === r.index ? 'is-selected' : ''} onClick={() => onRep(r.index)}>
                <th scope="row" className="sticky">
                  <button
                    type="button"
                    className="rep-link"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRep(r.index);
                    }}
                    aria-label={`Play rep ${r.index}`}
                  >
                    {r.index}
                  </button>
                </th>
                {rules.map((rule) => {
                  const c = r.form?.checks[rule.id];
                  if (!c || c.level === 'skipped') {
                    return (
                      <td key={rule.id} className="num muted" title={r.form ? 'Not checked: the joints were not clearly visible' : 'Rep not scored'}>
                        –
                      </td>
                    );
                  }
                  return (
                    <td key={rule.id} className={`num ${CELL_CLASS[c.level] || ''}`}>
                      <span className="cell-value">{fmtNum(c.value, rule)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cfg.standards.notChecked?.length > 0 && (
        <>
          <h3>Not checked from this camera view</h3>
          <ul className="drawer-list muted">
            {cfg.standards.notChecked.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
