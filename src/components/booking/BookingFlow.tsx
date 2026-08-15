import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { format } from 'date-fns';

import DetailsForm from '@/components/booking/DetailsForm';
import Payment from '@/components/booking/Payment';
import ConfirmationPage from '@/components/booking/ConfirmationPage';
import TermsReview from '@/components/booking/TermsReview';
import { ContinueButton } from '@/components/ui/ContinueButton';
import { submitBooking } from '@/lib/api';
import { toDateKey } from '@/lib/dates';
import {
  formatMoneyFromCents,
  getAppointmentDepositAmountCents,
  getServiceDurationLabel,
} from '@/lib/normalizers';
import type { Slot } from '@/types/calendar';
import type { Service } from '@/types/service';
import type { BookingResponse, CustomerDetails, WidgetConfig } from '@/types/widget';

type Step = 'terms' | 'details' | 'payment' | 'saving' | 'retry' | 'done';

type PaymentMode = 'stripe' | 'demo' | 'unconfigured';

interface BookingFlowProps {
  config: WidgetConfig;
  service: Service;
  slot: Slot;
  date: Date;
  onClose?: () => void;
  onDone?: () => void;
  onBookAnother?: () => void;
}

function MiniStepper({ step, requiresPaymentStep }: { step: Step; requiresPaymentStep: boolean }) {
  const items = [
    { id: 'terms', label: 'Terms' },
    { id: 'details', label: 'Contact' },
    ...(requiresPaymentStep ? [{ id: 'payment', label: 'Deposit' }] : []),
    { id: 'done', label: 'Done' },
  ];
  const normalizedStep =
    step === 'saving' || step === 'retry' ? (requiresPaymentStep ? 'payment' : 'details') : step;
  const currentIndex = Math.max(0, items.findIndex((item) => item.id === normalizedStep));

  return (
    <div className="booking-mini-stepper" role="list" aria-label="Reservation progress">
      {items.map((item, index) => {
        const state = index < currentIndex ? 'complete' : index === currentIndex ? 'active' : 'upcoming';
        return (
          <span
            key={item.id}
            role="listitem"
            data-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <i aria-hidden="true">{state === 'complete' ? '✓' : index + 1}</i>
            <span className="sr-only">
              {state === 'complete' ? 'Completed ' : state === 'active' ? 'Current step ' : 'Upcoming '}
            </span>
            {item.label}
          </span>
        );
      })}
    </div>
  );
}

function BookingSummary({ service, slot, date, currency }: { service: Service; slot: Slot; date: Date; currency?: string }) {
  const depositAmountCents = getAppointmentDepositAmountCents(service);
  const duration = getServiceDurationLabel(service);

  return (
    <aside className="booking-summary-card">
      <p className="chime-kicker">Appointment summary</p>
      <h2>{service.name}</h2>
      <dl>
        <div>
          <dt>Date</dt>
          <dd>{format(date, 'EEEE, MMMM d, yyyy')}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{slot.timeLabel}</dd>
        </div>
        {duration && (
          <div>
            <dt>Duration</dt>
            <dd>{duration}</dd>
          </div>
        )}
        {depositAmountCents > 0 && (
          <div>
            <dt>Refundable deposit</dt>
            <dd>{formatMoneyFromCents(depositAmountCents, currency)}</dd>
          </div>
        )}
      </dl>
    </aside>
  );
}

export default function BookingFlow({
  config,
  service,
  slot,
  date,
  onClose,
  onDone,
  onBookAnother,
}: BookingFlowProps) {
  const [step, setStep] = useState<Step>('terms');
  const [customer, setCustomer] = useState<CustomerDetails | null>(null);
  const [termsAcceptedAt, setTermsAcceptedAt] = useState<string | undefined>(undefined);
  const [bookingResponse, setBookingResponse] = useState<BookingResponse | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | undefined>(undefined);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submittingRef = useRef(false);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      panelHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [step]);

  const depositAmountCents = getAppointmentDepositAmountCents(service);
  // How the deposit is collected: real Stripe when both a publishable key
  // (client) and a payment-intent endpoint (server) are configured, otherwise a
  // simulated test-mode card form for demos, otherwise unconfigured — in which
  // case the payment step still renders and blocks the booking with an error.
  const paymentMode = useMemo<PaymentMode>(() => {
    if (config.payment.stripePublishableKey && config.api.paymentIntentUrl) return 'stripe';
    if (config.payment.demoMode || config.demoData) return 'demo';
    return 'unconfigured';
  }, [
    config.payment.stripePublishableKey,
    config.api.paymentIntentUrl,
    config.payment.demoMode,
    config.demoData,
  ]);
  const depositRequired = config.payment.required !== false;
  // The deposit step is mandatory: the only ways to skip it are a zero deposit,
  // payment.enabled === false, or an explicit payment.required === false when
  // no payment processor is available.
  const requiresPaymentStep = useMemo(
    () =>
      config.payment.enabled !== false &&
      depositAmountCents > 0 &&
      (paymentMode === 'stripe' || paymentMode === 'demo' || depositRequired),
    [config.payment.enabled, depositAmountCents, paymentMode, depositRequired],
  );

  async function finalizeBooking(nextPaymentIntentId?: string, nextCustomer?: CustomerDetails) {
    if (submittingRef.current) return;
    submittingRef.current = true;

    const bookingCustomer = nextCustomer ?? customer;
    if (!bookingCustomer) {
      submittingRef.current = false;
      return;
    }

    const effectivePaymentIntentId = nextPaymentIntentId ?? paymentIntentId;
    if (effectivePaymentIntentId) {
      setPaymentIntentId(effectivePaymentIntentId);
    }

    setStep('saving');
    setErrorMessage(null);

    try {
      const response = await submitBooking(config, {
        serviceId: service.id,
        serviceName: service.name,
        date: toDateKey(date),
        timeLabel: slot.timeLabel,
        slotId: slot.id,
        depositAmountCents,
        customer: bookingCustomer,
        paymentIntentId: effectivePaymentIntentId,
        termsAcceptedAt: termsAcceptedAt ?? new Date().toISOString(),
      });

      setBookingResponse(response);
      setPaymentIntentId(effectivePaymentIntentId);
      submittingRef.current = false;
      setStep('done');
      onDone?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to submit the booking.');
      submittingRef.current = false;
      if (effectivePaymentIntentId) {
        setPaymentIntentId(effectivePaymentIntentId);
        setStep('retry');
      } else {
        setStep(requiresPaymentStep ? 'payment' : 'details');
      }
    }
  }

  return (
    <div className="booking-flow-grid">
      <BookingSummary service={service} slot={slot} date={date} currency={config.payment.currency} />

      <div className="booking-flow-panel">
        <div className="booking-flow-panel__header">
          <div>
            <p className="chime-kicker">Reservation</p>
            <h2 ref={panelHeadingRef} tabIndex={-1}>Finish your appointment request</h2>
            <p>
              {requiresPaymentStep
                ? `Read the terms first, add your name and email, then place the refundable ${formatMoneyFromCents(depositAmountCents, config.payment.currency)} deposit.`
                : 'Read the terms first, then add your name and email to confirm your appointment request.'}
            </p>
          </div>
          {step !== 'done' && (
            <ContinueButton type="button" variant="ghost" onClick={onClose} className="booking-back-button">
              Back to calendar
            </ContinueButton>
          )}
        </div>

        <MiniStepper step={step} requiresPaymentStep={requiresPaymentStep} />
        <span className="sr-only" role="status" aria-live="polite">
          {step === 'terms'
            ? 'Terms'
            : step === 'details'
              ? 'Contact details'
              : step === 'payment'
                ? 'Deposit'
                : step === 'saving'
                  ? 'Saving'
                  : step === 'retry'
                    ? 'Retry'
                    : 'Done'}
        </span>

        {errorMessage && (
          <motion.div role="alert" className="chime-alert chime-alert--error" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            {errorMessage}
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {step === 'terms' && (
            <motion.div
              key="terms"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.28 }}
            >
              <TermsReview
                config={config}
                service={service}
                slot={slot}
                date={date}
                depositAmountCents={depositAmountCents}
                requiresPaymentStep={requiresPaymentStep}
                onBack={onClose}
                onConfirm={() => {
                  setTermsAcceptedAt(new Date().toISOString());
                  setStep('details');
                }}
              />
            </motion.div>
          )}

          {step === 'details' && (
            <motion.div
              key="details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.28 }}
            >
              <DetailsForm
                fields={config.customerFields}
                initialValues={customer ?? undefined}
                backLabel="Back to terms"
                submitLabel={requiresPaymentStep ? `Continue to ${formatMoneyFromCents(depositAmountCents, config.payment.currency)} deposit` : 'Confirm appointment'}
                onBack={() => setStep('terms')}
                onNext={(details) => {
                  setCustomer(details);
                  if (requiresPaymentStep) {
                    setStep('payment');
                    return;
                  }
                  void finalizeBooking(undefined, details);
                }}
              />
            </motion.div>
          )}

          {step === 'payment' && customer && (
            <motion.div
              key="payment"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.28 }}
            >
              <Payment
                amountCents={depositAmountCents}
                mode={paymentMode}
                config={config}
                service={service}
                slot={slot}
                date={date}
                customer={customer}
                onBack={() => setStep('details')}
                onSuccess={({ paymentIntentId: confirmedPaymentIntentId }) => {
                  void finalizeBooking(confirmedPaymentIntentId);
                }}
              />
            </motion.div>
          )}

          {step === 'saving' && (
            <motion.div
              key="saving"
              className="chime-saving-card"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="chime-spinner" aria-hidden="true" />
              <h3>Saving your booking…</h3>
              <p>The calendar is being updated so this slot cannot be double-booked.</p>
            </motion.div>
          )}

          {step === 'retry' && (
            <motion.div
              key="retry"
              className="chime-saving-card"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <h3>Payment received — finishing your booking</h3>
              <p>
                Your deposit was authorized, but we couldn’t save your booking just yet. Your card will
                not be charged again — tap below to finish saving your appointment.
              </p>
              <ContinueButton type="button" onClick={() => void finalizeBooking(paymentIntentId ?? undefined)}>
                Retry booking
              </ContinueButton>
            </motion.div>
          )}

          {step === 'done' && customer && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <ConfirmationPage
                config={config}
                service={service}
                slot={slot}
                date={date}
                customer={customer}
                bookingResponse={bookingResponse}
                paymentIntentId={paymentIntentId}
                onBookAnother={onBookAnother}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
