import { sampleAvailability } from '@/data/sampleAvailability';
import { sampleServices } from '@/data/sampleServices';
import { normalizeAvailability, normalizeServices } from '@/lib/normalizers';
import type { CustomerFieldConfig, WidgetConfig, WidgetConfigInput, WidgetThemeConfig } from '@/types/widget';

export const defaultWidgetTheme: WidgetThemeConfig = {
  primaryColor: '#42c79a',
  accentColor: '#ffd36e',
  surfaceColor: '#fffef9',
  textColor: '#102a24',
  logoVariant: 'wordmark-smile',
  cardStyle: 'soft',
  cornerStyle: 'rounded',
  fontStyle: 'modern',
  showPoweredBy: true,
};

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

/*
 * Every value this file reads, named one at a time.
 *
 * It used to be `return import.meta.env ?? {}`, and that one line put every
 * VITE_ variable in the repository root into dist-embed/chime-widget.js — the
 * file that gets copied onto customers' websites. Vite replaces
 * `import.meta.env` with a literal of the whole object whenever it cannot see
 * which key you want, and a function returning the object hides that from it
 * completely. The shipped bundle carried `{BASE_URL:"/",DEV:!1,...}` as proof.
 *
 * The project's answer until now was a rule — never put a secret in a VITE_
 * variable — repeated in ISOLATION.md, in adminConnection.ts and in a comment
 * in config/admin/.env.local, because careful handling at the call sites had
 * been tried against a sentinel and it shipped every time.
 *
 * Naming the keys is what makes Vite able to see them. Only these fourteen are
 * substituted now; anything else in the root environment stays out of the
 * bundle whether or not someone remembers the rule.
 *
 * ADDING A READ MEANS ADDING A LINE HERE. That is the cost, and it is the point:
 * a new variable cannot reach a customer's website by accident.
 */
const ENV = {
  DEV: import.meta.env.DEV,
  VITE_CHIME_API_BASE_URL: import.meta.env.VITE_CHIME_API_BASE_URL,
  VITE_CHIME_AVAILABILITY_URL: import.meta.env.VITE_CHIME_AVAILABILITY_URL,
  VITE_CHIME_BOOKING_URL: import.meta.env.VITE_CHIME_BOOKING_URL,
  VITE_CHIME_CURRENCY: import.meta.env.VITE_CHIME_CURRENCY,
  VITE_CHIME_DEPOSIT_REQUIRED: import.meta.env.VITE_CHIME_DEPOSIT_REQUIRED,
  VITE_CHIME_LOCATION: import.meta.env.VITE_CHIME_LOCATION,
  VITE_CHIME_ORGANIZATION_SLUG: import.meta.env.VITE_CHIME_ORGANIZATION_SLUG,
  VITE_CHIME_PAYMENT_DEMO_MODE: import.meta.env.VITE_CHIME_PAYMENT_DEMO_MODE,
  VITE_CHIME_PAYMENT_INTENT_URL: import.meta.env.VITE_CHIME_PAYMENT_INTENT_URL,
  VITE_CHIME_SERVICES_URL: import.meta.env.VITE_CHIME_SERVICES_URL,
  VITE_CHIME_STRIPE_PUBLISHABLE_KEY: import.meta.env.VITE_CHIME_STRIPE_PUBLISHABLE_KEY,
  VITE_CHIME_USE_DEMO_DATA: import.meta.env.VITE_CHIME_USE_DEMO_DATA,
  VITE_CHIME_WIDGET_SLUG: import.meta.env.VITE_CHIME_WIDGET_SLUG,
} as const;

function getEnv() {
  return ENV;
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

export function getWidgetConfig(inputOverride?: WidgetConfigInput): WidgetConfig {
  const env = getEnv();
  const input = inputOverride ?? readWindowConfig();
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
    organizationSlug: input.organizationSlug ?? env.VITE_CHIME_ORGANIZATION_SLUG,
    widgetSlug: input.widgetSlug ?? env.VITE_CHIME_WIDGET_SLUG,
    businessName: input.businessName ?? 'Chime',
    headerTitle: input.headerTitle ?? input.businessName ?? 'Chime',
    headerEyebrow: input.headerEyebrow ?? 'Appointment concierge',
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
    theme: {
      ...defaultWidgetTheme,
      ...input.theme,
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

interface PublishedWidgetResponse {
  widget: {
    organizationSlug: string;
    slug: string;
    theme?: Partial<WidgetThemeConfig>;
    copy?: {
      businessName?: string;
    headerTitle?: string;
    eyebrow?: string;
      description?: string;
      termsTitle?: string;
      termsText?: string;
      confirmationMessage?: string;
    };
    locale?: string;
    timeZone?: string;
  };
}

export async function loadPublishedWidgetConfig(config: WidgetConfig): Promise<WidgetConfig> {
  if (!config.organizationSlug || !config.widgetSlug || !config.api.baseUrl) return config;

  const endpoint = `${config.api.baseUrl.replace(/\/$/, '')}/widget-config/${encodeURIComponent(config.organizationSlug)}/${encodeURIComponent(config.widgetSlug)}`;
  const response = await fetch(endpoint, { headers: config.api.headers });
  if (response.status === 404) return config;
  if (!response.ok) throw new Error(`Unable to load the published widget design (${response.status}).`);

  const { widget } = await response.json() as PublishedWidgetResponse;
  const copy = widget.copy ?? {};
  return {
    ...config,
    organizationSlug: widget.organizationSlug,
    widgetSlug: widget.slug,
    businessName: copy.businessName ?? config.businessName,
    headerTitle: copy.headerTitle ?? config.headerTitle,
    headerEyebrow: copy.eyebrow ?? config.headerEyebrow,
    description: copy.description ?? config.description,
    termsTitle: copy.termsTitle ?? config.termsTitle,
    termsText: copy.termsText ?? config.termsText,
    confirmationMessage: copy.confirmationMessage ?? config.confirmationMessage,
    theme: { ...config.theme, ...widget.theme },
  };
}
