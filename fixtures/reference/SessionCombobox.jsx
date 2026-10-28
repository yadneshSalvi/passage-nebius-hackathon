import React, { useEffect, useRef, useState } from 'react';

export default function SlotControl({ value, onChange, choices, locale }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);
  const selected = choices.find((choice) => choice.date === value);
  useEffect(() => { if (open) { const index = choices.findIndex((choice) => !choice.unavailable); optionRefs.current[index]?.focus(); } }, [open, choices]);
  function close() { setOpen(false); triggerRef.current?.focus(); }
  function navigate(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const options = optionRefs.current.filter((element) => element && !element.disabled);
      const index = options.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
      options[next]?.focus();
    }
  }
  return <div className="slot-control" onKeyDown={navigate}>
    <span className="field-label" id="session-label">{locale === 'de' ? 'Beratungstermin' : 'Available sessions'}</span>
    <button ref={triggerRef} type="button" className="picker-trigger" role="combobox" data-testid="slot-trigger" aria-expanded={open} aria-controls="sessions-list" aria-haspopup="listbox" aria-labelledby="session-label session-value" onClick={() => setOpen(!open)}><span id="session-value">{selected?.label || 'Choose a session'}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="picker-panel session-list" id="sessions-list" data-testid="slot-panel" role="listbox" aria-labelledby="session-label">
      {choices.map((choice, index) => <button ref={(element) => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={choice.date === value} disabled={choice.unavailable} key={choice.date} className={`session-option ${choice.unavailable ? 'unavailable' : ''}`} data-date={choice.date} onClick={() => { onChange(choice.date); close(); }}><span>{choice.label}</span><small>{choice.unavailable ? 'Unavailable' : '9:30 AM · 30 min'}</small></button>)}
    </div>}
  </div>;
}
