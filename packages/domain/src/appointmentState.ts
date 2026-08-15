import type {
  Appointment,
  AppointmentChangePatch,
  AppointmentChangeRequest,
  AppointmentStatus,
  ChangeApprovalMode,
  ChangeRequestStatus,
  DurationRules,
  ISODateTime,
} from "../../contracts/src/appointment";

const APPOINTMENT_TRANSITIONS: Readonly<
  Record<AppointmentStatus, readonly AppointmentStatus[]>
> = {
  draft: ["held", "pending_approval", "confirmed", "cancelled", "expired"],
  held: [
    "pending_payment",
    "pending_approval",
    "confirmed",
    "cancelled",
    "expired",
  ],
  pending_payment: [
    "pending_approval",
    "confirmed",
    "cancelled",
    "expired",
  ],
  pending_approval: ["confirmed", "declined", "cancelled", "expired"],
  confirmed: ["change_pending", "cancelled", "completed", "no_show"],
  change_pending: ["confirmed", "cancelled", "completed", "no_show"],
  cancelled: [],
  completed: [],
  no_show: [],
  expired: [],
  declined: [],
};

const CHANGE_REQUEST_TRANSITIONS: Readonly<
  Record<ChangeRequestStatus, readonly ChangeRequestStatus[]>
> = {
  draft: ["pending", "withdrawn"],
  pending: ["approved", "declined", "expired", "withdrawn", "superseded"],
  approved: [],
  declined: [],
  expired: [],
  withdrawn: [],
  superseded: [],
};

export class AppointmentRuleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AppointmentRuleError";
    this.code = code;
  }
}

export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return APPOINTMENT_TRANSITIONS[from].includes(to);
}

export function assertAppointmentTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): void {
  if (!canTransitionAppointment(from, to)) {
    throw new AppointmentRuleError(
      "INVALID_APPOINTMENT_TRANSITION",
      `Appointment cannot move from ${from} to ${to}.`,
    );
  }
}

export function canTransitionChangeRequest(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): boolean {
  return CHANGE_REQUEST_TRANSITIONS[from].includes(to);
}

export function assertChangeRequestTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): void {
  if (!canTransitionChangeRequest(from, to)) {
    throw new AppointmentRuleError(
      "INVALID_CHANGE_REQUEST_TRANSITION",
      `Change request cannot move from ${from} to ${to}.`,
    );
  }
}

export function validateAppointmentInterval(
  startsAt: ISODateTime,
  endsAt: ISODateTime,
  durationRules?: DurationRules,
): number {
  const startMs = Date.parse(startsAt);
  const endMs = Date.parse(endsAt);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new AppointmentRuleError(
      "INVALID_APPOINTMENT_TIME",
      "Appointment times must be valid ISO date-time values.",
    );
  }

  if (endMs <= startMs) {
    throw new AppointmentRuleError(
      "INVALID_APPOINTMENT_INTERVAL",
      "Appointment end time must be after its start time.",
    );
  }

  const durationMinutes = (endMs - startMs) / 60_000;

  if (!Number.isInteger(durationMinutes)) {
    throw new AppointmentRuleError(
      "INVALID_APPOINTMENT_DURATION",
      "Appointment duration must resolve to a whole number of minutes.",
    );
  }

  if (!durationRules) {
    return durationMinutes;
  }

  if (
    durationMinutes < durationRules.minimumMinutes ||
    durationMinutes > durationRules.maximumMinutes
  ) {
    throw new AppointmentRuleError(
      "APPOINTMENT_DURATION_OUT_OF_RANGE",
      `Appointment duration must be between ${durationRules.minimumMinutes} and ${durationRules.maximumMinutes} minutes.`,
    );
  }

  if (durationMinutes % durationRules.incrementMinutes !== 0) {
    throw new AppointmentRuleError(
      "INVALID_APPOINTMENT_INCREMENT",
      `Appointment duration must use ${durationRules.incrementMinutes}-minute increments.`,
    );
  }

  return durationMinutes;
}

export function isSchedulingChange(patch: AppointmentChangePatch): boolean {
  return (
    patch.startsAt !== undefined ||
    patch.endsAt !== undefined ||
    patch.locationId !== undefined ||
    patch.staffIds !== undefined ||
    patch.resourceIds !== undefined
  );
}

export function requiresChangeApproval(
  mode: ChangeApprovalMode,
  patch: AppointmentChangePatch,
): boolean {
  return mode !== "automatic" && isSchedulingChange(patch);
}

export function applyApprovedChange(
  appointment: Appointment,
  request: AppointmentChangeRequest,
  updatedAt: ISODateTime,
  durationRules?: DurationRules,
): Appointment {
  if (request.appointmentId !== appointment.id) {
    throw new AppointmentRuleError(
      "CHANGE_REQUEST_APPOINTMENT_MISMATCH",
      "Change request belongs to a different appointment.",
    );
  }

  if (request.status !== "approved") {
    throw new AppointmentRuleError(
      "CHANGE_REQUEST_NOT_APPROVED",
      "Only an approved change request can update an appointment.",
    );
  }

  if (request.baseAppointmentVersion !== appointment.version) {
    throw new AppointmentRuleError(
      "STALE_APPOINTMENT_VERSION",
      "Appointment changed after this request was created.",
    );
  }

  const startsAt = request.proposed.startsAt ?? appointment.startsAt;
  const endsAt = request.proposed.endsAt ?? appointment.endsAt;
  validateAppointmentInterval(startsAt, endsAt, durationRules);

  return {
    ...appointment,
    startsAt,
    endsAt,
    locationId:
      request.proposed.locationId === null
        ? undefined
        : (request.proposed.locationId ?? appointment.locationId),
    staffIds: request.proposed.staffIds ?? appointment.staffIds,
    resourceIds: request.proposed.resourceIds ?? appointment.resourceIds,
    customerNotes:
      request.proposed.customerNotes ?? appointment.customerNotes,
    internalNotes:
      request.proposed.internalNotes ?? appointment.internalNotes,
    status: "confirmed",
    version: appointment.version + 1,
    updatedAt,
  };
}
