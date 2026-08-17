/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useState } from 'react';
import { getAdminConnection, describeMissingConnection } from './adminConnection';

/**
 * Shaped for the studio's team picker. Previously this type was derived from the
 * sample schedule, which meant the directory could not exist without demo data
 * and quietly rendered demo staff whenever the connection failed.
 */
export interface StudioStaff {
  id: string;
  name: string;
  shortName: string;
  initials: string;
  color: string;
}

const STAFF_COLORS = ['#348469', '#477aab', '#bf5734', '#806ab2', '#9b6d39'];

interface DirectoryStaffResponse {
  staff: Array<{
    id: string;
    displayName: string;
    email: string | null;
    color: string | null;
    isActive: boolean;
  }>;
}

interface DirectoryLocation {
  id: string;
  name: string;
  slug: string;
  timeZone: string;
  isActive: boolean;
}

interface DirectoryLocationResponse {
  locations: DirectoryLocation[];
}

interface StudioDirectory {
  staff: StudioStaff[];
  locations: DirectoryLocation[];
  /**
   * 'unconfigured' means no Chime connection exists at all; 'error' means one
   * exists but the request failed. Neither ever carries invented staff.
   */
  state: 'loading' | 'connected' | 'unconfigured' | 'error';
  /** Plain-language reason, present for 'unconfigured' and 'error'. */
  message: string | null;
}

interface AssignableService {
  locationIds: readonly string[];
}

interface ServiceLocationPickerProps {
  service: AssignableService;
  onChange: (locationIds: string[]) => void;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let cachedDirectory: StudioDirectory | null = null;
let directoryRequest: Promise<StudioDirectory> | null = null;

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

async function requestDirectory(): Promise<StudioDirectory> {
  const connection = getAdminConnection();
  if (!connection) {
    return {
      staff: [],
      locations: [],
      state: 'unconfigured',
      message: describeMissingConnection(),
    };
  }

  const headers = { Authorization: `Bearer ${connection.token}` };
  const [staffResponse, locationResponse] = await Promise.all([
    fetch(endpoint(connection.baseUrl, '/staff'), { headers }),
    fetch(endpoint(connection.baseUrl, '/locations'), { headers }),
  ]);

  if (!staffResponse.ok || !locationResponse.ok) {
    const failed = !staffResponse.ok ? staffResponse : locationResponse;
    const body = await failed.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(
      body?.error?.message
        ?? `The business directory could not be loaded (${failed.status}).`,
    );
  }

  const staffBody = await staffResponse.json() as DirectoryStaffResponse;
  const locationBody = await locationResponse.json() as DirectoryLocationResponse;
  const staff: StudioStaff[] = staffBody.staff.map((entry, index) => ({
    id: entry.id,
    name: entry.displayName,
    shortName: entry.displayName.split(/\s+/)[0] ?? entry.displayName,
    initials: initialsFor(entry.displayName),
    color: entry.color ?? STAFF_COLORS[index % STAFF_COLORS.length],
  }));

  return {
    staff,
    locations: locationBody.locations,
    state: 'connected',
    message: null,
  };
}

function loadDirectory(): Promise<StudioDirectory> {
  if (cachedDirectory) {
    return Promise.resolve(cachedDirectory);
  }

  if (!directoryRequest) {
    directoryRequest = requestDirectory()
      .then((directory) => {
        cachedDirectory = directory;
        return directory;
      })
      .catch((error: unknown) => {
        // An authenticated screen that cannot reach Chime says so. It does not
        // invent a team.
        const failure: StudioDirectory = {
          staff: [],
          locations: [],
          state: 'error',
          message: error instanceof Error
            ? error.message
            : 'The business directory could not be loaded.',
        };
        cachedDirectory = failure;
        return failure;
      });
  }

  return directoryRequest;
}

/** Drops the cache so a Retry action re-requests instead of replaying a failure. */
export function refreshServiceStudioDirectory(): void {
  cachedDirectory = null;
  directoryRequest = null;
}

export function useServiceStudioDirectory(): StudioDirectory {
  const [directory, setDirectory] = useState<StudioDirectory>(() => cachedDirectory ?? {
    staff: [],
    locations: [],
    state: getAdminConnection() ? 'loading' : 'unconfigured',
    message: getAdminConnection() ? null : describeMissingConnection(),
  });

  useEffect(() => {
    let active = true;

    void loadDirectory().then((nextDirectory) => {
      if (active) {
        setDirectory(nextDirectory);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  return directory;
}

export function ServiceLocationPicker({ service, onChange }: ServiceLocationPickerProps) {
  const directory = useServiceStudioDirectory();
  const selectedIds = useMemo(
    () => service.locationIds.filter((id) => UUID_PATTERN.test(id)),
    [service.locationIds],
  );

  useEffect(() => {
    if (directory.state === 'connected' && selectedIds.length === 0 && directory.locations[0]) {
      onChange([directory.locations[0].id]);
    }
  }, [directory.locations, directory.state, onChange, selectedIds.length]);

  if (directory.state === 'loading') {
    return <p role="status">Loading business locations...</p>;
  }

  if (directory.state === 'unconfigured' || directory.state === 'error') {
    return (
      <p role="alert" className="service-location-assignment__problem">
        {directory.message ?? 'Locations could not be loaded.'}
        {' '}Existing assignments are preserved.
      </p>
    );
  }

  if (directory.locations.length === 0) {
    return <p role="status">No locations have been added yet. Add one in Team to assign it here.</p>;
  }

  return (
    <div className="service-location-assignment">
      <strong>Locations</strong>
      <div className="service-team-picker service-location-picker">
        {directory.locations.map((location) => {
          const selected = selectedIds.includes(location.id);

          return (
            <button
              aria-pressed={selected}
              className={selected ? 'is-active' : ''}
              key={location.id}
              onClick={() => {
                onChange(selected
                  ? selectedIds.filter((id) => id !== location.id)
                  : [...selectedIds, location.id]);
              }}
              type="button"
            >
              <i>{initialsFor(location.name)}</i>
              <span>
                <strong>{location.name}</strong>
                <small>{selected ? 'Assigned' : location.timeZone}</small>
              </span>
              <b>{selected ? 'On' : ''}</b>
            </button>
          );
        })}
      </div>
    </div>
  );
}
