/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useState } from 'react';
import { SCHEDULE_STAFF as DEMO_STAFF } from './sampleSchedule';

type StudioStaff = (typeof DEMO_STAFF)[number];

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
  state: 'demo' | 'loading' | 'connected' | 'error';
}

interface RuntimeAdminConfig {
  apiBaseUrl?: string;
  apiUrl?: string;
  accessToken?: string;
  sessionToken?: string;
  token?: string;
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

function runtimeConfig(): { apiBaseUrl: string; token: string } | null {
  const runtime = (window as typeof window & { CHIME_ADMIN_CONFIG?: RuntimeAdminConfig })
    .CHIME_ADMIN_CONFIG;
  const apiBaseUrl = (
    runtime?.apiBaseUrl
    ?? runtime?.apiUrl
    ?? import.meta.env.VITE_CHIME_ADMIN_API_BASE_URL
    ?? import.meta.env.VITE_CHIME_ADMIN_API_URL
    ?? ''
  ).replace(/\/$/, '');
  const token = runtime?.accessToken
    ?? runtime?.sessionToken
    ?? runtime?.token
    ?? import.meta.env.VITE_CHIME_ADMIN_ACCESS_TOKEN
    ?? import.meta.env.VITE_CHIME_ADMIN_SESSION_TOKEN
    ?? '';

  if (!apiBaseUrl || !token) {
    return null;
  }

  return { apiBaseUrl, token };
}

function endpoint(baseUrl: string, path: string): string {
  if (/\/api\/chime\/admin$/i.test(baseUrl)) {
    return `${baseUrl}${path}`;
  }

  return `${baseUrl}/api/chime/admin${path}`;
}

async function requestDirectory(): Promise<StudioDirectory> {
  const config = runtimeConfig();

  if (!config) {
    return { staff: [...DEMO_STAFF], locations: [], state: 'demo' };
  }

  const headers = { Authorization: `Bearer ${config.token}` };
  const [staffResponse, locationResponse] = await Promise.all([
    fetch(endpoint(config.apiBaseUrl, '/staff'), { headers }),
    fetch(endpoint(config.apiBaseUrl, '/locations'), { headers }),
  ]);

  if (!staffResponse.ok || !locationResponse.ok) {
    throw new Error('The tenant directory could not be loaded.');
  }

  const staffBody = await staffResponse.json() as DirectoryStaffResponse;
  const locationBody = await locationResponse.json() as DirectoryLocationResponse;
  const staff = staffBody.staff.map((entry, index) => {
    const template = DEMO_STAFF[index % Math.max(DEMO_STAFF.length, 1)];

    return Object.assign({}, template, {
      id: entry.id,
      name: entry.displayName,
      initials: initialsFor(entry.displayName),
      color: entry.color ?? template?.color ?? '#52796f',
    }) as StudioStaff;
  });

  return {
    staff,
    locations: locationBody.locations,
    state: 'connected',
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
      .catch(() => {
        const fallback: StudioDirectory = {
          staff: [...DEMO_STAFF],
          locations: [],
          state: 'error',
        };
        cachedDirectory = fallback;
        return fallback;
      });
  }

  return directoryRequest;
}

export function useServiceStudioDirectory(): StudioDirectory {
  const [directory, setDirectory] = useState<StudioDirectory>(() => cachedDirectory ?? {
    staff: [...DEMO_STAFF],
    locations: [],
    state: runtimeConfig() ? 'loading' : 'demo',
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

  if (directory.state === 'demo') {
    return null;
  }

  if (directory.state === 'loading') {
    return <p role="status">Loading business locations...</p>;
  }

  if (directory.state === 'error') {
    return <p role="alert">Locations are temporarily unavailable. Existing assignments are preserved.</p>;
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
