import type { DailyAvailability, DailyAvailabilityInput } from './calendar';
import type { Service } from './service';

export type CustomerFieldKey = 'name' | 'email' | 'phone' | 'notes' | (string & {});

export interface CustomerFieldConfig {
  key: CustomerFieldKey;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'email' | 'tel' | 'textarea';
}

export type CustomerDetails = {
  name: string;
  email: string;
  phone?: string;
  notes?: string;
} & Record<string, string | undefined>;

export interface ApiConfig {
  baseUrl?: string;
  headers?: Record<string, string>;
  servicesUrl?: string;
  availabilityUrl?: string;
  bookingUrl?: string;
  paymentIntentUrl?: string;
}

export interface PaymentConfig {
  enabled?: boolean;
  /** The refundable deposit must be paid before the booking is saved. Defaults to true. */
  required?: boolean;
  /** Force the simulated test-mode card form (for demos/embeds without Stripe). */
  demoMode?: boolean;
  stripePublishableKey?: string;
  currency?: string;
}

export type WidgetLogoVariant = 'wordmark' | 'wordmark-smile' | 'bell' | 'custom' | 'none';
export type WidgetCardStyle = 'soft' | 'outline' | 'solid';
export type WidgetCornerStyle = 'soft' | 'rounded' | 'pill';
export type WidgetFontStyle = 'modern' | 'friendly' | 'classic';

export interface WidgetThemeConfig {
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  logoVariant: WidgetLogoVariant;
  customLogoUrl?: string;
  cardStyle: WidgetCardStyle;
  cornerStyle: WidgetCornerStyle;
  fontStyle: WidgetFontStyle;
  showPoweredBy: boolean;
}

export interface WidgetConfig {
  organizationSlug?: string;
  widgetSlug?: string;
  businessName: string;
  headerTitle?: string;
  headerEyebrow?: string;
  description?: string;
  /** Business address/location, used for calendar events. */
  location?: string;
  services: Service[];
  availability: DailyAvailability[];
  api: ApiConfig;
  payment: PaymentConfig;
  theme: WidgetThemeConfig;
  customerFields: CustomerFieldConfig[];
  termsTitle?: string;
  termsText: string;
  confirmationMessage?: string;
  /** True when the widget is running on built-in demo data. Derived, not user-set. */
  demoData: boolean;
}

export interface WidgetConfigInput
  extends Partial<
    Omit<
      WidgetConfig,
      'services' | 'availability' | 'api' | 'payment' | 'theme' | 'customerFields' | 'demoData'
    >
  > {
  services?: Service[];
  availability?: DailyAvailabilityInput[];
  api?: Partial<ApiConfig>;
  payment?: Partial<PaymentConfig>;
  theme?: Partial<WidgetThemeConfig>;
  customerFields?: CustomerFieldConfig[];
}

export interface BookingPayload {
  serviceId: string;
  serviceName: string;
  date: string;
  timeLabel: string;
  slotId: string;
  depositAmountCents: number;
  customer: CustomerDetails;
  paymentIntentId?: string;
  termsAcceptedAt?: string;
}

export interface BookingResponse {
  bookingId?: string;
  confirmationMessage?: string;
  raw?: unknown;
}

export interface ChimeWidgetGlobal {
  mount: (target: string | HTMLElement, config?: WidgetConfigInput) => { unmount: () => void };
  autoMount: () => number;
}

declare global {
  interface Window {
    CHIME_WIDGET_CONFIG?: WidgetConfigInput;
    ChimeWidget?: ChimeWidgetGlobal;
  }
}
