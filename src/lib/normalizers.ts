import type { DailyAvailability, DailyAvailabilityInput, Slot } from '@/types/calendar';
import type { Service } from '@/types/service';
import { parseDateInput } from '@/lib/dates';

export const DEFAULT_APPOINTMENT_DEPOSIT_CENTS = 2000;

export function normalizeService(service: Service): Service {
  const durationMinutes =
    typeof service.durationMinutes === 'number'
      ? service.durationMinutes
      : typeof service.duration === 'string' && service.duration.endsWith(' min')
        ? Number.parseInt(service.duration, 10)
        : undefined;

  const duration = service.duration ?? (durationMinutes ? `${durationMinutes} min` : undefined);
  const depositAmountCents =
    typeof service.depositAmountCents === 'number'
      ? service.depositAmountCents
      : typeof service.deposit === 'number'
        ? Math.round(service.deposit * 100)
        : DEFAULT_APPOINTMENT_DEPOSIT_CENTS;

  return {
    ...service,
    duration,
    durationMinutes,
    depositAmountCents,
  };
}

export function normalizeServices(services: Service[]): Service[] {
  return services.map(normalizeService);
}

export function normalizeSlot(slot: Slot): Slot {
  return {
    ...slot,
    label: slot.label ?? undefined,
  };
}

export function normalizeAvailability(days: DailyAvailabilityInput[]): DailyAvailability[] {
  return [...days]
    .map((day) => ({
      date: parseDateInput(day.date),
      slots: (day.slots ?? []).map(normalizeSlot),
    }))
    .filter((day) => !Number.isNaN(day.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function getServiceDepositAmountCents(service?: Service | null): number {
  if (!service) return DEFAULT_APPOINTMENT_DEPOSIT_CENTS;
  if (typeof service.depositAmountCents === 'number') return service.depositAmountCents;
  if (typeof service.deposit === 'number') return Math.round(service.deposit * 100);
  return DEFAULT_APPOINTMENT_DEPOSIT_CENTS;
}

export function getAppointmentDepositAmountCents(service?: Service | null): number {
  // getServiceDepositAmountCents already falls back to the default deposit when
  // no amount is configured at all. We must NOT coerce an explicit 0 up to the
  // default here, otherwise no-deposit services are impossible and the
  // "No deposit" UI branches become unreachable dead code.
  return getServiceDepositAmountCents(service);
}

export function getServiceDurationLabel(service?: Service | null): string | undefined {
  if (!service) return undefined;
  if (service.duration) return service.duration;
  if (typeof service.durationMinutes === 'number') return `${service.durationMinutes} min`;
  return undefined;
}

export function formatMoneyFromCents(amountCents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format((amountCents || 0) / 100);
}
