import { useState } from 'react';
import { buildPlainTextReport, copyText, downloadBlob, renderSummaryImage, reportFileName } from '../lib/report/export.js';

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <rect x="7" y="7" width="9.5" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M13 4.5 H5.5 A2 2 0 0 0 3.5 6.5 V14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M10 3.5 V12 M6.5 8.5 L10 12 L13.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 13.5 V15 A1.5 1.5 0 0 0 5.5 16.5 H14.5 A1.5 1.5 0 0 0 16 15 V13.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function ExportBar({ analysis, input, report }) {
  const [status, setStatus] = useState(null); // { kind, text }

  const flash = (kind, text) => {
    setStatus({ kind, text });
    setTimeout(() => setStatus((s) => (s?.text === text ? null : s)), 2600);
  };

  const onCopy = async () => {
    const ok = await copyText(buildPlainTextReport(analysis, input, report));
    flash(ok ? 'ok' : 'error', ok ? 'Report copied' : 'Copy was blocked');
  };

  const onImage = async () => {
    setStatus({ kind: 'busy', text: 'Saving…' });
    try {
      const blob = await renderSummaryImage(analysis, input, report);
      downloadBlob(blob, reportFileName(analysis));
      flash('ok', 'Image saved');
    } catch (err) {
      flash('error', err?.message || 'Could not create the image');
    }
  };

  return (
    <div className="export-bar">
      <span className={`export-status ${status ? `is-${status.kind}` : ''}`} role="status" aria-live="polite">
        {status?.text || ''}
      </span>
      <button type="button" className="icon-btn-sm" onClick={onCopy} aria-label="Copy report as text" title="Copy report as text">
        <CopyIcon />
      </button>
      <button type="button" className="icon-btn-sm" onClick={onImage} disabled={status?.kind === 'busy'} aria-label="Download summary image" title="Download summary image (PNG)">
        <ImageIcon />
      </button>
    </div>
  );
}
