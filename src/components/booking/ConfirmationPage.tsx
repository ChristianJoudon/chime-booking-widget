import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { useMemo } from 'react';

import { ContinueButton } from '@/components/ui/ContinueButton';
import {
  buildAppointmentEvent,
  downloadIcs,
  googleCalendarUrl,
  office365Url,
  outlookLiveUrl,
  yahooCalendarUrl,
} from '@/lib/calendarLinks';
import { formatMoneyFromCents, getAppointmentDepositAmountCents } from '@/lib/normalizers';
import type { Slot } from '@/types/calendar';
import type { Service } from '@/types/service';
import type { BookingResponse, CustomerDetails, WidgetConfig } from '@/types/widget';

interface Props {
  config: WidgetConfig;
  service: Service;
  slot: Slot;
  date: Date;
  customer: CustomerDetails;
  bookingResponse: BookingResponse | null;
  paymentIntentId?: string;
  onBookAnother?: () => void;
}

export default function ConfirmationPage({
  config,
  service,
  slot,
  date,
  customer,
  bookingResponse,
  paymentIntentId,
  onBookAnother,
}: Props) {
  const depositAmountCents = getAppointmentDepositAmountCents(service);

  const calendarEvent = useMemo(
    () =>
      buildAppointmentEvent({
        serviceName: service.name,
        durationMinutes: service.durationMinutes,
        businessName: config.businessName,
        location: config.location,
        bookingId: bookingResponse?.bookingId,
        slot,
        date,
      }),
    [service.name, service.durationMinutes, config.businessName, config.location, bookingResponse?.bookingId, slot, date],
  );

  return (
    <div className="confirmation-page">
      <motion.div
        className="confirmation-page__badge"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 18 }}
      >
        ✓
      </motion.div>

      <div className="confirmation-page__header">
        <p className="chime-kicker">Confirmed</p>
        <h2>Appointment request received</h2>
        <p>
          Thanks, {customer.name}. A confirmation has been prepared for {customer.email}.
        </p>
      </div>

      <section className="confirmation-receipt" aria-label="Booking confirmation receipt">
        <div>
          <span>Service</span>
          <strong>{service.name}</strong>
        </div>
        <div>
          <span>Date</span>
          <strong>{format(date, 'EEEE, MMMM d, yyyy')}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>{slot.timeLabel}</strong>
        </div>
        {depositAmountCents > 0 && (
          <div>
            <span>Refundable deposit</span>
            <strong>
              {paymentIntentId
                ? formatMoneyFromCents(depositAmountCents, config.payment.currency)
                : 'Pending setup'}
            </strong>
          </div>
        )}
        {bookingResponse?.bookingId && (
          <div>
            <span>Reference</span>
            <strong>{bookingResponse.bookingId}</strong>
          </div>
        )}
      </section>

      <section className="calendar-add" aria-label="Add this appointment to your calendar">
        <p className="chime-kicker">Add to your calendar</p>
        <div className="calendar-add__buttons">
          <a
            className="chime-button chime-button--ghost chime-button--compact"
            href={googleCalendarUrl(calendarEvent)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Calendar
          </a>
          <button
            type="button"
            className="chime-button chime-button--ghost chime-button--compact"
            onClick={() => downloadIcs(calendarEvent, 'chime-appointment.ics')}
          >
            Apple / iCal (.ics)
          </button>
          <a
            className="chime-button chime-button--ghost chime-button--compact"
            href={outlookLiveUrl(calendarEvent)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Outlook.com
          </a>
          <a
            className="chime-button chime-button--ghost chime-button--compact"
            href={office365Url(calendarEvent)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Office 365
          </a>
          <a
            className="chime-button chime-button--ghost chime-button--compact"
            href={yahooCalendarUrl(calendarEvent)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Yahoo
          </a>
        </div>
      </section>

      <p className="confirmation-page__message">
        {bookingResponse?.confirmationMessage ?? config.confirmationMessage ?? 'Your booking was saved successfully.'}
      </p>

      {onBookAnother && (
        <ContinueButton type="button" onClick={onBookAnother} className="confirmation-page__button">
          Book another appointment
        </ContinueButton>
      )}
    </div>
  );
}
