export const ADMIN_ROLES = ['owner', 'admin', 'manager', 'staff', 'viewer'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminSessionClaims {
  issuer: 'chime-admin';
  subject: string;
  organizationId: string;
  role: AdminRole;
  email: string;
  issuedAt: number;
  expiresAt: number;
}

export interface DurationRulesDto {
  defaultMinutes: number;
  minimumMinutes: number;
  maximumMinutes: number;
  incrementMinutes: number;
}

export interface BufferRulesDto {
  beforeMinutes: number;
  afterMinutes: number;
}

export interface BookingWindowRulesDto {
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  cancellationNoticeMinutes?: number;
  rescheduleNoticeMinutes?: number;
}

export type DepositModeDto = 'none' | 'fixed' | 'percentage' | 'full';

export interface DepositPolicyDto {
  mode: DepositModeDto;
  currency: string;
  fixedAmountMinor?: number;
  percentage?: number;
  refundable: boolean;
}

export type ConfirmationModeDto = 'automatic' | 'manual';
export type ChangeApprovalModeDto =
  | 'automatic'
  | 'business'
  | 'affected_staff'
  | 'business_and_affected_staff';

export interface AdminServiceDto {
  id: string;
  organizationId: string;
  locationIds: string[];
  name: string;
  slug: string;
  shortDescription?: string;
  category: string;
  tone: 'mint' | 'sky' | 'peach' | 'lemon';
  glyph: 'chat' | 'return' | 'bolt' | 'sparkles';
  duration: DurationRulesDto;
  buffers: BufferRulesDto;
  bookingWindow: BookingWindowRulesDto;
  priceMinor: number;
  currency: string;
  deposit: DepositPolicyDto;
  confirmationMode: ConfirmationModeDto;
  changeApprovalMode: ChangeApprovalModeDto;
  capacity: number;
  staffIds: string[];
  resourceIds: string[];
  customQuestions: unknown[];
  isActive: boolean;
  isPublic: boolean;
  version: number;
}

export type ServiceWriteInput = Omit<AdminServiceDto, 'id' | 'organizationId' | 'version'>;

export interface ServiceMutationContext {
  organizationId: string;
  userId: string;
  requestId: string;
  idempotencyKey: string;
}

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
