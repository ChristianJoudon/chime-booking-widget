# Chime fixes and finishing notes

## UI / flow

- Rebuilt the widget into a sequential flow: service screen → full calendar screen → details/terms/payment screen.
- Removed the split layout that showed service cards and calendar on the same screen.
- Removed the fixed top confirmation prompt that was floating over the interface.
- Replaced the old calendar with a custom full calendar using the Chime mint/sage color palette.
- Removed the blue DayPicker navigation by removing the DayPicker dependency entirely.
- Added Apple-inspired liquid-glass panels, blur, soft highlights, hover lift, tap compression, sticky glass header, animated progress steps, loading states, and focus states.

- Changing active calendar days now clears an old selected slot so the review button cannot submit the wrong time.

## Terms & confirmation

- Added a dedicated `TermsReview` step.
- The terms document is visible inside the booking flow.
- The acceptance checkbox is disabled until the customer scrolls to the bottom of the terms document.
- The final confirmation button is disabled until the document has been scrolled and accepted.
- Booking submissions now include `termsAcceptedAt`.

## Calendar / database

- Demo availability now covers 90 days for a realistic calendar preview.
- Added `database/postgres-schema.sql` for real services, customers, availability slots, bookings, calendar events, terms acceptances, and refundable deposits.
- Added `database/seed-demo.sql` to create sample services and 180 days of real slot rows.
- Added `server/` with an Express + Postgres API example, a calendar events endpoint, and business-timezone formatting.
- The booking route uses a database transaction and row lock to prevent double-booking the same slot.

## Existing technical fixes retained

- Date-only strings are parsed as local calendar dates to avoid timezone day shifts.
- API headers and API endpoint resolution are preserved.
- Custom customer fields are preserved in booking payloads.
- Stripe payment appearance now matches the mint theme.

## Follow-up polish pass: pastel UI + corrected reservation order

- Restored the softer first-iteration design language: pastel mint background, simple mint header, rounded white cards, lighter shadows, and playful pill controls.
- Kept the newer interaction system: animated steps, full calendar, hover/tap feedback, progress state, live availability, database/API scaffolding, and terms scroll locking.
- Changed the reservation sequence to: service → date/time → terms → contact details → refundable deposit → confirmation.
- The terms checkbox remains disabled until the terms panel has been scrolled to the bottom.
- Name and email remain required, with red asterisks and validation states.
- Set the default appointment deposit to a refundable $20.00 across demo services and database seed data.
