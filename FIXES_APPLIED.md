# Bug fixes & logical-consistency review

These are the corrections applied on top of the uploaded project. The author's
own notes remain in `CHIME_FIXES.md`; this file only covers the issues found and
fixed during this review. The exact line-level changes are in `FIXES_APPLIED.patch`.

## 1. Critical — default demo could never reach confirmation (Stripe dead-end)
`src/components/booking/BookingFlow.tsx`

`requiresPaymentStep` was true whenever a deposit existed, regardless of whether
Stripe was actually configured. In the default `npm run dev` demo there is no
publishable key and no payment-intent URL, so the flow routed every customer to
the payment step, which immediately throws "A Stripe publishable key is
required" and only offers a *Back* button — the confirmation page was
unreachable and the demo could not complete a booking.

Fix: added `canCollectDeposit` (requires both a publishable key **and** a
payment-intent endpoint) and made the payment step contingent on it. When Stripe
isn't configured the booking is submitted without an online deposit, which is the
behavior the confirmation page's "pending setup" branch and
`WIDGET_INTEGRATION.md` already described. The reservation intro text and the
"Refundable deposit" summary row are now conditional too, so they don't promise a
deposit that won't be taken.

## 2. Explicit "no deposit" was silently overridden
`src/lib/normalizers.ts`

`getAppointmentDepositAmountCents` coerced an explicit `0` up to the default
2000-cent deposit, making no-deposit services impossible and turning every
"No deposit" / "No deposit required" UI branch into dead code.
`getServiceDepositAmountCents` already supplies the default when no value is set,
so the extra coercion was the bug. It now returns the configured amount as-is.
The deposit rows in `TermsReview.tsx` are guarded with `> 0` to match.

## 3. "Next opening" button did nothing after a slot was selected
`src/components/calendar/CalendarView.tsx`

`jumpToNextAvailable` only moved the internal `activeDate`, but a `useEffect`
immediately snaps `activeDate` back to the selected date — so once a slot was
chosen the button appeared dead, and could also carry a stale time from the
previous day. It now clears/advances the selection via `onDayChanged` when the
next opening is on a different day.

## 4. Documented step order didn't match the implementation
`WIDGET_INTEGRATION.md`

The numbered flow listed contact details *before* terms; the widget collects
terms first. Rewritten to match the real order: service → date/time → terms →
details → deposit (only when Stripe is configured) → confirmation.

## 5. Currency wasn't threaded into the service screens
`src/App.tsx`, `src/components/services/ServiceList.tsx`

Service cards and the selected-service summary called `formatMoneyFromCents`
without a currency (defaulting to USD) while checkout used
`config.payment.currency`, so non-USD configurations showed mismatched symbols.
`currency` is now passed through to both components.

## 6. Demo let you book times earlier today
`src/data/sampleAvailability.ts`

Sample availability generated 9:00 AM–4:30 PM slots for the current day
regardless of the current time, so the demo could offer openings already in the
past. Slot generation now skips any start time at or before "now" (this only
affects today; future days are unchanged), while keeping the booked/"Popular"
pattern stable.

## Observations left as-is (no code change)
- `database/postgres-schema.sql`: the partial unique index
  `chime_bookings_slot_active_unique` on `slot_id` allows only one active booking
  per slot, which is correct for the default capacity of 1 but conflicts with the
  multi-capacity (`booked_count` / `capacity > 1`) feature. Left unchanged as a
  schema/business decision.
- `server/src/index.ts`: the availability query filters on `starts_at >=
  today::date`, so the real backend has the same "earlier today" behavior that
  fix #6 addresses in the demo data. Whether to hide past slots server-side is a
  business decision, so it was left untouched.

---

# GUI fixes (follow-up pass)

A second pass focused specifically on the booking UI. Both fixes are in
`src/index.css`.

## 7. Terms & Conditions reading pane was a squat letterbox
The terms document container (`.terms-document`) used `max-height: 320px` with no
stable height, so it collapsed to a short, wide rectangle — a cramped porthole
over a long, multi-paragraph legal document, and its size shifted depending on
how long the terms were. It now uses a stable, responsive reading height
(`height: clamp(360px, 52vh, 620px)`) and only scrolls vertically, so it's a
proper reading window on any screen. The inner "paper" (`.terms-document__paper`)
now fills that window (`min-height: 100%`) so short terms still look like a single
sheet rather than a small card floating on the glass.

## 8. Reservation mini-stepper left an empty column
`.booking-mini-stepper` hardcoded `grid-template-columns: repeat(4, …)`. Because
the flow now correctly shows three steps (Terms · Contact · Done) when no online
deposit is collected, the three chips only filled three of four columns, leaving
a visible empty slot on the right. The stepper now sizes to the actual number of
steps (`grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr)`), so it lays
out evenly whether there are three steps or four (when a Stripe deposit step is
present).
