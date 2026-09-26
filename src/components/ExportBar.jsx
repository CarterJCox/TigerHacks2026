import { useState } from 'react';
import { buildPlainTextReport, copyText, downloadBlob, renderSummaryImage, reportFileName } from '../lib/report/export.js';

export default function ExportBar({ analysis, input, report }) {
  const [status, setStatus] = useState(null); // { kind, text }

  const flash = (kind, text) => {
    setStatus({ kind, text });
    setTimeout(() => setStatus((s) => (s?.text === text ? null : s)), 2600);
  };

  const onCopy = async () => {
    const ok = await copyText(buildPlainTextReport(analysis, input, report));
    flash(ok ? 'ok' : 'error', ok ? 'Report copied as plain text' : 'Copy failed. Your browser blocked clipboard access.');
  };

  const onImage = async () => {
    setStatus({ kind: 'busy', text: 'Drawing image…' });
    try {
      const blob = await renderSummaryImage(analysis, input, report);
      downloadBlob(blob, reportFileName(analysis));
      flash('ok', 'Image saved');
    } catch (err) {
      flash('error', err?.message || 'Could not create the image.');
    }
  };

  return (
    <div className="export-bar">
      <button type="button" className="btn btn-ghost btn-small" onClick={onCopy}>
        Copy report
      </button>
      <button type="button" className="btn btn-ghost btn-small" onClick={onImage} disabled={status?.kind === 'busy'}>
        Download image
      </button>
      <span className={`export-status ${status ? `is-${status.kind}` : ''}`} role="status" aria-live="polite">
        {status?.text || ''}
      </span>
    </div>
  );
}
