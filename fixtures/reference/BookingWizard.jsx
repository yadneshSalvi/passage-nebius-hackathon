import React, { useEffect, useRef, useState } from 'react';

export default function SlotControl({ value, onChange, choices }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState(1);
  const triggerRef = useRef(null);
  const firstRef = useRef(null);
  const nextRef = useRef(null);
  const closeRef = useRef(null);
  const selected = choices.find((choice) => choice.date === value);
  const firstIndex = choices.findIndex((choice) => !choice.unavailable);
  useEffect(() => { if (open) { if (step === 1) firstRef.current?.focus(); else nextRef.current?.focus(); } }, [open, step]);
  function close() { setOpen(false); triggerRef.current?.focus(); }
  function onKeys(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab' && step === 2) {
      if (!event.shiftKey && event.target === nextRef.current) { event.preventDefault(); closeRef.current?.focus(); }
      else if (event.shiftKey && event.target === closeRef.current) { event.preventDefault(); nextRef.current?.focus(); }
    }
  }
  return <div className="slot-control">
    <span className="field-label" id="wizard-label">Orientation appointment</span>
    <button ref={triggerRef} type="button" className="picker-trigger" data-testid="slot-trigger" aria-haspopup="dialog" aria-expanded={open} aria-labelledby="wizard-label wizard-value" onClick={() => { setOpen(true); setStep(1); }}><span id="wizard-value">{selected?.label || 'Find your first session'}</span><span aria-hidden="true">↗</span></button>
    {open && <div className="picker-panel" data-testid="slot-panel" role="dialog" aria-modal="true" aria-labelledby="wizard-title" onKeyDown={onKeys}>
      <div className="picker-heading"><h3 id="wizard-title">{step === 1 ? '01 / Choose a day' : '02 / Review your choice'}</h3><button ref={closeRef} type="button" className="icon-button" aria-label="Close dialog" onClick={close}>×</button></div>
      {step === 1 ? <div className="session-list">{choices.map((choice, index) => <button ref={index === firstIndex ? firstRef : null} type="button" className="session-option" data-date={choice.date} key={choice.date} disabled={choice.unavailable} onClick={() => { setDraft(choice.date); setStep(2); }}><span>{choice.label}</span><small>Orientation · 45 min</small></button>)}</div> : <div className="wizard-review"><p>{choices.find((choice) => choice.date === draft)?.label}</p><p>We will save your place after you confirm your details.</p><button ref={nextRef} type="button" className="solid-button" data-testid="wizard-next" onClick={() => { onChange(draft); close(); }}>Use this date <span aria-hidden="true">→</span></button></div>}
    </div>}
  </div>;
}
