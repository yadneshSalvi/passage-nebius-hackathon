import React, { useState } from 'react';

export default function SlotControl({ value, onChange, choices, locale }) {
  const [open, setOpen] = useState(false);
  const selected = choices.find((choice) => choice.date === value);
  return <div className="slot-control">
    <span className="field-label" id="date-label">{locale === 'de' ? 'Termin auswählen' : 'Appointment date'}</span>
    <button type="button" className="picker-trigger" data-testid="slot-trigger" aria-haspopup="dialog" aria-expanded={open} aria-labelledby="date-label selected-date-label" onClick={() => setOpen(!open)}>
      <span id="selected-date-label">{selected ? selected.label : locale === 'de' ? 'Datum auswählen' : 'Choose a date'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="picker-panel" data-testid="slot-panel" role="dialog" aria-modal="true" aria-labelledby="calendar-title">
      <div className="picker-heading"><h3 id="calendar-title">{locale === 'de' ? 'November 2026' : 'November 2026'}</h3><button type="button" className="icon-button" aria-label="Close calendar" onClick={() => setOpen(false)}>×</button></div>
      <div className="calendar-week" aria-hidden="true"><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span></div>
      <div className="calendar-grid">{choices.map((choice) => <div key={choice.date} className={`calendar-day ${choice.unavailable ? 'unavailable' : ''}`} data-date={choice.date} role="button" aria-label={choice.label} aria-disabled={choice.unavailable} onClick={() => { if (!choice.unavailable) { onChange(choice.date); setOpen(false); } }}><span>{choice.day}</span><span className="availability-dot" /></div>)}</div>
      <p className="picker-hint">{locale === 'de' ? 'Alle Termine in Ihrer Ortszeit.' : 'All appointments in your local time.'}</p>
    </div>}
  </div>;
}
