/* eslint-disable @typescript-eslint/no-unused-vars */
const ADMIN_RELATIONSHIP_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stripDemoRelationshipIds<T>(input: T): T {
  if (typeof input !== 'object' || input === null) return input;

  const source = input as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...source };

  for (const key of ['staffIds', 'locationIds', 'resourceIds']) {
    const value = source[key];
    if (Array.isArray(value)) {
      normalized[key] = value.filter(
        (item): item is string => typeof item === 'string' && ADMIN_RELATIONSHIP_UUID.test(item),
      );
    }
  }

  return normalized as T;
}

import type { AdminServiceDefinition } from './serviceTypes';
import { describeMissingConnection, normalizeBaseUrl, resolveAdminBaseUrl, resolveAdminConnection } from './adminConnection';
import { clearSession, notifySessionEnded } from './adminSession';

export interface AdminStaffMember {
  id: string;
  displayName: string;
  email: string | null;
  color: string | null;
  isActive: boolean;
  settings: Record<string, unknown>;
  version: number;
}

export interface AdminLocation {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  address: Record<string, unknown>;
  isActive: boolean;
}

export interface AdminAvailabilityServiceSummary {
  id: string;
  name: string;
  slotCount: number;
  candidateCount: number;
}

export interface AdminAvailabilitySummary {
  mode: 'preview' | 'published';
  publicationId?: string;
  publishedAt?: string;
  startsOn: string;
  endsOn: string;
  horizonDays: number;
  timeZone: string;
  serviceCount: number;
  staffCount: number;
  slotCount: number;
  candidateCount: number;
  warnings: string[];
  services: AdminAvailabilityServiceSummary[];
}

export interface AdminAvailabilityException {
  id: string;
  staffId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  startsAt: string;
  endsAt: string;
  createdAt: string;
}

export type AdminCommunicationStatus = 'pending' | 'processing' | 'sent' | 'delivered' | 'failed' | 'suppressed';

export interface AdminCommunicationAttempt {
  provider: string;
  providerMode: 'sandbox' | 'live';
  status: 'sent' | 'failed';
  errorMessage: string | null;
  startedAt: string;
}

export interface AdminCommunicationDelivery {
  id: string;
  channel: 'email' | 'sms' | 'push' | 'webhook';
  recipient: string;
  templateKey: string;
  providerMessageId: string | null;
  status: AdminCommunicationStatus;
  attemptCount: number;
  lastError: string | null;
  availableAt: string;
  sentAt: string | null;
  createdAt: string;
  eventType: string | null;
  appointmentId: string | null;
  referenceCode: string | null;
  customerName: string | null;
  serviceName: string | null;
  attempts: AdminCommunicationAttempt[];
}

export interface AdminCommunicationTemplate {
  id: string;
  templateKey: string;
  channel: 'email' | 'sms' | 'push' | 'webhook';
  displayName: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  bodyHtml: string | null;
  contentFormat: 'plain' | 'rich' | 'html' | 'image';
  sourceAssetName: string | null;
  isActive: boolean;
  version: number;
  updatedAt: string;
}

export interface AdminCommunicationsPayload {
  runtime: {
    mode: 'sandbox' | 'live';
    providers: { email: boolean; sms: boolean; webhook: boolean };
    maxAttempts: number;
  };
  summary: {
    total: number;
    ready: number;
    processing: number;
    sent: number;
    failed: number;
    suppressed: number;
  };
  deliveries: AdminCommunicationDelivery[];
}

export type AdminPaymentStatus =
  | 'requires_payment'
  | 'processing'
  | 'authorized'
  | 'succeeded'
  | 'failed'
  | 'partially_refunded'
  | 'refunded'
  | 'cancelled';

export type AdminPaymentActionName = 'capture' | 'void' | 'refund' | 'sync';

export interface AdminPaymentAction {
  id: string;
  action: AdminPaymentActionName;
  amountMinor: number;
  status: 'processing' | 'succeeded' | 'failed';
  reason: string | null;
  errorMessage: string | null;
  providerOperationId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface AdminPaymentRecord {
  id: string;
  appointmentId: string;
  referenceCode: string;
  customerName: string;
  customerEmail: string | null;
  serviceName: string;
  startsAt: string;
  appointmentStatus: string;
  provider: 'stripe' | 'demo';
  providerPaymentId: string;
  amountMinor: number;
  capturedAmountMinor: number;
  refundedAmountMinor: number;
  currency: string;
  status: AdminPaymentStatus;
  failureMessage: string | null;
  paymentMethodSummary: Record<string, unknown>;
  verifiedAt: string | null;
  lastProviderSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  actions: AdminPaymentAction[];
}

export interface AdminPaymentsPayload {
  runtime: {
    provider: 'stripe' | 'demo' | 'none';
    mode: 'live' | 'test' | 'demo' | 'unconfigured';
    configured: boolean;
    actionsEnabled: boolean;
    message: string;
  };
  summary: {
    currency: string;
    total: number;
    collectedCount: number;
    collectedMinor: number;
    authorizedCount: number;
    authorizedMinor: number;
    pendingCount: number;
    pendingMinor: number;
    refundedCount: number;
    refundedMinor: number;
    failedCount: number;
  };
  payments: AdminPaymentRecord[];
}

export interface AdminInsightDailyPoint {
  date: string;
  appointments: number;
  completed: number;
  cancelled: number;
  netCollectedMinor: number;
}

export interface AdminInsightService {
  id: string;
  name: string;
  appointments: number;
  completed: number;
  cancelled: number;
  uniqueCustomers: number;
  netCollectedMinor: number;
}

export interface AdminInsightHeatPoint {
  day: number;
  hour: number;
  appointments: number;
}

export interface AdminInsightsPayload {
  range: { days: number; startsAt: string; endsAt: string; timeZone: string };
  summary: {
    appointments: number;
    appointmentTrend: number | null;
    uniqueCustomers: number;
    customerTrend: number | null;
    newCustomers: number;
    returningCustomers: number;
    netCollectedMinor: number;
    collectedTrend: number | null;
    completedRate: number;
    cancelledRate: number;
    noShowRate: number;
    averageDurationMinutes: number;
    pendingApproval: number;
    currency: string;
  };
  daily: AdminInsightDailyPoint[];
  services: AdminInsightService[];
  heatmap: AdminInsightHeatPoint[];
  sources: Array<{ source: string; appointments: number }>;
}

export type AdminBusinessType =
  | 'consulting'
  | 'beauty'
  | 'wellness'
  | 'coaching'
  | 'education'
  | 'home_services'
  | 'repair'
  | 'other';

export type AdminServiceMode = 'business_location' | 'mobile' | 'virtual' | 'mixed';
export type AdminChangePolicy = 'instant' | 'customer_approval' | 'business_review';

export interface AdminBusinessSettings {
  organizationId: string;
  businessName: string;
  publicName: string;
  businessType: AdminBusinessType;
  serviceMode: AdminServiceMode;
  contactEmail: string;
  contactPhone: string;
  websiteUrl: string;
  timeZone: string;
  currency: string;
  bookingPageSlug: string;
  appointmentIncrementMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  confirmationMode: 'automatic' | 'manual';
  changePolicy: AdminChangePolicy;
  customerCancellationAllowed: boolean;
  customerReschedulingAllowed: boolean;
  cancellationNoticeMinutes: number;
  rescheduleNoticeMinutes: number;
  customerWelcomeMessage: string;
  confirmationMessage: string;
  cancellationPolicySummary: string;
  version: number;
  updatedAt: string;
}

export interface AdminSetupItem {
  id: 'profile' | 'services' | 'team' | 'availability' | 'widget' | 'messages' | 'payments';
  label: string;
  detail: string;
  complete: boolean;
  required: boolean;
  count?: number;
}

export interface AdminBusinessSettingsPayload {
  settings: AdminBusinessSettings;
  setup: { score: number; completed: number; total: number; launchReady: boolean; items: AdminSetupItem[] };
}

export type AdminLaunchDisplayMode = 'inline' | 'modal' | 'floating_button';

export interface AdminLaunchSettings {
  organizationId: string;
  publicBusinessId: string;
  embedEnabled: boolean;
  hostedPageEnabled: boolean;
  displayMode: AdminLaunchDisplayMode;
  buttonLabel: string;
  allowAnyDomain: boolean;
  allowedDomains: string[];
  loaderUrl: string;
  stylesheetUrl: string;
  hostedBaseUrl: string;
  apiBaseUrl: string;
  publishedAt: string | null;
  version: number;
  updatedAt: string;
}

export interface AdminLaunchReadinessCheck {
  id: 'services' | 'team' | 'availability' | 'widget';
  label: string;
  detail: string;
  complete: boolean;
}

export interface AdminLaunchInstallation {
  id: string;
  domain: string;
  status: 'pending' | 'verified' | 'attention';
  firstSeenAt: string;
  lastSeenAt: string;
  widgetVersion: string | null;
}

export interface AdminLaunchPayload {
  settings: AdminLaunchSettings;
  readiness: {
    ready: boolean;
    score: number;
    completed: number;
    total: number;
    checks: AdminLaunchReadinessCheck[];
  };
  snippets: { inline: string; modal: string; floatingButton: string };
  hosted: { enabled: boolean; url: string };
  installations: AdminLaunchInstallation[];
}

// 'demo' was removed deliberately: the studio no longer pretends an
// unreachable API is a working session-only workspace.
export type WorkspaceEnvironment = 'demo' | 'test' | 'live';

export interface AdminWorkspaceRuntime {
  environment: WorkspaceEnvironment;
  declared: boolean;
  notifications: { mode: 'sandbox' | 'live'; canReachRealPeople: boolean };
  payments: {
    provider: 'stripe' | 'demo' | 'none';
    mode: 'live' | 'test' | 'demo' | 'unconfigured';
    canChargeRealCards: boolean;
    demoIdentifiersAccepted: boolean;
  };
  summary: string;
}

export interface AdminTemplateTestResult {
  queued: boolean;
  recipient: string;
  mode: 'sandbox' | 'live';
  rendered: { subject: string | null; body: string; html: string | null };
}

export interface AdminDuplicateMember {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  appointmentCount: number;
  createdAt: string;
}

export interface AdminDuplicateGroup {
  matchKind: 'email' | 'phone';
  matchValue: string;
  members: AdminDuplicateMember[];
}

export interface AdminNavigationCounts {
  pendingRequests: number;
  failedMessages: number;
}

export interface AdminSessionResponse {
  user: { id: string; email: string; organizationId: string; role: string };
  workspace: AdminWorkspaceRuntime;
}

export type AdminPersistenceMode = 'loading' | 'connected' | 'saving' | 'error';

export interface AdminPersistenceState {
  mode: AdminPersistenceMode;
  label: string;
}

interface AdminApiConfiguration {
  baseUrl?: string;
  token?: string;
}

// window.CHIME_ADMIN_CONFIG is declared once, in adminConnection.ts.

export type CustomerLifecycleStatus = 'active' | 'vip' | 'watchlist' | 'blocked' | 'archived';

export type AdminAvailabilityBlock = {
  id: string;
  start: string;
  end: string;
};

export type AdminAvailabilityDay = {
  dayOfWeek: number;
  key: string;
  label: string;
  blocks: AdminAvailabilityBlock[];
};

export type AdminAvailabilitySchedule = {
  staffId: string;
  displayName: string;
  color: string;
  timeZone: string;
  version: number;
  days: AdminAvailabilityDay[];
};

export type CustomerTag = {
  id: string;
  name: string;
  color: string;
  customerCount: number;
};

export type CustomerDirectoryEntry = {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  timeZone: string;
  marketingConsent: boolean;
  lifecycleStatus: CustomerLifecycleStatus;
  preferredChannel: 'email' | 'sms' | 'none';
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  locale: string;
  metadata: Record<string, unknown>;
  version: number;
  tags: CustomerTag[];
  appointmentCount: number;
  upcomingAppointmentCount: number;
  completedAppointmentCount: number;
  nextAppointmentAt: string | null;
  lastAppointmentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CustomerAppointment = {
  id: string;
  referenceCode: string;
  startsAt: string;
  endsAt: string;
  status: string;
  source: string;
  customerNotes: string | null;
  internalNotes: string | null;
  version: number;
  serviceName: string;
  locationName: string | null;
  staff: Array<{ id: string; displayName: string; color: string }>;
};

export type CustomerNote = {
  id: string;
  body: string;
  isPinned: boolean;
  createdByRole: string;
  createdAt: string;
  updatedAt: string;
};

export type CustomerCommunication = {
  id: string;
  channel: 'email' | 'sms' | 'webhook';
  recipient: string;
  templateKey: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type CustomerChangeRequest = {
  id: string;
  appointmentId: string;
  referenceCode: string;
  status: string;
  reason: string | null;
  proposedChanges: Record<string, unknown>;
  createdAt: string;
  resolvedAt: string | null;
};

export type CustomerProfileResponse = {
  customer: CustomerDirectoryEntry;
  appointments: CustomerAppointment[];
  notes: CustomerNote[];
  communications: CustomerCommunication[];
  changeRequests: CustomerChangeRequest[];
};

export type CustomerUpdateInput = {
  displayName: string;
  email?: string | null;
  phone?: string | null;
  lifecycleStatus?: CustomerLifecycleStatus;
  preferredChannel?: 'email' | 'sms' | 'none';
  emailNotificationsEnabled?: boolean;
  smsNotificationsEnabled?: boolean;
  marketingConsent?: boolean;
  timeZone?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
};

export type AdminWidgetLogoVariant = 'wordmark' | 'wordmark-smile' | 'bell' | 'custom' | 'none';
export type AdminWidgetCardStyle = 'soft' | 'outline' | 'solid';
export type AdminWidgetCornerStyle = 'soft' | 'rounded' | 'pill';
export type AdminWidgetFontStyle = 'modern' | 'friendly' | 'classic';

export interface AdminWidgetTheme {
  primaryColor: string;
  accentColor: string;
  surfaceColor: string;
  textColor: string;
  logoVariant: AdminWidgetLogoVariant;
  customLogoUrl?: string;
  cardStyle: AdminWidgetCardStyle;
  cornerStyle: AdminWidgetCornerStyle;
  fontStyle: AdminWidgetFontStyle;
  showPoweredBy: boolean;
}

export interface AdminWidgetCopy {
  businessName: string;
  headerTitle: string;
  eyebrow: string;
  description: string;
  confirmationMessage: string;
}

export interface AdminWidgetConfig {
  id: string | null;
  organizationSlug: string;
  slug: string;
  theme: AdminWidgetTheme;
  copy: AdminWidgetCopy;
  locale: string;
  timeZone: string;
  isActive: boolean;
  version: number;
}

export class AdminApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'AdminApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function servicePayload(service: AdminServiceDefinition) {
  const { id: _id, organizationId: _organizationId, version: _version, ...input } = service;
  return input;
}

function staffPayload(staff: AdminStaffMember) {
  const { id: _id, version: _version, ...input } = staff;
  return input;
}

function requestKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `chime-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class AdminApiClient {
  getAvailabilitySchedules(): Promise<{ schedules: AdminAvailabilitySchedule[] }> {
    return this.request<{ schedules: AdminAvailabilitySchedule[] }>('/availability/schedules');
  }

  saveAvailabilitySchedule(
    staffId: string,
    version: number,
    days: Array<{ dayOfWeek: number; blocks: AdminAvailabilityBlock[] }>,
  ): Promise<{ schedule: AdminAvailabilitySchedule }> {
    return this.request<{ schedule: AdminAvailabilitySchedule }>(`/availability/schedules/${staffId}`, {
      method: 'PUT',
      headers: { 'if-match': String(version) },
      body: JSON.stringify({ days }),
    });
  }

  getWidgetConfig(): Promise<{ config: AdminWidgetConfig }> {
    return this.request<{ config: AdminWidgetConfig }>('/widget-config');
  }

  saveWidgetConfig(config: AdminWidgetConfig): Promise<{ config: AdminWidgetConfig }> {
    return this.request<{ config: AdminWidgetConfig }>('/widget-config', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestKey(),
        'If-Match': `"${config.version}"`,
      },
      body: JSON.stringify(config),
    });
  }

  getCustomers(filters: { search?: string; status?: string; tagId?: string } = {}): Promise<{ customers: CustomerDirectoryEntry[] }> {
    const parameters = new URLSearchParams();
    if (filters.search) parameters.set('search', filters.search);
    if (filters.status) parameters.set('status', filters.status);
    if (filters.tagId) parameters.set('tagId', filters.tagId);
    const query = parameters.toString();
    return this.request<{ customers: CustomerDirectoryEntry[] }>(`/customers${query ? `?${query}` : ''}`);
  }

  getCustomer(customerId: string): Promise<CustomerProfileResponse> {
    return this.request<CustomerProfileResponse>(`/customers/${customerId}`);
  }

  createCustomer(input: { displayName: string; email?: string; phone?: string }): Promise<{ customer: CustomerDirectoryEntry }> {
    return this.request<{ customer: CustomerDirectoryEntry }>('/customers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  updateCustomer(customerId: string, version: number, input: CustomerUpdateInput): Promise<{ customer: CustomerDirectoryEntry }> {
    return this.request<{ customer: CustomerDirectoryEntry }>(`/customers/${customerId}`, {
      method: 'PUT',
      headers: { 'if-match': String(version) },
      body: JSON.stringify(input),
    });
  }

  getCustomerTags(): Promise<{ tags: CustomerTag[] }> {
    return this.request<{ tags: CustomerTag[] }>('/customers/tags');
  }

  createCustomerTag(input: { name: string; color: string }): Promise<{ tag: CustomerTag }> {
    return this.request<{ tag: CustomerTag }>('/customers/tags', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  setCustomerTags(customerId: string, tagIds: string[]): Promise<{ tags: CustomerTag[] }> {
    return this.request<{ tags: CustomerTag[] }>(`/customers/${customerId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds }),
    });
  }

  addCustomerNote(customerId: string, input: { body: string; isPinned?: boolean }): Promise<{ note: CustomerNote }> {
    return this.request<{ note: CustomerNote }>(`/customers/${customerId}/notes`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  deleteCustomerNote(customerId: string, noteId: string): Promise<void> {
    return this.request<void>(`/customers/${customerId}/notes/${noteId}`, { method: 'DELETE' });
  }

  readonly configured: boolean;
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(configuration: AdminApiConfiguration) {
    this.baseUrl = configuration.baseUrl ? normalizeBaseUrl(configuration.baseUrl) : '';
    this.token = configuration.token ?? '';
    this.configured = Boolean(this.baseUrl && this.token);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.configured) {
      throw new AdminApiClientError(
        0,
        describeMissingConnection() ?? 'The durable admin API is not configured.',
        'API_NOT_CONFIGURED',
      );
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        'X-Request-Id': requestKey(),
        // Defaulted here rather than left to each caller. Without it
        // express.json does not parse the body, the server sees an empty
        // request, and the failure surfaces as a 500 far from its cause.
        // Six calls were missing it: creating a customer note, creating and
        // updating a customer, creating a tag, assigning tags, and saving an
        // availability schedule. A caller may still override it.
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });

    const body = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    if (!response.ok) {
      // An expired or revoked session should return the administrator to the
      // login screen, not leave every workspace reporting its own failure.
      if (response.status === 401) {
        clearSession();
        notifySessionEnded();
      }
      throw new AdminApiClientError(
        response.status,
        body?.error?.message ?? `Administrator request failed with ${response.status}.`,
        body?.error?.code,
        body?.error?.details,
      );
    }
    return body as unknown as T;
  }

  async listServices(): Promise<AdminServiceDefinition[]> {
    const body = await this.request<{ services: AdminServiceDefinition[] }>('/services');
    return body.services;
  }

  async saveService(service: AdminServiceDefinition): Promise<AdminServiceDefinition> {
    const isDraft = service.id.startsWith('draft-');
    const body = await this.request<{ service: AdminServiceDefinition }>(
      isDraft ? '/services' : `/services/${encodeURIComponent(service.id)}`,
      {
        method: isDraft ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestKey(),
          ...(isDraft ? {} : { 'If-Match': `"${service.version}"` }),
        },
        body: JSON.stringify(stripDemoRelationshipIds(servicePayload(service))),
      },
    );
    return body.service;
  }

  async archiveService(service: AdminServiceDefinition): Promise<AdminServiceDefinition> {
    const body = await this.request<{ service: AdminServiceDefinition }>(
      `/services/${encodeURIComponent(service.id)}`,
      {
        method: 'DELETE',
        headers: {
          'Idempotency-Key': requestKey(),
          'If-Match': `"${service.version}"`,
        },
      },
    );
    return body.service;
  }

  async listStaff(includeInactive = true): Promise<AdminStaffMember[]> {
    const suffix = includeInactive ? '?includeInactive=true' : '';
    const body = await this.request<{ staff: AdminStaffMember[] }>(`/staff${suffix}`);
    return body.staff;
  }

  async listLocations(): Promise<AdminLocation[]> {
    const body = await this.request<{ locations: AdminLocation[] }>('/locations');
    return body.locations;
  }

  async saveStaff(staff: AdminStaffMember): Promise<AdminStaffMember> {
    const isDraft = staff.id.startsWith('draft-team-');
    const body = await this.request<{ staff: AdminStaffMember }>(
      isDraft ? '/staff' : `/staff/${encodeURIComponent(staff.id)}`,
      {
        method: isDraft ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestKey(),
          ...(isDraft ? {} : { 'If-Match': `"${staff.version}"` }),
        },
        body: JSON.stringify(staffPayload(staff)),
      },
    );
    return body.staff;
  }

  async previewAvailability(horizonDays = 30): Promise<AdminAvailabilitySummary> {
    const body = await this.request<{ summary: AdminAvailabilitySummary }>('/availability/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ horizonDays }),
    });
    return body.summary;
  }

  async publishAvailability(horizonDays = 30): Promise<AdminAvailabilitySummary> {
    const body = await this.request<{ summary: AdminAvailabilitySummary }>('/availability/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestKey(),
      },
      body: JSON.stringify({ horizonDays }),
    });
    return body.summary;
  }

  async listAvailabilityExceptions(staffId: string): Promise<AdminAvailabilityException[]> {
    const body = await this.request<{ exceptions: AdminAvailabilityException[] }>(
      `/staff/${encodeURIComponent(staffId)}/exceptions`,
    );
    return body.exceptions;
  }

  async createAvailabilityException(
    staffId: string,
    input: { startDate: string; endDate: string; reason: string },
  ): Promise<AdminAvailabilityException> {
    const body = await this.request<{ exception: AdminAvailabilityException }>(
      `/staff/${encodeURIComponent(staffId)}/exceptions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestKey(),
        },
        body: JSON.stringify(input),
      },
    );
    return body.exception;
  }

  async deleteAvailabilityException(staffId: string, exceptionId: string): Promise<void> {
    await this.request<void>(
      `/staff/${encodeURIComponent(staffId)}/exceptions/${encodeURIComponent(exceptionId)}`,
      {
        method: 'DELETE',
        headers: { 'Idempotency-Key': requestKey() },
      },
    );
  }

  async listCommunications(status = 'all'): Promise<AdminCommunicationsPayload> {
    return this.request<AdminCommunicationsPayload>(
      `/communications?status=${encodeURIComponent(status)}`,
    );
  }

  async processCommunications(): Promise<{ result: { claimed: number; sent: number; failed: number; mode: 'sandbox' | 'live' } }> {
    return this.request('/communications/process', { method: 'POST' });
  }

  async retryCommunication(deliveryId: string): Promise<void> {
    await this.request(`/communications/${encodeURIComponent(deliveryId)}/retry`, { method: 'POST' });
  }

  async suppressCommunication(deliveryId: string): Promise<void> {
    await this.request(`/communications/${encodeURIComponent(deliveryId)}/suppress`, { method: 'POST' });
  }

  async listCommunicationTemplates(): Promise<AdminCommunicationTemplate[]> {
    const body = await this.request<{ templates: AdminCommunicationTemplate[] }>('/communications/templates');
    return body.templates;
  }

  async saveCommunicationTemplate(
    template: AdminCommunicationTemplate,
  ): Promise<AdminCommunicationTemplate> {
    const body = await this.request<{ template: AdminCommunicationTemplate }>(
      `/communications/templates/${encodeURIComponent(template.templateKey)}/${encodeURIComponent(template.channel)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': `"${template.version}"`,
        },
        body: JSON.stringify({
          displayName: template.displayName,
          subjectTemplate: template.subjectTemplate,
          bodyTemplate: template.bodyTemplate,
          isActive: template.isActive,
        }),
      },
    );
    return body.template;
  }

  async listPayments(status = 'all'): Promise<AdminPaymentsPayload> {
    return this.request<AdminPaymentsPayload>(`/payments?status=${encodeURIComponent(status)}`);
  }

  async performPaymentAction(
    payment: AdminPaymentRecord,
    action: AdminPaymentActionName,
    input: { amountMinor?: number; reason?: string } = {},
  ): Promise<{ payment: AdminPaymentRecord; action: AdminPaymentAction; replayed?: boolean }> {
    return this.request(`/payments/${encodeURIComponent(payment.id)}/actions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestKey(),
        'If-Match': `"${payment.version}"`,
      },
      body: JSON.stringify({ action, ...input }),
    });
  }

  async getInsights(days = 30): Promise<AdminInsightsPayload> {
    return this.request<AdminInsightsPayload>(`/insights?days=${encodeURIComponent(days)}`);
  }

  async getBusinessSettings(): Promise<AdminBusinessSettingsPayload> {
    return this.request<AdminBusinessSettingsPayload>('/business-settings');
  }

  async saveBusinessSettings(settings: AdminBusinessSettings): Promise<AdminBusinessSettingsPayload> {
    return this.request<AdminBusinessSettingsPayload>('/business-settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestKey(),
        'If-Match': `"${settings.version}"`,
      },
      body: JSON.stringify(settings),
    });
  }

  sendTemplateTest(templateKey: string, channel: string): Promise<AdminTemplateTestResult> {
    return this.request<AdminTemplateTestResult>(
      `/communications/templates/${encodeURIComponent(templateKey)}/${encodeURIComponent(channel)}/test`,
      { method: 'POST', headers: { 'Idempotency-Key': requestKey() } },
    );
  }

  getCustomerDuplicates(): Promise<{ groups: AdminDuplicateGroup[] }> {
    return this.request<{ groups: AdminDuplicateGroup[] }>('/customers/duplicates');
  }

  mergeCustomer(keepId: string, duplicateId: string): Promise<{ merged: Record<string, unknown> }> {
    return this.request<{ merged: Record<string, unknown> }>(`/customers/${keepId}/merge`, {
      method: 'POST',
      headers: { 'Idempotency-Key': requestKey() },
      body: JSON.stringify({ duplicateId }),
    });
  }

  getNavigationCounts(): Promise<AdminNavigationCounts> {
    return this.request<AdminNavigationCounts>('/navigation/counts');
  }

  getSession(): Promise<AdminSessionResponse> {
    return this.request<AdminSessionResponse>('/me');
  }

  async getLaunchSettings(): Promise<AdminLaunchPayload> {
    return this.request<AdminLaunchPayload>('/launch');
  }

  async saveLaunchSettings(settings: AdminLaunchSettings): Promise<AdminLaunchPayload> {
    return this.request<AdminLaunchPayload>('/launch', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': requestKey(),
        'If-Match': `"${settings.version}"`,
      },
      body: JSON.stringify(settings),
    });
  }
}

/**
 * Builds a client for the current connection.
 *
 * `token` may be passed explicitly. Resolution reads sessionStorage, which is
 * invisible to React's dependency analysis, so a caller that rebuilds the
 * client when the session changes can pass the token and have that dependency
 * be a real one rather than a suppressed warning.
 */
export function createAdminApiClient(token?: string): AdminApiClient {
  const connection = resolveAdminConnection();
  return new AdminApiClient({
    baseUrl: connection?.baseUrl ?? resolveAdminBaseUrl(),
    token: token ?? connection?.token,
  });
}
