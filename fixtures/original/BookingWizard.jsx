import React, { useState } from 'react';

export default function SlotControl({ value, onChange, choices }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState(1);
  const selected = choices.find((choice) => choice.date === value);
  return <div className="slot-control">
    <span className="field-label" id="wizard-label">Orientation appointment</span>
    <button type="button" className="picker-trigger" data-testid="slot-trigger" aria-haspopup="dialog" aria-expanded={open} aria-labelledby="wizard-label wizard-value" onClick={() => { setOpen(true); setStep(1); }}><span id="wizard-value">{selected?.label || 'Find your first session'}</span><span aria-hidden="true">↗</span></button>
    {open && <div className="picker-panel" data-testid="slot-panel" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <div className="picker-heading"><h3 id="wizard-title">{step === 1 ? '01 / Choose a day' : '02 / Review your choice'}</h3><button type="button" className="icon-button" aria-label="Close dialog" onClick={() => setOpen(false)}>×</button></div>
      {step === 1 ? <div className="session-list">{choices.map((choice) => <button type="button" className="session-option" data-date={choice.date} key={choice.date} disabled={choice.unavailable} onClick={() => { setDraft(choice.date); setStep(2); }}><span>{choice.label}</span><small>Orientation · 45 min</small></button>)}</div> : <div className="wizard-review"><p>{choices.find((choice) => choice.date === draft)?.label}</p><p>We will save your place after you confirm your details.</p><span className="solid-button" data-testid="wizard-next" onClick={() => { onChange(draft); setOpen(false); }}>Use this date <span aria-hidden="true">→</span></span></div>}
    </div>}
  </div>;
}
