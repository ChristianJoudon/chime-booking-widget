import { sampleAvailability } from '@/data/sampleAvailability';
import { sampleServices } from '@/data/sampleServices';
import { normalizeAvailability, normalizeServices } from '@/lib/normalizers';
import type { CustomerFieldConfig, WidgetConfig, WidgetConfigInput } from '@/types/widget';

const defaultCustomerFields: CustomerFieldConfig[] = [
  {
    key: 'name',
    label: 'Full name',
    placeholder: 'Jane Doe',
    required: true,
    type: 'text',
  },
  {
    key: 'email',
    label: 'Email',
    placeholder: 'jane@example.com',
    required: true,
    type: 'email',
  },
  {
    key: 'phone',
    label: 'Phone',
    placeholder: '(555) 555-5555',
    required: false,
    type: 'tel',
  },
  {
    key: 'notes',
    label: 'Notes',
    placeholder: 'Anything we should know before the appointment?',
    required: false,
    type: 'textarea',
  },
];

const defaultTerms = `Appointment Terms & Conditions

By requesting an appointment, you confirm that the information you provide is accurate and that you are authorized to request service at the appointment location or for the relevant device, account, or property.

Appointment times are offered from the live calendar and may be held temporarily while your request is submitted. Your appointment is not final until the booking confirmation page is displayed or a confirmation is sent by the business.

A refundable $20 appointment deposit may be authorized before the appointment to reserve the selected time. The deposit is refundable according to the posted policy unless the business policy allows applying it to late cancellation, no-show, unresolved balances, or approved services.

Please cancel or reschedule as early as possible if you cannot attend. Same-day cancellations, missed appointments, or inaccurate appointment information may reduce availability for other customers and may be subject to the posted policy.

The business may contact you by email, phone, or text about scheduling, appointment preparation, service status, and follow-up. Standard carrier messaging rates may apply.

The business may decline, reschedule, or cancel an appointment when the requested service is outside scope, unsafe, unavailable, incorrectly booked, or missing required information.

You agree to review all service estimates, payment requirements, warranties, and cancellation terms provided by the business before approving any paid work.

By scrolling to the bottom and accepting this document, you acknowledge that you have read and agree to these booking terms.`;

function getEnv() {
  return import.meta.env ?? {};
}

function shouldUseDemoData(): boolean {
  const env = getEnv();

  if (env.VITE_CHIME_USE_DEMO_DATA === 'true') return true;
  if (env.VITE_CHIME_USE_DEMO_DATA === 'false') return false;

  return Boolean(env.DEV);
}

function readWindowConfig(): WidgetConfigInput {
  if (typeof window === 'undefined') return {};
  return window.CHIME_WIDGET_CONFIG ?? {};
}

export function getWidgetConfig(): WidgetConfig {
  const env = getEnv();
  const input = readWindowConfig();
  const demoMode = shouldUseDemoData();
  const apiBaseUrl = input.api?.baseUrl ?? env.VITE_CHIME_API_BASE_URL;
  const inferredEndpoint = (path: string) => apiBaseUrl
    ? `${apiBaseUrl.replace(/\/$/, '')}/${path}`
    : undefined;

  const services = input.services?.length ? input.services : demoMode ? sampleServices : [];

  const availability = input.availability?.length
    ? input.availability
    : demoMode
      ? sampleAvailability
      : [];

  return {
    businessName: input.businessName ?? 'Chime',
    headerTitle: input.headerTitle ?? input.businessName ?? 'Chime',
    location: input.location ?? env.VITE_CHIME_LOCATION,
    description:
      input.description ??
      'Choose a service first, then pick a date and time from the calendar. Terms, contact details, and the refundable $20 deposit come after your time selection.',
    services: normalizeServices(services),
    availability: normalizeAvailability(availability),
    api: {
      baseUrl: apiBaseUrl,
      headers: input.api?.headers ?? {},
      servicesUrl:
        input.api?.servicesUrl ?? env.VITE_CHIME_SERVICES_URL ?? inferredEndpoint('services'),
      availabilityUrl:
        input.api?.availabilityUrl
        ?? env.VITE_CHIME_AVAILABILITY_URL
        ?? inferredEndpoint('availability'),
      bookingUrl:
        input.api?.bookingUrl ?? env.VITE_CHIME_BOOKING_URL ?? inferredEndpoint('bookings'),
      paymentIntentUrl:
        input.api?.paymentIntentUrl
        ?? env.VITE_CHIME_PAYMENT_INTENT_URL
        ?? inferredEndpoint('create-payment-intent'),
    },
    payment: {
      enabled: input.payment?.enabled ?? true,
      required:
        input.payment?.required ?? (env.VITE_CHIME_DEPOSIT_REQUIRED === 'false' ? false : true),
      demoMode: input.payment?.demoMode ?? env.VITE_CHIME_PAYMENT_DEMO_MODE === 'true',
      stripePublishableKey:
        input.payment?.stripePublishableKey ?? env.VITE_CHIME_STRIPE_PUBLISHABLE_KEY,
      currency: input.payment?.currency ?? env.VITE_CHIME_CURRENCY ?? 'USD',
    },
    customerFields:
      input.customerFields && input.customerFields.length > 0
        ? input.customerFields
        : defaultCustomerFields,
    termsTitle: input.termsTitle ?? `${input.businessName ?? 'Chime'} Terms & Conditions`,
    termsText: input.termsText ?? defaultTerms,
    confirmationMessage: input.confirmationMessage,
    demoData: demoMode,
  };
}
