# Chime Product Tightening Plan

## Purpose

Chime already has enough major feature areas for a strong small-business booking product. The next phase should not focus on adding more service types or expanding the navigation. It should make the existing experience more consistent, trustworthy, intuitive, and resilient.

This plan focuses on:

- Making every screen agree about the same business data.
- Removing test and demo clutter from real workflows.
- Simplifying navigation and terminology.
- Making important actions predictable and reversible.
- Connecting setup, scheduling, customers, payments, messages, and launch readiness.

## Product Guardrails

- Chime is for small businesses and their customers.
- Do not introduce vacation-rental or tenant concepts.
- Keep the customer booking order intact:
  1. Service
  2. Date and time
  3. Terms
  4. Customer details
  5. Deposit, when required
  6. Confirmation
- A paid booking must not be written to the database until payment is verified.
- Preserve the portable, self-contained booking widget.
- Prefer improving existing workflows over adding new sections.
- Keep CheckInn and HiTech Labs completely separate from Chime Standalone.

## Current Strengths

- The schedule is tactile and centered around real appointments.
- Administrators can resize appointment durations without editing code.
- Services support useful approval, deposit, buffer, staff, and location rules.
- Appointment-change previews provide a good model for safe administrative actions.
- Message sandboxing helps prevent accidental delivery.
- The widget designer gives small businesses meaningful visual control.
- Chime has a strong foundation for a portable booking experience.

## Findings and Recommendations

### 1. High Priority: Establish One Source of Truth

The current workspaces do not always agree about the same data.

Examples observed during the review:

- Schedule displayed appointments, customers, staff, services, and locations.
- Availability reported no active team schedules.
- Customers remained empty or loading.
- Widget Designer reported that no services were configured.
- Launch settings were unavailable.
- Team reported zero covered locations while scheduled appointments used locations.

#### Recommendation

Create one shared business snapshot used by all administrative workspaces. Services, team members, locations, availability, customers, payments, and widget settings should come from the same authenticated organization context.

Every data request should resolve to one of three explicit states:

- Loaded
- Genuinely empty
- Failed, with a clear explanation and Retry action

Authenticated screens should not silently fall back to disconnected demo data.

#### Completion Criteria

- The service count matches in Services, Insights, Widget Designer, and Launch.
- The team count matches in Schedule, Team, Availability, and Launch.
- Scheduled customers appear in Customers.
- Assigned locations appear consistently across Schedule, Services, and Team.
- Launch receives the same readiness data as the other workspaces.
- Loading states always finish as loaded, empty, or actionable error states.

### 2. High Priority: Separate Demo, Test, and Live Workspaces

Automated smoke-test services and example email recipients currently appear beside realistic business data. Payment and message modes are identified inside individual screens, but there is no persistent workspace-level status.

#### Recommendation

Add one global workspace indicator:

- Demo workspace
- Test workspace
- Live workspace

Provide a controlled Reset sample data action for demo environments. Test-generated services, customers, appointments, and messages should be tagged and hidden from ordinary business views by default.

#### Completion Criteria

- Smoke-test services do not appear in the normal service directory.
- Example recipients do not appear beside real customer messages.
- The current environment is visible from every admin screen.
- Demo actions cannot accidentally contact real customers or charge real cards.
- Production cannot enable demo-payment identifiers.

### 3. High Priority: Make Launch an Actionable Preflight Check

Launch currently reports a generic failure instead of telling the administrator what is incomplete.

#### Recommendation

Turn Launch into a readiness checklist based on existing Chime capabilities:

1. At least one active service exists.
2. A team member is assigned to each active service.
3. Required locations are assigned.
4. Customer availability has been previewed and published.
5. Payments are configured when a deposit is required.
6. Customer messages are configured.
7. Widget design is saved and active.
8. The embed installation can reach the Chime APIs.

Each incomplete item should explain the problem and link directly to the existing screen that fixes it.

#### Completion Criteria

- Launch never stops at a generic administrator-request error.
- Every failed requirement includes a plain-language resolution.
- Readiness updates immediately after a requirement is fixed.
- Publishing is blocked only by requirements that truly affect customer booking.

### 4. Medium Priority: Simplify Navigation

The current sidebar asks a small-business owner to choose among eleven destinations. Several destinations are parts of the same job.

#### Recommendation

Group the existing screens into five understandable areas:

1. Appointments
   - Schedule
   - Requests
2. Business setup
   - Services
   - Team
   - Availability
3. Customers
   - Customer book
   - Messages
4. Money
   - Payments
   - Insights
5. Booking widget
   - Designer
   - Launch

This should reorganize the existing capabilities rather than add new ones.

#### Completion Criteria

- No more than five primary navigation choices are shown at once.
- Every icon has a visible label or reliable tooltip.
- Pending requests and failed messages display counts beside their parent area.
- The administrator can return to Schedule from anywhere in one action.

### 5. Medium Priority: Tighten Services Studio

The product already has enough appointment types. New Service and Duplicate are more visually prominent than necessary, while smoke-test drafts create clutter.

#### Recommendation

- Keep the current core services.
- Archive or remove automated test drafts.
- Make Add service a secondary action.
- Move Duplicate into a service actions menu.
- Divide each service editor into Essentials and Advanced rules.

Essentials should contain:

- Customer-facing name
- Short description
- Duration
- Price and deposit
- Assigned staff
- Assigned location
- Confirmation behavior

Advanced rules should contain:

- Minimum and maximum duration
- Resize increments
- Buffers
- Minimum notice
- Booking horizon
- Change-approval rules
- Capacity

#### Completion Criteria

- Administrators can understand a service at a glance.
- Advanced options do not overwhelm first-time setup.
- Archived services remain in historical appointments but cannot be booked.
- The customer preview always reflects the saved service configuration.

### 6. Medium Priority: Make Important Actions Predictable

Appointment adjustment already previews changes before they are sent. This interaction pattern should be used consistently for other consequential actions.

#### Recommendation

Before committing a consequential action, show:

- What will change
- The previous and new values
- Who will be notified
- Whether customer approval is required
- Whether payment is affected
- Whether the action can be undone

Apply this pattern to:

- Appointment approval and decline
- Appointment resizing and reassignment
- Availability publication
- Message processing
- Template activation
- Deposit collection, refund, and void actions
- Widget publication

Use record versions to prevent one administrator from overwriting a newer change made by another administrator.

#### Completion Criteria

- Consequential actions require an outcome preview.
- Duplicate submissions are idempotent.
- Conflicting edits show a comparison instead of silently overwriting data.
- Reversible actions provide Undo or a safe recovery path.
- Every completed action creates an audit entry.

### 7. Medium Priority: Simplify Messages

The Messages workspace currently combines delivery monitoring, queue processing, suppression, templates, rich formatting, imported newsletters, and previews.

#### Recommendation

Use two internal tabs:

- Outbox
- Templates

Improve the existing experience by:

- Renaming Process ready to a concrete outcome such as Send 8 queued messages.
- Adding Send test to myself before template activation.
- Converting legacy escaped line breaks into proper paragraphs.
- Keeping plain-text fallbacks for every HTML email.
- Preserving server-side HTML sanitization.
- Requiring alt text and file-size limits for newsletter images.
- Showing the intended recipient, subject, and rendered message before sending.

#### Completion Criteria

- Queue management and template editing no longer compete for space.
- Legacy templates display real paragraph breaks.
- Imported HTML cannot execute scripts or unsafe links.
- Imported images have size limits and alternative text.
- Previewing, importing, and saving never send a message.
- Administrators can send a safe test before activating a template.

### 8. Medium Priority: Improve Schedule Safety and Clarity

Schedule should remain the primary home for daily work.

#### Recommendation

- Keep requests and alerts close to the calendar.
- Show pending approvals directly on appointment cards.
- Display buffer conflicts and overlapping assignments before saving.
- Show old and new appointment details in change previews.
- Explain exactly which customer notification will be sent.
- Add keyboard-accessible alternatives to drag and resize interactions.
- Preserve the reason for every schedule change in the appointment history.

#### Completion Criteria

- A staff member cannot be double-booked accidentally.
- Required buffers cannot be violated silently.
- Resize and drag actions work with mouse, touch, and keyboard.
- Customer approval status is visible without opening multiple screens.
- Every change can be traced to an administrator and timestamp.

### 9. Medium Priority: Keep Customers Focused on Appointment Relationships

Chime does not need to become a large CRM. The customer workspace should support better appointments and communication.

#### Recommendation

Limit the customer profile to useful booking context:

- Contact details
- Consent and communication preferences
- Upcoming appointment
- Recent appointments
- Service preferences
- Accessibility or visit notes
- Messages and appointment-change history
- Tags that support service, care, or follow-up

Add safe duplicate detection using normalized email and phone values.

#### Completion Criteria

- Customers created by bookings appear automatically.
- Duplicate profiles can be safely merged.
- Communication consent is visible before outreach.
- Sensitive notes are permission-controlled and audited.
- Customer history links directly to the relevant appointments and payments.

### 10. Medium Priority: Strengthen Payment and Delivery Reliability

Payment and customer communication are the highest-risk operational areas.

#### Recommendation

- Preserve verified payment before booking persistence.
- Reuse the verified payment intent if booking persistence needs to be retried.
- Make payment and message operations idempotent.
- Connect every payment ledger entry to an appointment and customer.
- Require a reason for refunds, voids, and suppressions.
- Use durable background jobs for message delivery and retry.
- Surface provider failures in plain language with a safe retry action.

#### Completion Criteria

- Unpaid or fake payment requests create no booking rows.
- Retrying persistence does not create a second payment intent.
- Retrying a message does not create duplicate delivery.
- Refunds and voids include administrator, reason, and timestamp.
- Provider outages do not lose appointments or queued messages.

### 11. Lower Priority: Make Language More Literal

The current personality is appealing, but some headings prioritize style over immediate comprehension.

#### Recommendation

Use direct primary headings such as:

- Appointments
- Requests
- Messages
- Services
- Team
- Availability
- Customers
- Payments
- Insights
- Widget Designer
- Launch

Keep warmer brand language as supporting copy underneath each literal heading.

## Recommended Delivery Order

### Phase 1: Trust the Data

1. Unify organization data across all workspaces.
2. Fix Customers, Availability, Widget Designer, and Launch connections.
3. Add explicit loaded, empty, and failed states.
4. Remove or quarantine test records.
5. Add the global Demo, Test, or Live workspace indicator.

### Phase 2: Reduce Cognitive Load

1. Consolidate the primary navigation.
2. Tighten Services Studio around the existing core services.
3. Replace ambiguous headings and buttons with outcome-based language.
4. Create the actionable Launch preflight checklist.

### Phase 3: Make Actions Safe

1. Standardize previews for consequential changes.
2. Add conflict detection and record versions.
3. Add idempotency protections.
4. Add undo or recovery paths.
5. Attach audit history to appointments, customers, messages, and payments.

### Phase 4: Refine Communication and Relationships

1. Separate Messages into Outbox and Templates.
2. Add test-email delivery.
3. Repair legacy template formatting.
4. Connect customers to appointments, messages, and payments.
5. Add duplicate detection and communication-consent safeguards.

### Phase 5: Harden for Production

1. Verify payment and delivery failure paths.
2. Add cross-workspace contract tests.
3. Add accessibility coverage for keyboard and touch interactions.
4. Add operational logging and actionable error identifiers.
5. Verify the standalone embed against unrelated host-site styles.

## Recommended Immediate Step

Begin with Phase 1 as one focused tightening milestone. Do not redesign individual screens until Services, Team, Availability, Customers, Widget Designer, and Launch all report the same organization data. Once the product has one trusted source of truth, the navigation and interface simplification work will be much safer and faster.

## Out of Scope for This Tightening Plan

- Adding many more service types
- Vacation-rental functionality
- Tenant management
- CheckInn integration
- HiTech Labs website changes
- A full CRM
- Additional payment providers before the Stripe path is production-ready
- New navigation sections that duplicate existing capabilities
