export interface Slot {
  id: string;
  timeLabel: string;
  available: boolean;
  label?: string;
  startsAt?: string;
  endsAt?: string;
}

export interface DailyAvailability {
  date: Date;
  slots: Slot[];
}

export interface DailyAvailabilityInput {
  date: Date | string;
  slots: Slot[];
}

/** A quick look-up map used by calendar slot views.
 *  { "2025-06-06": [ …slots… ], "2025-06-07": [ … ] }  */
export type AvailabilityWeek = Record<string, Slot[]>;
