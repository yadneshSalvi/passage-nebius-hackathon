import React, { useEffect, useRef, useState } from 'react';

export default function SlotControl({ value, onChange, choices, checkAvailability }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState('');
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const retryRef = useRef(null);
  const selected = choices.find((choice) => choice.date === value);
  const availableChoices = choices.filter((choice) => choice.date !== rejected);
  useEffect(() => {
    if (open && !checking) {
      if (error) retryRef.current?.focus();
      else { const index = availableChoices.findIndex((choice) => !choice.unavailable); optionRefs.current[index]?.focus(); }
    }
  }, [open, checking, error, rejected]);
  function close() { setOpen(false); setError(''); triggerRef.current?.focus(); }
  async function choose(choice) {
    setChecking(true);
    const result = await checkAvailability(choice.date);
    setChecking(false);
    if (!result.available) { setError(result.reason); setRejected(choice.date); }
    else { onChange(choice.date); close(); }
  }
  return <div className="slot-control">
    <span className="field-label" id="availability-label">Advice appointment</span>
    <button ref={triggerRef} type="button" className="picker-trigger" data-testid="slot-trigger" aria-haspopup="dialog" aria-expanded={open} aria-labelledby="availability-label availability-value" onClick={() => setOpen(!open)}><span id="availability-value">{selected?.label || 'Choose a time to talk'}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="picker-panel" data-testid="slot-panel" role="dialog" aria-modal="true" aria-labelledby="availability-title" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
      <div className="picker-heading"><h3 id="availability-title">Find a moment for you</h3><button className="icon-button" type="button" aria-label="Close appointments" onClick={close}>×</button></div>
      {checking ? <p role="status">Checking availability…</p> : error ? <div className="inline-error"><p role="alert">{error}</p><button ref={retryRef} type="button" className="text-button" data-testid="retry-selection" onClick={() => setError('')}>Choose another appointment →</button></div> : <div className="session-list">{availableChoices.map((choice, index) => <button ref={(element) => { optionRefs.current[index] = element; }} type="button" className="session-option" disabled={choice.unavailable} data-date={choice.date} key={choice.date} onClick={() => choose(choice)}><span>{choice.label}</span><small>Advice session · 30 min</small></button>)}</div>}
    </div>}
  </div>;
}
