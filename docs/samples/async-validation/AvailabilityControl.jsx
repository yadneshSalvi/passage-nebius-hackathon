import React, { useState, useEffect, useRef } from 'react';

export default function SlotControl({ value, onChange, choices, locale, longLabels, delayMs, checkAvailability }) {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [rejected, setRejected] = useState('');

  const triggerRef = useRef(null);
  const firstDateButtonRef = useRef(null);
  const retryButtonRef = useRef(null);

  const selected = choices.find((choice) => choice.date === value);

  // Compute first available date (not rejected, not unavailable)
  const availableChoices = choices.filter(
    (c) => c.date !== rejected && !c.unavailable
  );
  const firstAvailableDate = availableChoices[0]?.date;

  function closePanel() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function choose(choice) {
    setChecking(true);
    const result = await checkAvailability(choice.date);
    setChecking(false);
    if (!result.available) {
      setError(result.reason);
      setRejected(choice.date);
    } else {
      onChange(choice.date);
      closePanel();
    }
  }

  function handleRetry() {
    setError('');
    setRejected('');
    // focus will be moved by effect when error clears
  }

  function handlePanelKeyDown(event) {
    if (event.key === 'Escape') {
      closePanel();
    }
  }

  // Focus management when panel opens or error state changes
  useEffect(() => {
    if (open) {
      if (error) {
        retryButtonRef.current?.focus();
      } else {
        firstDateButtonRef.current?.focus();
      }
    }
  }, [open, error]);

  return (
    <div className="slot-control">
      <span className="field-label" id="availability-label">Advice appointment</span>
      <button
        type="button"
        className="picker-trigger"
        data-testid="slot-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby="availability-label availability-value"
        onClick={() => setOpen(!open)}
        ref={triggerRef}
      >
        <span id="availability-value">{selected?.label || 'Choose a time to talk'}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className="picker-panel"
          data-testid="slot-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="availability-title"
          onKeyDown={handlePanelKeyDown}
        >
          <h3 id="availability-title">Find a moment for you</h3>
          {checking ? (
            <p>Checking availability…</p>
          ) : error ? (
            <div className="inline-error" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="text-button"
                data-testid="retry-selection"
                onClick={handleRetry}
                ref={retryButtonRef}
              >
                Choose another appointment →
              </button>
            </div>
          ) : (
            <div className="session-list">
              {choices
                .filter((choice) => choice.date !== rejected)
                .map((choice) => (
                  <button
                    type="button"
                    className="session-option"
                    disabled={choice.unavailable}
                    data-date={choice.date}
                    key={choice.date}
                    onClick={() => choose(choice)}
                    ref={choice.date === firstAvailableDate ? firstDateButtonRef : null}
                  >
                    <span>{choice.label}</span>
                    <small>Advice session · 30 min</small>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
