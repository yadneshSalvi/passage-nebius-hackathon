import React, { useState, useEffect, useRef } from 'react';

export default function SlotControl({ value, onChange, choices, locale, longLabels, delayMs, checkAvailability }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);

  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const dateButtonRefs = useRef([]);
  const retryButtonRef = useRef(null);

  const selected = choices.find((choice) => choice.date === value);

  const getFirstAvailableIndex = () => {
    const rejectedDate = error?.date;
    return choices.findIndex((c) => !c.unavailable && c.date !== rejectedDate);
  };

  useEffect(() => {
    if (open && !error) {
      const firstIndex = getFirstAvailableIndex();
      if (firstIndex >= 0) {
        dateButtonRefs.current[firstIndex]?.focus();
      } else {
        panelRef.current?.focus();
      }
    }
  }, [open, error]);

  useEffect(() => {
    if (error) {
      retryButtonRef.current?.focus();
    }
  }, [error]);

  useEffect(() => {
    if (!open) {
      triggerRef.current?.focus();
    }
  }, [open]);

  const openPanel = () => setOpen(true);

  const closePanel = () => {
    setOpen(false);
    setError(null);
    setChecking(false);
  };

  const handleDateClick = async (date) => {
    if (checking) return;
    setChecking(true);
    setError(null);
    let available = true;
    let reason = '';
    if (checkAvailability) {
      try {
        const result = await checkAvailability(date);
        available = result.available;
        reason = result.reason || '';
      } catch (e) {
        available = false;
        reason = 'Availability check failed';
      }
    }
    if (available) {
      onChange(date);
      closePanel();
    } else {
      setError({ date, reason });
      setChecking(false);
    }
  };

  const handleRetry = () => {
    const rejectedDate = error?.date;
    setError(null);
    setChecking(false);
    const nextIndex = choices.findIndex((c) => !c.unavailable && c.date !== rejectedDate);
    if (nextIndex >= 0) {
      dateButtonRefs.current[nextIndex]?.focus();
    } else {
      panelRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      closePanel();
    }
  };

  return (
    <div className="slot-control">
      <span className="field-label" id="date-label">
        {locale === 'de' ? 'Termin auswählen' : 'Appointment date'}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="picker-trigger"
        data-testid="slot-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby="date-label selected-date-label"
        onClick={openPanel}
      >
        <span id="selected-date-label">
          {selected ? selected.label : locale === 'de' ? 'Datum auswählen' : 'Choose a date'}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="picker-panel"
          data-testid="slot-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="calendar-title"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <div className="picker-heading">
            <h3 id="calendar-title">{locale === 'de' ? 'November 2026' : 'November 2026'}</h3>
            <button
              type="button"
              className="icon-button"
              aria-label={locale === 'de' ? 'Kalender schließen' : 'Close calendar'}
              onClick={closePanel}
            >
              ×
            </button>
          </div>
          <div className="calendar-week" aria-hidden="true">
            <span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span>
          </div>
          <div className="calendar-grid">
            {choices.map((choice, index) => (
              <button
                key={choice.date}
                ref={(el) => { dateButtonRefs.current[index] = el; }}
                type="button"
                className={`calendar-day ${choice.unavailable ? 'unavailable' : ''}`}
                data-date={choice.date}
                disabled={choice.unavailable}
                aria-label={choice.label}
                aria-disabled={choice.unavailable}
                onClick={() => !choice.unavailable && handleDateClick(choice.date)}
              >
                <span>{choice.day}</span>
                <span className="availability-dot" />
              </button>
            ))}
          </div>
          {error && (
            <div role="alert" className="picker-error">
              <p>{error.reason}</p>
              <button
                ref={retryButtonRef}
                type="button"
                className="retry-button"
                onClick={handleRetry}
              >
                {locale === 'de' ? 'Erneut versuchen' : 'Try again'}
              </button>
            </div>
          )}
          <p className="picker-hint">
            {locale === 'de' ? 'Alle Termine in Ihrer Ortszeit.' : 'All appointments in your local time.'}
          </p>
        </div>
      )}
    </div>
  );
}