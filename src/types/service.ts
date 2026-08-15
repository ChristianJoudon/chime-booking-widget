export interface Service {
  id: string;
  name: string;
  description?: string;
  duration?: string;
  durationMinutes?: number;
  deposit?: number; // legacy dollars field
  depositAmountCents?: number;
  requiresHardware?: boolean;
  hardwareDelayDays?: number;
}

export type AvailabilityMap = Record<string, number>;
