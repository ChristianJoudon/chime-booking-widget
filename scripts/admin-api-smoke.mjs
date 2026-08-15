import assert from 'node:assert/strict';

const apiBaseUrl = (process.env.CHIME_ADMIN_API_BASE_URL ?? 'http://127.0.0.1:8788/api/chime/admin')
  .replace(/\/$/, '');
const ownerToken = process.env.CHIME_ADMIN_OWNER_TOKEN;
const viewerToken = process.env.CHIME_ADMIN_VIEWER_TOKEN;

assert(ownerToken, 'CHIME_ADMIN_OWNER_TOKEN is required.');
assert(viewerToken, 'CHIME_ADMIN_VIEWER_TOKEN is required.');

async function request(path, { token = ownerToken, expected, ...options } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);

  if (expected !== undefined) {
    assert.equal(response.status, expected, `${options.method ?? 'GET'} ${path}: ${JSON.stringify(body)}`);
  } else {
    assert(response.ok, `${options.method ?? 'GET'} ${path}: ${response.status} ${JSON.stringify(body)}`);
  }

  return { body, response };
}

const me = await request('/me');
const staffResult = await request('/staff');
const locationResult = await request('/locations');
const serviceResult = await request('/services');
const staff = staffResult.body.staff;
const locations = locationResult.body.locations;

assert.match(me.body.user.id, /^[0-9a-f-]{36}$/i);
assert(staff.length > 0, 'The tenant must expose at least one active staff member.');
assert(locations.length > 0, 'The tenant must expose at least one active location.');
assert(Array.isArray(serviceResult.body.services), 'The services response must contain an array.');

const nonce = Date.now();
const serviceInput = {
  name: `Smoke service ${nonce}`,
  slug: `smoke-service-${nonce}`,
  shortDescription: 'Temporary service created by the connected admin smoke test.',
  category: 'Smoke tests',
  tone: 'mint',
  glyph: 'bolt',
  duration: {
    defaultMinutes: 30,
    minimumMinutes: 15,
    maximumMinutes: 60,
    incrementMinutes: 15,
  },
  buffers: {
    beforeMinutes: 0,
    afterMinutes: 5,
  },
  bookingWindow: {
    minimumNoticeMinutes: 60,
    maximumAdvanceDays: 30,
  },
  priceMinor: 5000,
  currency: 'USD',
  deposit: {
    mode: 'none',
    refundable: true,
  },
  confirmationMode: 'automatic',
  changeApprovalMode: 'business',
  capacity: 1,
  staffIds: [staff[0].id],
  locationIds: [locations[0].id],
  resourceIds: [],
  customQuestions: [],
  isActive: true,
  isPublic: false,
};
const createKey = `admin-smoke-create-${nonce}`;
const createdResult = await request('/services', {
  body: JSON.stringify(serviceInput),
  headers: { 'Idempotency-Key': createKey },
  method: 'POST',
});
const created = createdResult.body.service ?? createdResult.body;

assert.match(created.id, /^[0-9a-f-]{36}$/i);
assert.equal(created.version, 1);
assert.deepEqual(created.staffIds, [staff[0].id]);
assert.deepEqual(created.locationIds, [locations[0].id]);

const replayResult = await request('/services', {
  body: JSON.stringify(serviceInput),
  headers: { 'Idempotency-Key': createKey },
  method: 'POST',
});
const replayed = replayResult.body.service ?? replayResult.body;
assert.equal(replayed.id, created.id, 'Idempotent replay must return the original service.');

await request('/services', {
  body: JSON.stringify(serviceInput),
  expected: 403,
  headers: { 'Idempotency-Key': `admin-smoke-viewer-${nonce}` },
  method: 'POST',
  token: viewerToken,
});

const updatedResult = await request(`/services/${created.id}`, {
  body: JSON.stringify({ ...serviceInput, name: `${serviceInput.name} updated` }),
  headers: {
    'Idempotency-Key': `admin-smoke-update-${nonce}`,
    'If-Match': String(created.version),
  },
  method: 'PUT',
});
const updated = updatedResult.body.service ?? updatedResult.body;
assert.equal(updated.version, created.version + 1);

await request(`/services/${created.id}`, {
  body: JSON.stringify(serviceInput),
  expected: 409,
  headers: {
    'Idempotency-Key': `admin-smoke-stale-${nonce}`,
    'If-Match': String(created.version),
  },
  method: 'PUT',
});

await request(`/services/${created.id}`, {
  headers: {
    'Idempotency-Key': `admin-smoke-archive-${nonce}`,
    'If-Match': String(updated.version),
  },
  method: 'DELETE',
});

const archivedList = await request('/services');
const archived = archivedList.body.services.find((service) => service.id === created.id);
assert(archived, 'Archived services must remain visible to administrators.');
assert.equal(archived.isActive, false, 'Archived services must be inactive.');

console.log(JSON.stringify({
  checks: [
    'authenticated tenant identity',
    'staff directory',
    'location directory',
    'service list',
    'service create',
    'idempotent replay',
    'viewer write denial',
    'optimistic update',
    'stale version rejection',
    'archive removal',
  ],
  createdServiceId: created.id,
  locationCount: locations.length,
  staffCount: staff.length,
}, null, 2));
