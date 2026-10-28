import React, { useState } from 'react';

export default function SlotControl({ value, onChange, choices, locale }) {
  const [open, setOpen] = useState(false);
  const selected = choices.find((choice) => choice.date === value);
  return <div className="slot-control">
    <span className="field-label" id="session-label">{locale === 'de' ? 'Beratungstermin' : 'Available sessions'}</span>
    <button type="button" className="picker-trigger" role="combobox" data-testid="slot-trigger" aria-expanded={open} aria-controls="sessions-list" aria-labelledby="session-label session-value" onClick={() => setOpen(!open)}><span id="session-value">{selected?.label || 'Choose a session'}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="picker-panel session-list" id="sessions-list" data-testid="slot-panel" role="listbox" aria-labelledby="session-label">
      {choices.map((choice) => <div role="option" aria-selected={choice.date === value} aria-disabled={choice.unavailable} key={choice.date} className={`session-option ${choice.unavailable ? 'unavailable' : ''}`} data-date={choice.date} onClick={() => { if (!choice.unavailable) { onChange(choice.date); setOpen(false); } }}><span>{choice.label}</span><small>{choice.unavailable ? 'Unavailable' : '9:30 AM · 30 min'}</small></div>)}
    </div>}
  </div>;
}
