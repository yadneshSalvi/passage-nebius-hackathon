import React, { useState, useEffect, useRef } from 'react';

export default function SlotControl({ value, onChange, choices, locale, longLabels, delayMs, checkAvailability }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);
  const [rejectedDates, setRejectedDates] = useState([]);

  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const firstOptionRef = useRef(null);
  const retryButtonRef = useRef(null);

  const selected = choices.find((c) => c.date === value);

  const isSelectable = (choice) => !choice.unavailable && !rejectedDates.includes(choice.date);

  const closePanel = () => {
    setOpen(false);
    if (triggerRef.current) triggerRef.current.focus();
  };

  const handleTriggerClick = () => {
    setOpen(!open);
  };

  const handleOptionClick = async (choice) => {
    if (!isSelectable(choice)) return;
    if (checkAvailability) {
      try {
        const res = await checkAvailability(choice.date);
        if (!res.available) {
          setError({ date: choice.date, reason: res.reason || 'Unavailable' });
          setRejectedDates((prev) => [...prev, choice.date]);
          return;
        }
      } catch (err) {
        setError({ date: choice.date, reason: err.message || 'Availability check failed' });
        setRejectedDates((prev) => [...prev, choice.date]);
        return;
      }
    }
    onChange(choice.date);
    closePanel();
  };

  const handlePanelKeyDown = (e) => {
    if (e.key === 'Escape') {
      closePanel();
    }
  };

  const handleRetry = () => {
    setError(null);
  };

  useEffect(() => {
    if (open && !error) {
      const firstIndex = choices.findIndex(isSelectable);
      if (firstIndex >= 0 && firstOptionRef.current) {
        firstOptionRef.current.focus();
      }
    }
  }, [open, error, rejectedDates, choices]);

  useEffect(() => {
    if (error && retryButtonRef.current) {
      retryButtonRef.current.focus();
    }
  }, [error]);

  return (
    <div className="slot-control">
      <span className="field-label" id="session-label">
        {locale === 'de' ? 'Beratungstermin' : 'Available sessions'}
      </span>
      <button
        type="button"
        className="picker-trigger"
        role="combobox"
        data-testid="slot-trigger"
        aria-expanded={open}
        aria-controls="sessions-list"
        aria-labelledby="session-label session-value"
        onClick={handleTriggerClick}
        ref={triggerRef}
      >
        <span id="session-value">{selected?.label || 'Choose a session'}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className="picker-panel session-list"
          id="sessions-list"
          data-testid="slot-panel"
          role="listbox"
          aria-labelledby="session-label"
          ref={panelRef}
          tabIndex={-1}
          onKeyDown={handlePanelKeyDown}
        >
          {error && (
            <div role="alert" className="availability-error">
              <span>{error.reason}</span>
              <button
                type="button"
                className="retry-button"
                onClick={handleRetry}
                ref={retryButtonRef}
              >
                Retry
              </button>
            </div>
          )}
          {choices.map((choice, idx) => {
            const selectable = isSelectable(choice);
            const isFirstSelectable = idx === choices.findIndex(isSelectable);
            return (
              <button
                key={choice.date}
                type="button"
                role="option"
                aria-selected={choice.date === value}
                aria-disabled={!selectable}
                disabled={!selectable}
                className={`session-option ${choice.unavailable ? 'unavailable' : ''} ${rejectedDates.includes(choice.date) ? 'rejected' : ''}`}
                data-date={choice.date}
                onClick={() => handleOptionClick(choice)}
                ref={isFirstSelectable ? firstOptionRef : null}
              >
                <span>{choice.label}</span>
                <small>
                  {choice.unavailable
                    ? 'Unavailable'
                    : rejectedDates.includes(choice.date)
                    ? 'Rejected'
                    : '9:30 AM · 30 min'}
                </small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}