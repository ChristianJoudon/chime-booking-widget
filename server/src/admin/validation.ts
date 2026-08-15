import {
  AdminApiError,
  type ChangeApprovalModeDto,
  type ConfirmationModeDto,
  type DepositModeDto,
  type ServiceWriteInput,
} from './types.js';

type JsonObject = Record<string, unknown>;

const DEPOSIT_MODES: readonly DepositModeDto[] = ['none', 'fixed', 'percentage', 'full'];
const CONFIRMATION_MODES: readonly ConfirmationModeDto[] = ['automatic', 'manual'];
const CHANGE_APPROVAL_MODES: readonly ChangeApprovalModeDto[] = [
  'automatic',
  'business',
  'affected_staff',
  'business_and_affected_staff',
];
const TONES = ['mint', 'sky', 'peach', 'lemon'] as const;
const GLYPHS = ['chat', 'return', 'bolt', 'sparkles'] as const;

function objectAt(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdminApiError(400, 'INVALID_SERVICE', `${field} must be an object.`);
  }
  return value as JsonObject;
}

function textAt(object: JsonObject, field: string, options: { max?: number; optional?: boolean } = {}): string | undefined {
  const value = object[field];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AdminApiError(400, 'INVALID_SERVICE', `${field} must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > (options.max ?? 160)) {
    throw new AdminApiError(400, 'INVALID_SERVICE', `${field} is too long.`);
  }
  return trimmed;
}

function integerAt(object: JsonObject, field: string, minimum: number, maximum: number): number {
  const value = object[field];
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new AdminApiError(400, 'INVALID_SERVICE', `${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function optionalIntegerAt(object: JsonObject, field: string, minimum: number, maximum: number): number | undefined {
  if (object[field] === undefined) return undefined;
  return integerAt(object, field, minimum, maximum);
}

function booleanAt(object: JsonObject, field: string): boolean {
  if (typeof object[field] !== 'boolean') {
    throw new AdminApiError(400, 'INVALID_SERVICE', `${field} must be true or false.`);
  }
  return object[field] as boolean;
}

function stringArrayAt(object: JsonObject, field: string, maximum = 100): string[] {
  const value = object[field];
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== 'string' || !item)) {
    throw new AdminApiError(400, 'INVALID_SERVICE', `${field} must be an array of identifiers.`);
  }
  return [...new Set(value as string[])];
}

function enumAt<T extends string>(object: JsonObject, field: string, values: readonly T[]): T {
  const value = object[field];
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new AdminApiError(400, 'INVALID_SERVICE', `${field} contains an unsupported value.`);
  }
  return value as T;
}

export function parseServiceWriteInput(body: unknown): ServiceWriteInput {
  const source = objectAt(body, 'service');
  const duration = objectAt(source.duration, 'duration');
  const buffers = objectAt(source.buffers, 'buffers');
  const bookingWindow = objectAt(source.bookingWindow, 'bookingWindow');
  const deposit = objectAt(source.deposit, 'deposit');

  const minimumMinutes = integerAt(duration, 'minimumMinutes', 5, 1440);
  const defaultMinutes = integerAt(duration, 'defaultMinutes', 5, 1440);
  const maximumMinutes = integerAt(duration, 'maximumMinutes', 5, 1440);
  const incrementMinutes = integerAt(duration, 'incrementMinutes', 5, 240);
  if (minimumMinutes > defaultMinutes || defaultMinutes > maximumMinutes) {
    throw new AdminApiError(400, 'INVALID_DURATION_RANGE', 'Duration must satisfy minimum <= default <= maximum.');
  }
  if (defaultMinutes % incrementMinutes !== 0) {
    throw new AdminApiError(400, 'INVALID_DURATION_INCREMENT', 'Default duration must use the configured resize increment.');
  }

  const slug = textAt(source, 'slug', { max: 100 }) as string;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new AdminApiError(400, 'INVALID_SLUG', 'slug must contain lowercase letters, numbers, and single hyphens.');
  }

  const currency = (textAt(source, 'currency', { max: 3 }) as string).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AdminApiError(400, 'INVALID_CURRENCY', 'currency must be a three-letter code.');
  }

  const depositMode = enumAt(deposit, 'mode', DEPOSIT_MODES);
  const fixedAmountMinor = optionalIntegerAt(deposit, 'fixedAmountMinor', 0, 100_000_000);
  const percentage = optionalIntegerAt(deposit, 'percentage', 1, 100);
  if (depositMode === 'fixed' && fixedAmountMinor === undefined) {
    throw new AdminApiError(400, 'INVALID_DEPOSIT', 'A fixed deposit requires fixedAmountMinor.');
  }
  if (depositMode === 'percentage' && percentage === undefined) {
    throw new AdminApiError(400, 'INVALID_DEPOSIT', 'A percentage deposit requires percentage.');
  }

  const customQuestions = source.customQuestions;
  if (!Array.isArray(customQuestions) || customQuestions.length > 50) {
    throw new AdminApiError(400, 'INVALID_SERVICE', 'customQuestions must be an array with at most 50 items.');
  }

  return {
    locationIds: stringArrayAt(source, 'locationIds'),
    name: textAt(source, 'name', { max: 120 }) as string,
    slug,
    shortDescription: textAt(source, 'shortDescription', { max: 240, optional: true }),
    category: textAt(source, 'category', { max: 80 }) as string,
    tone: enumAt(source, 'tone', TONES),
    glyph: enumAt(source, 'glyph', GLYPHS),
    duration: { defaultMinutes, minimumMinutes, maximumMinutes, incrementMinutes },
    buffers: {
      beforeMinutes: integerAt(buffers, 'beforeMinutes', 0, 1440),
      afterMinutes: integerAt(buffers, 'afterMinutes', 0, 1440),
    },
    bookingWindow: {
      minimumNoticeMinutes: integerAt(bookingWindow, 'minimumNoticeMinutes', 0, 525_600),
      maximumAdvanceDays: integerAt(bookingWindow, 'maximumAdvanceDays', 1, 730),
      cancellationNoticeMinutes: optionalIntegerAt(bookingWindow, 'cancellationNoticeMinutes', 0, 525_600),
      rescheduleNoticeMinutes: optionalIntegerAt(bookingWindow, 'rescheduleNoticeMinutes', 0, 525_600),
    },
    priceMinor: integerAt(source, 'priceMinor', 0, 100_000_000),
    currency,
    deposit: {
      mode: depositMode,
      currency,
      fixedAmountMinor: depositMode === 'fixed' ? fixedAmountMinor : undefined,
      percentage: depositMode === 'percentage' ? percentage : undefined,
      refundable: booleanAt(deposit, 'refundable'),
    },
    confirmationMode: enumAt(source, 'confirmationMode', CONFIRMATION_MODES),
    changeApprovalMode: enumAt(source, 'changeApprovalMode', CHANGE_APPROVAL_MODES),
    capacity: integerAt(source, 'capacity', 1, 10_000),
    staffIds: stringArrayAt(source, 'staffIds'),
    resourceIds: stringArrayAt(source, 'resourceIds'),
    customQuestions,
    isActive: booleanAt(source, 'isActive'),
    isPublic: booleanAt(source, 'isPublic'),
  };
}

export function parseUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AdminApiError(400, 'INVALID_IDENTIFIER', `${field} must be a UUID.`);
  }
  return value;
}

export function parseExpectedVersion(header: string | undefined): number {
  const normalized = header?.replace(/^W\//, '').replace(/^"|"$/g, '');
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 1) {
    throw new AdminApiError(428, 'VERSION_REQUIRED', 'Write requests require If-Match with the current service version.');
  }
  return version;
}

export function requireIdempotencyKey(value: string | undefined): string {
  if (!value || value.length < 8 || value.length > 200) {
    throw new AdminApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Write requests require an Idempotency-Key header.');
  }
  return value;
}
