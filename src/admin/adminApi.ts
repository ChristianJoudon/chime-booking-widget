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

import type { AdminServiceDefinition } from './sampleAdminServices';

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

export type AdminPersistenceMode = 'demo' | 'loading' | 'connected' | 'saving' | 'error';

export interface AdminPersistenceState {
  mode: AdminPersistenceMode;
  label: string;
}

interface AdminApiConfiguration {
  baseUrl?: string;
  token?: string;
}

declare global {
  interface Window {
    CHIME_ADMIN_CONFIG?: AdminApiConfiguration;
  }
}

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
    this.baseUrl = (configuration.baseUrl ?? '').replace(/\/$/, '');
    this.token = configuration.token ?? '';
    this.configured = Boolean(this.baseUrl && this.token);
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!this.configured) {
      throw new AdminApiClientError(0, 'The durable admin API is not configured.', 'API_NOT_CONFIGURED');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token}`,
        'X-Request-Id': requestKey(),
        ...options.headers,
      },
    });

    const body = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string; details?: unknown };
    } | null;
    if (!response.ok) {
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
}

export function createAdminApiClient(): AdminApiClient {
  return new AdminApiClient({
    baseUrl: window.CHIME_ADMIN_CONFIG?.baseUrl
      ?? import.meta.env.VITE_CHIME_ADMIN_API_URL,
    token: window.CHIME_ADMIN_CONFIG?.token
      ?? import.meta.env.VITE_CHIME_ADMIN_TOKEN,
  });
}
