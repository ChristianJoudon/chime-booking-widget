export type ISODateTime = string;
export type ISODate = string;

export type OrganizationId = string;
export type UserId = string;
export type LocationId = string;
export type StaffId = string;
export type ResourceId = string;
export type ServiceId = string;
export type CustomerId = string;
export type AppointmentId = string;
export type ChangeRequestId = string;

export type OrganizationRole =
  | "owner"
  | "admin"
  | "manager"
  | "staff"
  | "viewer";

export type AppointmentStatus =
  | "draft"
  | "held"
  | "pending_payment"
  | "pending_approval"
  | "confirmed"
  | "change_pending"
  | "cancelled"
  | "completed"
  | "no_show"
  | "expired"
  | "declined";

export type ChangeRequestStatus =
  | "draft"
  | "pending"
  | "approved"
  | "declined"
  | "expired"
  | "withdrawn"
  | "superseded";

export type BookingSource =
  | "widget"
  | "admin"
  | "customer_portal"
  | "api"
  | "import";

export type ConfirmationMode = "automatic" | "manual";

export type ChangeApprovalMode =
  | "automatic"
  | "business"
  | "affected_staff"
  | "business_and_affected_staff";

export type DepositMode = "none" | "fixed" | "percentage" | "full";

export interface DepositPolicy {
  mode: DepositMode;
  currency: string;
  fixedAmountMinor?: number;
  percentage?: number;
  refundable: boolean;
}

export interface DurationRules {
  defaultMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
  incrementMinutes: number;
}

export interface BufferRules {
  beforeMinutes: number;
  afterMinutes: number;
}

export interface BookingWindowRules {
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  cancellationNoticeMinutes?: number;
  rescheduleNoticeMinutes?: number;
}

export type CustomQuestionKind =
  | "short_text"
  | "long_text"
  | "single_select"
  | "multi_select"
  | "checkbox";

export interface CustomQuestionOption {
  value: string;
  label: string;
}

export interface CustomQuestion {
  id: string;
  kind: CustomQuestionKind;
  label: string;
  helpText?: string;
  required: boolean;
  options?: readonly CustomQuestionOption[];
}

export interface ServiceDefinition {
  id: ServiceId;
  organizationId: OrganizationId;
  locationIds: readonly LocationId[];
  name: string;
  slug: string;
  shortDescription?: string;
  duration: DurationRules;
  buffers: BufferRules;
  bookingWindow: BookingWindowRules;
  priceMinor: number;
  currency: string;
  deposit: DepositPolicy;
  confirmationMode: ConfirmationMode;
  changeApprovalMode: ChangeApprovalMode;
  capacity: number;
  staffIds: readonly StaffId[];
  resourceIds: readonly ResourceId[];
  customQuestions: readonly CustomQuestion[];
  isActive: boolean;
  isPublic: boolean;
  version: number;
}

export interface AppointmentParticipant {
  kind: "customer" | "staff" | "guest";
  customerId?: CustomerId;
  staffId?: StaffId;
  name?: string;
  email?: string;
}

export interface Appointment {
  id: AppointmentId;
  organizationId: OrganizationId;
  serviceId: ServiceId;
  customerId: CustomerId;
  locationId?: LocationId;
  staffIds: readonly StaffId[];
  resourceIds: readonly ResourceId[];
  participants: readonly AppointmentParticipant[];
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  timeZone: string;
  status: AppointmentStatus;
  source: BookingSource;
  confirmationMode: ConfirmationMode;
  changeApprovalMode: ChangeApprovalMode;
  customerNotes?: string;
  internalNotes?: string;
  customAnswers: Readonly<Record<string, unknown>>;
  version: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface AppointmentChangePatch {
  startsAt?: ISODateTime;
  endsAt?: ISODateTime;
  locationId?: LocationId | null;
  staffIds?: readonly StaffId[];
  resourceIds?: readonly ResourceId[];
  customerNotes?: string;
  internalNotes?: string;
}

export interface AppointmentChangeRequest {
  id: ChangeRequestId;
  organizationId: OrganizationId;
  appointmentId: AppointmentId;
  baseAppointmentVersion: number;
  requestedBy: {
    kind: "user" | "customer" | "system";
    id?: UserId | CustomerId;
  };
  proposed: AppointmentChangePatch;
  reason?: string;
  status: ChangeRequestStatus;
  expiresAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ChangeDecision {
  requestId: ChangeRequestId;
  decision: "approve" | "decline";
  decidedBy: {
    kind: "user" | "customer";
    id: UserId | CustomerId;
  };
  note?: string;
  decidedAt: ISODateTime;
}

export interface GridAppointment {
  appointmentId: AppointmentId;
  serviceId: ServiceId;
  customerDisplayName: string;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  staffIds: readonly StaffId[];
  resourceIds: readonly ResourceId[];
  status: AppointmentStatus;
  version: number;
  pendingChange?: AppointmentChangePatch;
}

export interface GridCreateCommand {
  kind: "create";
  serviceId: ServiceId;
  customerId: CustomerId;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  staffIds: readonly StaffId[];
  resourceIds: readonly ResourceId[];
}

export interface GridMoveCommand {
  kind: "move";
  appointmentId: AppointmentId;
  baseAppointmentVersion: number;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
  staffIds?: readonly StaffId[];
  resourceIds?: readonly ResourceId[];
}

export interface GridResizeCommand {
  kind: "resize";
  appointmentId: AppointmentId;
  baseAppointmentVersion: number;
  startsAt: ISODateTime;
  endsAt: ISODateTime;
}

export interface GridAssignCommand {
  kind: "assign";
  appointmentId: AppointmentId;
  baseAppointmentVersion: number;
  staffIds: readonly StaffId[];
  resourceIds: readonly ResourceId[];
}

export type GridCommand =
  | GridCreateCommand
  | GridMoveCommand
  | GridResizeCommand
  | GridAssignCommand;

export interface WidgetTheme {
  fontFamily?: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  accentColor: string;
  borderColor: string;
  cornerRadiusPx: number;
  showCardMotion: boolean;
}

export interface WidgetCopy {
  heading?: string;
  introduction?: string;
  serviceStepLabel?: string;
  timeStepLabel?: string;
  detailsStepLabel?: string;
  confirmationMessage?: string;
}

export interface WidgetConfiguration {
  id: string;
  organizationId: OrganizationId;
  locationId?: LocationId;
  slug: string;
  enabledServiceIds: readonly ServiceId[];
  theme: WidgetTheme;
  copy: WidgetCopy;
  collectPhone: "required" | "optional" | "hidden";
  collectMarketingConsent: boolean;
  locale: string;
  timeZone: string;
  version: number;
}
