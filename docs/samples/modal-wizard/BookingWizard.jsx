import React, { useState, useEffect, useRef } from 'react';

export default function SlotControl({ value, onChange, choices, locale, longLabels, delayMs, checkAvailability }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [step, setStep] = useState(1);
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const firstDateRef = useRef(null);
  const retryRef = useRef(null);
  const reviewRef = useRef(null);
  const selected = choices.find((choice) => choice.date === value);

  const openDialog = () => {
    setOpen(true);
    setStep(1);
    setDraft('');
    setError(null);
  };

  const closeDialog = () => {
    setOpen(false);
    setError(null);
    setChecking(false);
    if (triggerRef.current) triggerRef.current.focus();
  };

  const handleDateSelect = async (date) => {
    const choice = choices.find((c) => c.date === date);
    if (choice?.unavailable) return;
    setDraft(date);
    setChecking(true);
    setError(null);
    if (checkAvailability) {
      try {
        const result = await checkAvailability(date);
        if (result.available) {
          setStep(2);
        } else {
          setError(result.reason || 'This date is no longer available');
        }
      } catch (e) {
        setError('Unable to verify availability');
      }
    } else {
      setStep(2);
    }
    setChecking(false);
  };

  const handleConfirm = () => {
    if (draft) {
      onChange(draft);
    }
    closeDialog();
  };

  const handleRetry = () => {
    setError(null);
    setStep(1);
    setDraft('');
    if (firstDateRef.current) firstDateRef.current.focus();
  };

  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (error && retryRef.current) {
      retryRef.current.focus();
    }
  }, [error]);

  useEffect(() => {
    if (step === 2 && reviewRef.current) {
      reviewRef.current.focus();
    }
  }, [step]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && open) {
      closeDialog();
    }
  };

  const availableChoices = choices.filter((c) => !c.unavailable);
  const firstAvailable = availableChoices[0];

  return (
    <div className="slot-control">
      <span className="field-label" id="wizard-label">Orientation appointment</span>
      <button
        ref={triggerRef}
        type="button"
        className="picker-trigger"
        data-testid="slot-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby="wizard-label wizard-value"
        onClick={openDialog}
      >
        <span id="wizard-value">{selected?.label || 'Find your first session'}</span>
        <span aria-hidden="true">↗</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          className="picker-panel"
          data-testid="slot-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wizard-title"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
        >
          <div className="picker-heading">
            <h3 id="wizard-title">{step === 1 ? '01 / Choose a day' : '02 / Review your choice'}</h3>
            <button
              type="button"
              className="icon-button"
              aria-label="Close dialog"
              onClick={closeDialog}
            >
              ×
            </button>
          </div>
          {step === 1 ? (
            <div className="session-list">
              {choices.map((choice, idx) => (
                <button
                  ref={idx === 0 && !choice.unavailable ? firstDateRef : null}
                  type="button"
                  className="session-option"
                  data-date={choice.date}
                  key={choice.date}
                  disabled={choice.unavailable || checking}
                  onClick={() => handleDateSelect(choice.date)}
                >
                  <span>{choice.label}</span>
                  <small>Orientation · 45 min</small>
                </button>
              ))}
              {error && (
                <div role="alert" className="error-alert">
                  <p>{error}</p>
                  <button
                    ref={retryRef}
                    type="button"
                    className="retry-button"
                    data-testid="retry-selection"
                    onClick={handleRetry}
                  >
                    Try another date
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="wizard-review">
              <p>{choices.find((choice) => choice.date === draft)?.label}</p>
              <p>We will save your place after you confirm your details.</p>
              <button
                ref={reviewRef}
                type="button"
                className="solid-button"
                data-testid="wizard-next"
                onClick={handleConfirm}
              >
                Use this date <span aria-hidden="true">→</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
