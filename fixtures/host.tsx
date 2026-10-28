import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
// @ts-expect-error The scoped component is resolved by the trusted build adapter.
import SlotControl from '@fixture/slot';

const config = JSON.parse(document.getElementById('fixture-config')!.textContent!);
const de = config.scenario.locale === 'de';

function Application() {
  const [date, setDate] = useState('');
  const [attendee, setAttendee] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [appointment, setAppointment] = useState<any>(config.outcome ?? null);
  const nameRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (appointment) confirmationRef.current?.focus(); }, [appointment]);

  async function checkAvailability(chosen: string) {
    const response = await fetch(`/s/${config.sessionId}/availability`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: chosen }) });
    if (!response.ok) return { available: false, reason: de ? 'Verfügbarkeit konnte nicht geprüft werden. Bitte erneut versuchen.' : 'Availability could not be checked. Please try again.' };
    return response.json();
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!attendee.trim()) {
      setError(de ? 'Bitte geben Sie Ihren Namen ein.' : 'Please enter your name before continuing.');
      nameRef.current?.focus();
      return;
    }
    if (!date) {
      setError(de ? 'Bitte wählen Sie einen verfügbaren Termin.' : 'Please choose an available appointment.');
      document.querySelector<HTMLButtonElement>('[data-testid="slot-trigger"]')?.focus();
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/s/${config.sessionId}/appointments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, attendee: attendee.trim() }) });
      const result = await response.json();
      if (!response.ok) { setError(result.error); return; }
      setAppointment(result.appointment);
    } catch { setError(de ? 'Die Verbindung wurde unterbrochen. Bitte erneut versuchen.' : 'The connection was interrupted. Please try again.'); }
    finally { setSaving(false); }
  }

  return <div className="fixture-app" data-testid="application-ready" data-source-digest={config.sourceDigest}>
    <header className="fixture-header"><div className="fixture-brand"><svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><path d="M16 1v30M1 16h30M5.5 5.5l21 21M26.5 5.5l-21 21" stroke="currentColor" strokeWidth="2.5"/></svg><span>{config.fixture.organization}</span></div><span className="fixture-secure">{de ? 'Ein Moment für Sie' : 'A little time, for you'}</span></header>
    <main className="fixture-main">
      <div className="service-intro"><span className="service-eyebrow">{de ? 'PERSÖNLICHE UNTERSTÜTZUNG' : 'PERSONAL CARE, SIMPLY'}</span><h1>{de ? 'Wir nehmen uns Zeit.' : 'Let’s make time.'}</h1><p>{de ? 'Wählen Sie einen Termin, der in Ihr Leben passt. Wir kümmern uns um den Rest.' : 'Choose a moment that works for you. We’ll take care of the rest.'}</p></div>
      <section className="booking-card" aria-label={de ? 'Terminbuchung' : 'Book an appointment'}>
        {appointment ? <div className="confirmation" data-testid="confirmation"><div className="confirmation-icon" aria-hidden="true">✓</div><p className="service-eyebrow">{de ? 'IHR TERMIN IST BESTÄTIGT' : 'YOUR TIME IS RESERVED'}</p><h2 ref={confirmationRef} tabIndex={-1} data-testid="confirmation-heading">{de ? 'Wir sehen uns bald.' : 'We’ll see you soon.'}</h2><p>{de ? 'Ihr Termin wurde erfolgreich gespeichert.' : 'Your appointment has been saved. One less thing to think about.'}</p><dl><div><dt>{de ? 'Name' : 'Booked for'}</dt><dd>{appointment.attendee}</dd></div><div><dt>{de ? 'Termin' : 'Appointment'}</dt><dd>{config.choices.find((choice: any) => choice.date === appointment.date)?.label}</dd></div><div><dt>{de ? 'Buchungsnummer' : 'Confirmation'}</dt><dd className="confirmation-id">{appointment.id.slice(0, 8).toUpperCase()}</dd></div></dl></div> : <form noValidate onSubmit={confirm}>
          <div className="service-type"><span className="service-icon" aria-hidden="true">✳</span><div><h2>{config.fixture.family === 'modal-wizard' ? 'Your orientation' : config.fixture.family === 'async-validation' ? 'A conversation that helps' : de ? 'Ein persönliches Gespräch' : 'A personal consultation'}</h2><p>{de ? '30 Minuten · Online oder vor Ort' : '30 minutes · In person or online'}</p></div></div>
          <div className="booking-fields">
            <SlotControl value={date} onChange={(chosen: string) => { setDate(chosen); setError(''); }} choices={config.choices} locale={config.scenario.locale} longLabels={config.scenario.longLabels} delayMs={config.scenario.delayedValidationMs} checkAvailability={checkAvailability} />
            <input type="hidden" value={date} readOnly data-testid="selected-date" />
            <label className="name-field"><span className="field-label">{de ? 'Ihr Name' : 'Your name'}<span className="required-label">{de ? 'Erforderlich' : 'Required'}</span></span><input ref={nameRef} name="attendee" data-testid="attendee-input" value={attendee} onChange={(event) => setAttendee(event.target.value)} autoComplete="off" placeholder="Alex Morgan" maxLength={80} aria-describedby={error ? 'booking-error' : undefined} aria-invalid={!!error && !attendee.trim()} /></label>
          </div>
          {error && <p role="alert" className="booking-error" id="booking-error" data-testid="validation-error">{error}</p>}
          <button className="confirm-button" type="submit" data-testid="confirm-appointment" disabled={saving}>{saving ? de ? 'Wird bestätigt…' : 'Confirming your appointment…' : de ? 'Termin bestätigen' : 'Confirm appointment'}<span aria-hidden="true">→</span></button>
          <p className="booking-note">{de ? 'Kostenlose Stornierung bis 24 Stunden vor Ihrem Termin.' : 'Change of plans? You can reschedule up to 24 hours before.'}</p>
        </form>}
      </section>
      <footer className="fixture-note">{de ? 'Eine fiktive Anwendung für barrierefreie Interaktionen.' : 'An authored application. All appointment data is fictional.'}</footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Application />);
