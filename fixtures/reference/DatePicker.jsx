import React, { useEffect, useRef, useState } from 'react';

export default function SlotControl({ value, onChange, choices, locale, checkAvailability }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const closeRef = useRef(null);
  const requestVersion = useRef(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const selected = choices.find((choice) => choice.date === value);
  useEffect(() => {
    if (open) {
      const selectedIndex = choices.findIndex((choice) => choice.date === value && !choice.unavailable);
      const index = selectedIndex >= 0 ? selectedIndex : choices.findIndex((choice) => !choice.unavailable);
      optionRefs.current[index]?.focus();
    }
  }, [open, choices, value]);
  function close() { requestVersion.current += 1; setChecking(false); setError(''); setOpen(false); triggerRef.current?.focus(); }
  function onKeys(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab') {
      const available = optionRefs.current.filter((element) => element && !element.disabled && element.tabIndex >= 0);
      const lastIndex = available.length - 1;
      if (event.shiftKey && event.target === closeRef.current) { event.preventDefault(); available[lastIndex]?.focus(); }
      else if (!event.shiftKey && event.target === available[lastIndex]) { event.preventDefault(); closeRef.current?.focus(); }
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const available = optionRefs.current.filter((element) => element && !element.disabled);
      const index = available.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + available.length) % available.length;
      available[next]?.focus();
    }
  }
  return <div className="slot-control">
    <span className="field-label" id="date-label">{locale === 'de' ? 'Termin auswählen' : 'Appointment date'}</span>
    <button ref={triggerRef} type="button" className="picker-trigger" data-testid="slot-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls="calendar-panel" aria-labelledby="date-label selected-date-label" onClick={() => setOpen(!open)}>
      <span id="selected-date-label">{selected ? selected.label : locale === 'de' ? 'Datum auswählen' : 'Choose a date'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div id="calendar-panel" className="picker-panel" data-testid="slot-panel" role="dialog" aria-modal="true" aria-labelledby="calendar-title" onKeyDown={onKeys}>
      <div className="picker-heading"><h3 id="calendar-title">November 2026</h3><button ref={closeRef} type="button" className="icon-button" aria-label="Close calendar" onClick={close}>×</button></div>
      <div className="calendar-week" aria-hidden="true"><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span></div>
      <div className="calendar-grid">{choices.map((choice, index) => <button ref={(element) => { optionRefs.current[index] = element; }} key={choice.date} type="button" className={`calendar-day ${choice.unavailable ? 'unavailable' : ''}`} data-date={choice.date} aria-label={choice.label} disabled={choice.unavailable} aria-pressed={value === choice.date} onClick={async () => {
        if (checking) return;
        if (value === choice.date) { close(); return; }
        const version = requestVersion.current + 1; requestVersion.current = version;
        setChecking(true); setError('');
        try {
          const result = checkAvailability ? await checkAvailability(choice.date) : { available: true };
          if (requestVersion.current !== version) return;
          setChecking(false);
          if (result.available) { onChange(choice.date); close(); }
          else setError(result.reason || 'This appointment is no longer available. Choose another date.');
        } catch {
          if (requestVersion.current === version) { setChecking(false); setError('Availability could not be checked. Choose another date.'); }
        }
      }}><span>{choice.day}</span><span className="availability-dot" /></button>)}</div>
      {checking && <p role="status">Checking availability…</p>}
      {error && <p role="alert">{error}</p>}
      <p className="picker-hint">{locale === 'de' ? 'Pfeiltasten zum Navigieren. Eingabe zum Auswählen.' : 'Use arrow keys to explore. Enter to choose.'}</p>
    </div>}
  </div>;
}
