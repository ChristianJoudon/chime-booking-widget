# Chime widget integration

Chime now runs as a step-by-step booking flow:

1. Choose a service
2. Open the full calendar and choose a date/time
3. Read the terms document to the bottom and accept it
4. Enter customer details (full name and email required)
5. Pay the refundable deposit when Stripe is configured; otherwise the request is submitted without an online deposit
6. See the confirmation page

The widget supports two ways to provide real data:

1. Inline config from your website using `window.CHIME_WIDGET_CONFIG`
2. API endpoints for services, availability, booking submission, and Stripe payment intents

For a real database-backed calendar, apply the SQL in `database/postgres-schema.sql` and use the example API in `server/`, or implement equivalent routes in your existing backend.

## Mount target

Add this container where the widget should render:

```html
<div id="chime-widget-root"></div>
```

## Embedding on any website

Build the standalone embed bundle:

```bash
npm run build:embed
```

This produces two files in `dist-embed/`:

- `chime-widget.css` — all widget styles
- `chime-widget.js` — a single-file IIFE bundle (React included, no other dependencies)

Host them anywhere and add them to the page, along with a mount target and optional config:

```html
<div id="chime-widget-root"></div>

<script>
  window.CHIME_WIDGET_CONFIG = {
    businessName: 'Acme Repair Co.',
    location: '123 Main St, Honolulu, HI',
    payment: { demoMode: true },
    services: [/* ... */],
    availability: [/* ... */]
  };
</script>

<link rel="stylesheet" href="https://yourcdn.example.com/chime-widget.css" />
<script src="https://yourcdn.example.com/chime-widget.js" defer></script>
```

See `embed-demo.html` at the project root for a complete working host page.

### Auto-mount targets

When the script loads, it automatically mounts the widget into every element matching
`#chime-widget-root` or `[data-chime-widget]` that has not already been mounted
(mounted elements are marked with `data-chime-mounted`).

### `window.CHIME_WIDGET_CONFIG` contract

Set `window.CHIME_WIDGET_CONFIG` before the widget bundle loads. All keys are optional; the
full shape is `WidgetConfigInput` in `src/types/widget.ts`. Notable keys:

- `businessName`, `headerTitle`, `description` — branding text.
- `location` — business address, used for add-to-calendar links on the confirmation page.
- `services`, `availability` — inline data (see the inline-data option below).
- `api` — endpoint URLs for services, availability, bookings, and payment intents.
- `payment.required` — the refundable deposit must be paid online before the booking is
  saved (defaults to `true`).
- `payment.demoMode` — force the simulated test-mode card form, for demos and embeds
  without Stripe.
- `payment.stripePublishableKey`, `payment.currency` — Stripe configuration.
- `customerFields`, `termsTitle`, `termsText`, `confirmationMessage` — form and copy overrides.

### Manual mount API

The bundle exposes `window.ChimeWidget` for programmatic control:

```js
// Mount into a selector or element; config is optional and, when provided,
// is assigned to window.CHIME_WIDGET_CONFIG before rendering.
const handle = window.ChimeWidget.mount('#my-booking-container', {
  businessName: 'Acme Repair Co.'
});

// Later:
handle.unmount();

// Or mount every default target that is not mounted yet:
const mountedCount = window.ChimeWidget.autoMount();
```

`mount` throws an `Error` if the selector does not match any element.

### Isolation guarantees

- Every style is scoped under the widget root class `.chime-widget` — nothing styles the
  host page, and the bundle ships no global resets (no Tailwind preflight).
- The widget carries its own scoped reset and typography, so host-page styles like serif
  fonts or button themes do not bleed in.
- The decorative background is contained inside the widget (absolutely positioned within
  the widget shell), so it never paints over host content.
- Step changes scroll the widget itself into view rather than scrolling the host page to
  the top.

## Example website config

Add this before the widget bundle loads:

```html
<script>
  window.CHIME_WIDGET_CONFIG = {
    businessName: 'Your Business Name',
    headerTitle: 'Book an Appointment',
    description: 'Choose a service first, then use the full calendar to select one live appointment opening.',
    payment: {
      enabled: true,
      stripePublishableKey: 'pk_live_replace_me',
      currency: 'USD'
    },
    api: {
      baseUrl: 'https://yourwebsite.com',
      servicesUrl: '/api/chime/services',
      availabilityUrl: '/api/chime/availability',
      bookingUrl: '/api/chime/bookings',
      paymentIntentUrl: '/api/chime/create-payment-intent',
      headers: {
        'X-Requested-With': 'ChimeWidget'
      }
    },
    customerFields: [
      { key: 'name', label: 'Full name', required: true, type: 'text' },
      { key: 'email', label: 'Email', required: true, type: 'email' },
      { key: 'phone', label: 'Phone', required: false, type: 'tel' },
      { key: 'notes', label: 'Notes', required: false, type: 'textarea' }
    ],
    termsTitle: 'Appointment Terms & Conditions',
    termsText: `Appointment Terms & Conditions

Replace this with the full terms document shown during booking.

Customers must scroll to the bottom before the agreement checkbox and Confirm Appointment button unlock.`
  };
</script>
```

## Inline-data option

If you want to skip APIs for services or availability while prototyping, pass them directly:

```js
window.CHIME_WIDGET_CONFIG = {
  businessName: 'Your Business Name',
  services: [
    {
      id: 'consultation',
      name: 'Consultation',
      description: 'Review and next steps.',
      durationMinutes: 30,
      depositAmountCents: 2000
    }
  ],
  availability: [
    {
      date: '2026-04-10',
      slots: [
        { id: 'slot-1', timeLabel: '9:00 AM', available: true, startsAt: '2026-04-10T09:00:00-04:00' },
        { id: 'slot-2', timeLabel: '9:30 AM', available: false, label: 'Booked' }
      ]
    }
  ]
};
```

## Expected API responses

### `GET /api/chime/services`

Return either an array or `{ services: [...] }`.

```json
[
  {
    "id": "repair",
    "name": "Repair Session",
    "description": "Hands-on troubleshooting.",
    "durationMinutes": 60,
    "depositAmountCents": 2000
  }
]
```

### `GET /api/chime/availability?serviceId=repair`

Return either an array or `{ availability: [...] }`. The frontend groups the response into a full month calendar and a time selector.

```json
[
  {
    "date": "2026-04-10",
    "slots": [
      {
        "id": "repair-1",
        "timeLabel": "11:00 AM",
        "available": true,
        "label": "Popular",
        "startsAt": "2026-04-10T11:00:00-04:00",
        "endsAt": "2026-04-10T12:00:00-04:00"
      },
      {
        "id": "repair-2",
        "timeLabel": "11:30 AM",
        "available": false,
        "label": "Booked"
      }
    ]
  }
]
```


### `GET /api/chime/calendar-events?startDate=2026-04-01&endDate=2026-04-30`

This route is included in the example server for your admin calendar or operations dashboard. It is not required for the public booking widget to render availability.

```json
{
  "events": [
    {
      "id": "event_uuid",
      "bookingId": "booking_uuid",
      "title": "Repair Session — Jane Doe",
      "date": "2026-04-10",
      "timeLabel": "11:00 AM",
      "startsAt": "2026-04-10T15:00:00.000Z",
      "endsAt": "2026-04-10T16:00:00.000Z",
      "eventType": "appointment"
    }
  ]
}
```

### `POST /api/chime/create-payment-intent`

Only required when a service has `depositAmountCents > 0` and `payment.enabled !== false`.

Request body:

```json
{
  "amount": 2000,
  "currency": "USD",
  "serviceId": "repair",
  "serviceName": "Repair Session",
  "slotId": "repair-1",
  "date": "2026-04-10",
  "customerEmail": "name@example.com"
}
```

Response body:

```json
{ "clientSecret": "pi_secret_..." }
```

### `POST /api/chime/bookings`

The booking payload now includes `termsAcceptedAt`, which is set only after the user scrolls the terms document to the bottom and accepts it.

```json
{
  "serviceId": "repair",
  "serviceName": "Repair Session",
  "date": "2026-04-10",
  "timeLabel": "11:00 AM",
  "slotId": "repair-1",
  "depositAmountCents": 2000,
  "paymentIntentId": "pi_123",
  "termsAcceptedAt": "2026-04-10T15:15:00.000Z",
  "customer": {
    "name": "Jane Doe",
    "email": "name@example.com",
    "phone": "555-555-5555",
    "notes": "Optional"
  }
}
```

Response body:

```json
{
  "bookingId": "booking_123",
  "confirmationMessage": "Your appointment was saved to the calendar."
}
```

## Real database setup

The included database files create a production-style Postgres calendar:

```bash
psql "$DATABASE_URL" -f database/postgres-schema.sql
psql "$DATABASE_URL" -f database/seed-demo.sql
```

Then run the example API:

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Set these widget environment variables for local development:

```bash
VITE_CHIME_API_BASE_URL=http://localhost:8787
VITE_CHIME_SERVICES_URL=/api/chime/services
VITE_CHIME_AVAILABILITY_URL=/api/chime/availability
VITE_CHIME_BOOKING_URL=/api/chime/bookings
VITE_CHIME_PAYMENT_INTENT_URL=/api/chime/create-payment-intent
VITE_CHIME_USE_DEMO_DATA=false
```

Set this in `server/.env` so API date grouping and time labels match the business location:

```bash
CHIME_TIME_ZONE=America/New_York
```

## Environment variables

Use `.env.local` for local development and set production values in your deployment platform:

```bash
VITE_CHIME_API_BASE_URL=
VITE_CHIME_SERVICES_URL=/api/chime/services
VITE_CHIME_AVAILABILITY_URL=/api/chime/availability
VITE_CHIME_BOOKING_URL=/api/chime/bookings
VITE_CHIME_PAYMENT_INTENT_URL=/api/chime/create-payment-intent
VITE_CHIME_STRIPE_PUBLISHABLE_KEY=
VITE_CHIME_CURRENCY=USD
VITE_CHIME_USE_DEMO_DATA=false
```

## Notes

- In local Vite dev mode, demo data is used unless `VITE_CHIME_USE_DEMO_DATA=false` is set.
- In production builds, demo data is off unless `VITE_CHIME_USE_DEMO_DATA=true` is explicitly set.
- Date-only strings such as `2026-04-10` are treated as local calendar dates to avoid timezone day-shift bugs.
- If no booking endpoint is configured, the widget still collects details locally and shows a setup confirmation message.
- If Stripe is not configured for a paid service, the booking can still be submitted without the online deposit.
- The example server rejects booking submissions that do not include `termsAcceptedAt`.
