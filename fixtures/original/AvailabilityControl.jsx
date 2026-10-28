import React, { useState } from 'react';

export default function SlotControl({ value, onChange, choices, checkAvailability }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState('');
  const selected = choices.find((choice) => choice.date === value);
  async function choose(choice) {
    setChecking(true);
    const result = await checkAvailability(choice.date);
    setChecking(false);
    if (!result.available) { setError(result.reason); setRejected(choice.date); }
    else { onChange(choice.date); setOpen(false); }
  }
  return <div className="slot-control">
    <span className="field-label" id="availability-label">Advice appointment</span>
    <button type="button" className="picker-trigger" data-testid="slot-trigger" aria-haspopup="dialog" aria-expanded={open} aria-labelledby="availability-label availability-value" onClick={() => setOpen(!open)}><span id="availability-value">{selected?.label || 'Choose a time to talk'}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="picker-panel" data-testid="slot-panel" role="dialog" aria-modal="true" aria-labelledby="availability-title">
      <h3 id="availability-title">Find a moment for you</h3>
      {checking ? <p>Checking availability…</p> : error ? <div className="inline-error"><p>{error}</p><div className="text-button" data-testid="retry-selection" onClick={() => setError('')}>Choose another appointment →</div></div> : <div className="session-list">{choices.filter((choice) => choice.date !== rejected).map((choice) => <button type="button" className="session-option" disabled={choice.unavailable} data-date={choice.date} key={choice.date} onClick={() => choose(choice)}><span>{choice.label}</span><small>Advice session · 30 min</small></button>)}</div>}
    </div>}
  </div>;
}
