import { normalizeAvailability, normalizeServices } from '@/lib/normalizers';
import { toDateKey } from '@/lib/dates';
import type { DailyAvailability, DailyAvailabilityInput } from '@/types/calendar';
import type { Service } from '@/types/service';
import type { BookingPayload, BookingResponse, WidgetConfig } from '@/types/widget';

function resolveEndpoint(baseUrl: string | undefined, endpoint: string | undefined): string | null {
  if (!endpoint) return null;

  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    return new URL(endpoint, baseUrl || origin).toString();
  } catch {
    return endpoint;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON from ${response.url || 'API response'}, but received invalid JSON.`);
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const text = await response.text();

    if (text) {
      try {
        const data = JSON.parse(text) as { error?: string; message?: string };
        throw new Error(data.error ?? data.message ?? text);
      } catch (error) {
        if (error instanceof SyntaxError) throw new Error(text);
        throw error;
      }
    }

    throw new Error(`Request failed with status ${response.status}`);
  }

  return readJson<T>(response);
}

function buildHeaders(config: WidgetConfig, extra?: Record<string, string>) {
  return {
    'Content-Type': 'application/json',
    ...config.api.headers,
    ...extra,
  };
}

export async function loadServices(config: WidgetConfig): Promise<Service[]> {
  if (config.services.length > 0) return config.services;

  const url = resolveEndpoint(config.api.baseUrl, config.api.servicesUrl);
  if (!url) return [];

  const data = await fetchJson<Service[] | { services?: Service[] }>(url, {
    headers: buildHeaders(config),
  });
  const services = Array.isArray(data) ? data : data.services ?? [];
  return normalizeServices(services);
}

export async function loadAvailability(
  config: WidgetConfig,
  serviceId?: string,
): Promise<DailyAvailability[]> {
  if (config.availability.length > 0) return config.availability;

  const endpoint = resolveEndpoint(config.api.baseUrl, config.api.availabilityUrl);
  if (!endpoint) return [];

  const url = new URL(endpoint);
  if (serviceId) url.searchParams.set('serviceId', serviceId);

  const data = await fetchJson<DailyAvailabilityInput[] | { availability?: DailyAvailabilityInput[] }>(
    url.toString(),
    {
      headers: buildHeaders(config),
    },
  );
  const availability = Array.isArray(data) ? data : data.availability ?? [];
  return normalizeAvailability(availability);
}

export async function createPaymentIntent(
  config: WidgetConfig,
  payload: {
    amountCents: number;
    serviceId: string;
    serviceName: string;
    slotId: string;
    date: Date;
    customerEmail?: string;
  },
): Promise<{ clientSecret: string }> {
  const url = resolveEndpoint(config.api.baseUrl, config.api.paymentIntentUrl);
  if (!url) {
    throw new Error('No payment intent endpoint has been configured.');
  }

  return fetchJson<{ clientSecret: string }>(url, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      amount: payload.amountCents,
      currency: config.payment.currency ?? 'USD',
      serviceId: payload.serviceId,
      serviceName: payload.serviceName,
      slotId: payload.slotId,
      date: toDateKey(payload.date),
      customerEmail: payload.customerEmail,
    }),
  });
}

export async function submitBooking(
  config: WidgetConfig,
  payload: BookingPayload,
): Promise<BookingResponse> {
  const url = resolveEndpoint(config.api.baseUrl, config.api.bookingUrl);

  if (!url) {
    if (!config.demoData) {
      throw new Error('No booking endpoint has been configured. Your appointment was not saved.');
    }

    return {
      confirmationMessage:
        config.confirmationMessage ??
        'Demo booking completed locally. Connect a booking endpoint before accepting live appointments.',
      raw: payload,
    };
  }

  const data = await fetchJson<BookingResponse | { booking?: BookingResponse }>(url, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify(payload),
  });

  const booking = (typeof data === 'object' && data !== null && 'booking' in data
    ? data.booking ?? {}
    : data) as BookingResponse;

  return {
    bookingId: booking.bookingId,
    confirmationMessage:
      booking.confirmationMessage ?? config.confirmationMessage ?? 'Your booking has been submitted.',
    raw: booking,
  };
}
