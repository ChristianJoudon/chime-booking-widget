import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { format } from 'date-fns';

import Header from '@/components/layout/Header';
import CalendarView from '@/components/calendar/CalendarView';
import BookingFlow from '@/components/booking/BookingFlow';
import ServiceList from '@/components/services/ServiceList';
import ProgressSteps from '@/components/ui/ProgressSteps';
import { ContinueButton } from '@/components/ui/ContinueButton';
import { loadAvailability, loadServices } from '@/lib/api';
import { getWidgetConfig, loadPublishedWidgetConfig } from '@/lib/widgetConfig';
import { formatMoneyFromCents, getAppointmentDepositAmountCents, getServiceDurationLabel } from '@/lib/normalizers';
import type { DailyAvailability, Slot } from '@/types/calendar';
import type { Service } from '@/types/service';
import type { WidgetConfigInput } from '@/types/widget';
import chimeWordmark from '@/assets/brand/chime-wordmark.png';

type AppStep = 'service' | 'time' | 'booking';

const bookingSteps = [
  { id: 'service', eyebrow: 'Step 1', label: 'Service' },
  { id: 'time', eyebrow: 'Step 2', label: 'Calendar' },
  { id: 'booking', eyebrow: 'Step 3', label: 'Reserve' },
];

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ServiceSummary({ service, currency }: { service: Service; currency?: string }) {
  const depositAmount = getAppointmentDepositAmountCents(service);
  const durationLabel = getServiceDurationLabel(service);

  return (
    <div className="selection-summary" role="status" aria-live="polite" aria-label="Selected service">
      <div>
        <p className="chime-kicker">Selected service</p>
        <h3>{service.name}</h3>
        <p>
          {[durationLabel, depositAmount > 0 ? `${formatMoneyFromCents(depositAmount, currency)} refundable deposit` : 'No deposit']
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );
}

function SlotSummary({ date, slot }: { date: Date; slot: Slot }) {
  return (
    <div className="selection-summary" role="status" aria-live="polite" aria-label="Selected appointment time">
      <div>
        <p className="chime-kicker">Selected time</p>
        <h3>{format(date, 'EEE, MMM d')} at {slot.timeLabel}</h3>
        <p>{slot.label ?? 'Appointment opening'} is ready for terms review.</p>
      </div>
    </div>
  );
}

interface AppProps {
  /** 'fullpage' for the standalone app; 'embedded' when dropped into a host page. */
  variant?: 'fullpage' | 'embedded';
  /** Optional no-code theme/copy override, used by portable mounts and the admin live preview. */
  config?: WidgetConfigInput;
}

export default function App({ variant = 'embedded', config: configOverride }: AppProps = {}) {
  const baseConfig = useMemo(() => getWidgetConfig(configOverride), [configOverride]);
  const [config, setConfig] = useState(baseConfig);

  const [activeStep, setActiveStep] = useState<AppStep>('service');
  const [services, setServices] = useState<Service[]>(config.services);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [availability, setAvailability] = useState<DailyAvailability[]>(config.availability);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const [servicesLoading, setServicesLoading] = useState(
    config.services.length === 0 && Boolean(config.api.servicesUrl),
  );
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStepRef = useRef<AppStep>(activeStep);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setConfig(baseConfig);
    void loadPublishedWidgetConfig(baseConfig)
      .then((published) => {
        if (!cancelled) setConfig(published);
      })
      .catch(() => {
        // Keep the locally supplied design if a remote theme is temporarily unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [baseConfig]);

  function scrollToTop() {
    shellRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  useEffect(() => {
    let cancelled = false;

    async function hydrateServices() {
      if (config.services.length > 0 || !config.api.servicesUrl) return;

      setServicesLoading(true);
      setErrorMessage(null);

      try {
        const nextServices = await loadServices(config);
        if (cancelled) return;
        setServices(nextServices);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(getErrorMessage(error, 'Unable to load services.'));
      } finally {
        if (!cancelled) setServicesLoading(false);
      }
    }

    void hydrateServices();
    return () => {
      cancelled = true;
    };
  }, [config]);

  const reloadAvailability = useCallback(async () => {
    if (!selectedService) {
      setAvailability([]);
      return;
    }

    setSelectedSlot(null);
    setSelectedDate(null);

    if (config.availability.length > 0) {
      setAvailability(config.availability);
      return;
    }

    if (!config.api.availabilityUrl) {
      setAvailability([]);
      return;
    }

    setAvailability([]);
    setAvailabilityLoading(true);
    setErrorMessage(null);

    try {
      const nextAvailability = await loadAvailability(config, selectedService.id);
      setAvailability(nextAvailability);
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to load availability.'));
    } finally {
      setAvailabilityLoading(false);
    }
  }, [config, selectedService]);

  useEffect(() => {
    if (!selectedService) {
      setAvailability([]);
      return;
    }

    const currentService = selectedService;
    let cancelled = false;

    async function hydrateAvailability() {
      setSelectedSlot(null);
      setSelectedDate(null);

      if (config.availability.length > 0) {
        setAvailability(config.availability);
        return;
      }

      if (!config.api.availabilityUrl) {
        setAvailability([]);
        return;
      }

      setAvailability([]);
      setAvailabilityLoading(true);
      setErrorMessage(null);

      try {
        const nextAvailability = await loadAvailability(config, currentService.id);
        if (cancelled) return;
        setAvailability(nextAvailability);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(getErrorMessage(error, 'Unable to load availability.'));
      } finally {
        if (!cancelled) setAvailabilityLoading(false);
      }
    }

    void hydrateAvailability();
    return () => {
      cancelled = true;
    };
  }, [config, selectedService]);

  useEffect(() => {
    if (previousStepRef.current === activeStep) return;
    previousStepRef.current = activeStep;

    const frame = window.requestAnimationFrame(() => {
      stepHeadingRef.current?.focus({ preventScroll: true });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeStep]);

  const hasServiceSource = services.length > 0 || Boolean(config.api.servicesUrl) || servicesLoading;

  function chooseService(service: Service) {
    setSelectedService(service);
    setSelectedSlot(null);
    setSelectedDate(null);
    setErrorMessage(null);
  }

  function goToCalendar() {
    if (!selectedService) return;
    setErrorMessage(null);
    setActiveStep('time');
    window.requestAnimationFrame(scrollToTop);
  }

  function goToBooking() {
    if (!selectedService || !selectedSlot || !selectedDate) return;
    setErrorMessage(null);
    setActiveStep('booking');
    window.requestAnimationFrame(scrollToTop);
  }

  function resetForAnotherBooking() {
    setErrorMessage(null);
    setActiveStep('service');
    setSelectedService(null);
    setSelectedDate(null);
    setSelectedSlot(null);
    window.requestAnimationFrame(scrollToTop);
  }

  const radius = config.theme.cornerStyle === 'pill' ? '34px' : config.theme.cornerStyle === 'soft' ? '18px' : '26px';
  const fontFamily = config.theme.fontStyle === 'classic'
    ? 'Georgia, "Times New Roman", serif'
    : config.theme.fontStyle === 'friendly'
      ? '"Avenir Next Rounded", "Nunito Sans", "Trebuchet MS", sans-serif'
      : '"Manrope", "Avenir Next", "Segoe UI", sans-serif';
  const widgetStyle = {
    '--chime-primary': config.theme.primaryColor,
    '--chime-accent': config.theme.accentColor,
    '--chime-surface': config.theme.surfaceColor,
    '--chime-text': config.theme.textColor,
    '--mint-50': `color-mix(in srgb, ${config.theme.primaryColor} 10%, white)`,
    '--mint-100': `color-mix(in srgb, ${config.theme.primaryColor} 18%, white)`,
    '--mint-200': `color-mix(in srgb, ${config.theme.primaryColor} 34%, white)`,
    '--mint-300': `color-mix(in srgb, ${config.theme.primaryColor} 58%, white)`,
    '--mint-400': `color-mix(in srgb, ${config.theme.primaryColor} 82%, white)`,
    '--mint-500': config.theme.primaryColor,
    '--mint-600': `color-mix(in srgb, ${config.theme.primaryColor} 84%, black)`,
    '--mint-700': `color-mix(in srgb, ${config.theme.primaryColor} 70%, black)`,
    '--mint-800': `color-mix(in srgb, ${config.theme.primaryColor} 58%, black)`,
    '--warm-white': config.theme.surfaceColor,
    '--ink': config.theme.textColor,
    '--radius-xl': radius,
    '--chime-font': fontFamily,
  } as CSSProperties;

  return (
    <div
      ref={shellRef}
      className={`chime-widget chime-app-shell${variant === 'fullpage' ? ' chime-app-shell--fullpage' : ''}`}
      data-chime-card-style={config.theme.cardStyle}
      data-chime-font={config.theme.fontStyle}
      style={widgetStyle}
    >
      <a className="skip-link" href="#chime-main">Skip to booking</a>
      <div className="chime-background" aria-hidden="true">
        <span className="chime-orb chime-orb--one" />
        <span className="chime-orb chime-orb--two" />
        <span className="chime-orb chime-orb--three" />
      </div>

      <Header
        title={config.headerTitle ?? config.businessName}
        eyebrow={config.headerEyebrow}
        logoVariant={config.theme.logoVariant}
        customLogoUrl={config.theme.customLogoUrl}
      />

      <main id="chime-main" tabIndex={-1} className="chime-main">
        <section className="chime-main__inner">
          <p className="sr-only" role="status" aria-live="polite">{`Step ${bookingSteps.findIndex((s) => s.id === activeStep) + 1} of ${bookingSteps.length}: ${bookingSteps.find((s) => s.id === activeStep)?.label ?? ''}`}</p>
          <ProgressSteps steps={bookingSteps} currentStep={activeStep} />

          {errorMessage && (
            <motion.div
              className="chime-alert chime-alert--error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {errorMessage}
              {activeStep === 'time' && (
                <button type="button" className="chime-button chime-button--ghost chime-button--compact" onClick={() => void reloadAvailability()}>
                  Try again
                </button>
              )}
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {activeStep === 'service' && (
              <motion.section
                key="service-step"
                className="chime-stage liquid-card"
                initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -16, filter: 'blur(8px)' }}
                transition={{ duration: 0.36, ease: 'easeOut' }}
              >
                <div className="chime-stage__header">
                  <div>
                    <p className="chime-kicker">Start here</p>
                    <h2 ref={stepHeadingRef} tabIndex={-1}>Choose your appointment type</h2>
                    <p>{config.description}</p>
                  </div>
                </div>

                {!hasServiceSource && (
                  <div className="chime-alert chime-alert--warning">
                    Add services through <code>window.CHIME_WIDGET_CONFIG.services</code> or connect the services endpoint before publishing the widget.
                  </div>
                )}

                {servicesLoading ? (
                  <div className="chime-loading-card">Loading services…</div>
                ) : (
                  <ServiceList services={services} selectedId={selectedService?.id} onSelect={chooseService} currency={config.payment.currency} />
                )}

                <div className="stage-footer">
                  <div className="stage-footer__copy">
                    <strong>{selectedService ? selectedService.name : 'Select a service'}</strong>
                    <span>{selectedService ? 'Continue to the full calendar.' : 'The calendar appears after this step.'}</span>
                  </div>
                  <ContinueButton type="button" disabled={!selectedService} onClick={goToCalendar} className="stage-footer__button">
                    Continue to calendar
                  </ContinueButton>
                </div>
              </motion.section>
            )}

            {activeStep === 'time' && selectedService && (
              <motion.section
                key="calendar-step"
                className="chime-stage liquid-card"
                initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -16, filter: 'blur(8px)' }}
                transition={{ duration: 0.36, ease: 'easeOut' }}
              >
                <div className="chime-stage__header chime-stage__header--split">
                  <div>
                    <p className="chime-kicker">Calendar</p>
                    <h2 ref={stepHeadingRef} tabIndex={-1}>Choose a date and time</h2>
                    <p>{`Pick your appointment date and time. Terms, contact details${
                      getAppointmentDepositAmountCents(selectedService) > 0 && config.payment.enabled !== false
                        ? ', and the deposit'
                        : ''
                    } come next.`}</p>
                  </div>
                  <button type="button" className="chime-button chime-button--secondary chime-button--compact" onClick={() => { setErrorMessage(null); setActiveStep('service'); }}>
                    Change service
                  </button>
                </div>

                <ServiceSummary service={selectedService} currency={config.payment.currency} />

                {availabilityLoading ? (
                  <div className="chime-loading-card">Loading live availability…</div>
                ) : availability.length === 0 && !errorMessage ? (
                  <div className="chime-empty-state">
                    <p className="chime-empty-state__title">No availability found.</p>
                    <p className="chime-empty-state__copy">
                      Connect the availability endpoint or pass availability into the widget config for this service.
                    </p>
                  </div>
                ) : availability.length > 0 ? (
                  <CalendarView
                    service={selectedService}
                    availability={availability}
                    selectedDate={selectedDate}
                    selectedSlot={selectedSlot}
                    onDayChanged={() => {
                      setSelectedSlot(null);
                      setSelectedDate(null);
                    }}
                    onSlotPicked={(slot, date) => {
                      setSelectedSlot(slot);
                      setSelectedDate(date);
                    }}
                  />
                ) : null}

                <div className="stage-footer">
                  {selectedSlot && selectedDate ? (
                    <SlotSummary date={selectedDate} slot={selectedSlot} />
                  ) : (
                    <div className="stage-footer__copy">
                      <strong>Choose a time</strong>
                      <span>Pick an available day, then select a time to continue.</span>
                    </div>
                  )}
                  <ContinueButton type="button" disabled={!selectedSlot || !selectedDate} onClick={goToBooking} className="stage-footer__button">
                    Continue to terms
                  </ContinueButton>
                </div>
              </motion.section>
            )}

            {activeStep === 'booking' && selectedService && selectedSlot && selectedDate && (
              <motion.section
                key="booking-step"
                className="chime-stage liquid-card booking-stage"
                initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -16, filter: 'blur(8px)' }}
                transition={{ duration: 0.36, ease: 'easeOut' }}
              >
                <BookingFlow
                  config={config}
                  service={selectedService}
                  slot={selectedSlot}
                  date={selectedDate}
                  onClose={() => setActiveStep('time')}
                  onDone={() => undefined}
                  onBookAnother={resetForAnotherBooking}
                />
              </motion.section>
            )}
          </AnimatePresence>
        </section>
      </main>
      {config.theme.showPoweredBy ? (
        <footer className="chime-powered-by">
          <span>Booking powered by</span>
          <img src={chimeWordmark} alt="Chime" />
        </footer>
      ) : null}
    </div>
  );
}
