-- Chime booking database schema for PostgreSQL / Supabase / Neon / Railway Postgres.
-- Apply this file to your database, then point the widget to the API routes in server/src/index.ts.

create extension if not exists pgcrypto;

create table if not exists chime_services (
  id text primary key,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  deposit_amount_cents integer not null default 2000 check (deposit_amount_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chime_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists chime_customers_email_unique
  on chime_customers (lower(email));

create table if not exists chime_availability_slots (
  id uuid primary key default gen_random_uuid(),
  service_id text not null references chime_services(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'available' check (status in ('available', 'held', 'booked', 'blocked')),
  label text,
  capacity integer not null default 1 check (capacity > 0),
  booked_count integer not null default 0 check (booked_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (booked_count <= capacity)
);

create index if not exists chime_availability_service_start_idx
  on chime_availability_slots (service_id, starts_at);

create unique index if not exists chime_availability_slot_unique
  on chime_availability_slots (service_id, starts_at, ends_at);

create index if not exists chime_availability_status_idx
  on chime_availability_slots (status);

create table if not exists chime_bookings (
  id uuid primary key default gen_random_uuid(),
  service_id text not null references chime_services(id),
  slot_id uuid not null references chime_availability_slots(id),
  customer_id uuid not null references chime_customers(id),
  appointment_date date not null,
  time_label text not null,
  status text not null default 'confirmed' check (status in ('requested', 'confirmed', 'cancelled', 'completed', 'no_show')),
  deposit_amount_cents integer not null default 2000,
  payment_intent_id text,
  terms_accepted_at timestamptz,
  source text not null default 'chime-widget',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NOTE: A single-booking-per-slot unique index was intentionally removed here
-- because it conflicts with slots that have capacity > 1. Capacity-based
-- concurrency is enforced by the SELECT ... FOR UPDATE + booked_count < capacity
-- check in the booking transaction (see server/src/index.ts).

create table if not exists chime_calendar_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references chime_bookings(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  event_type text not null default 'appointment' check (event_type in ('appointment', 'blocked', 'internal')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists chime_calendar_events_start_idx
  on chime_calendar_events (starts_at);

create index if not exists chime_calendar_events_booking_idx
  on chime_calendar_events (booking_id);

create table if not exists chime_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references chime_bookings(id) on delete cascade,
  customer_id uuid not null references chime_customers(id) on delete cascade,
  terms_version text not null default 'default',
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text
);

create table if not exists chime_payment_holds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references chime_bookings(id) on delete cascade,
  payment_intent_id text unique,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function chime_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists chime_services_touch_updated_at on chime_services;
create trigger chime_services_touch_updated_at
  before update on chime_services
  for each row execute function chime_touch_updated_at();

drop trigger if exists chime_availability_touch_updated_at on chime_availability_slots;
create trigger chime_availability_touch_updated_at
  before update on chime_availability_slots
  for each row execute function chime_touch_updated_at();

drop trigger if exists chime_bookings_touch_updated_at on chime_bookings;
create trigger chime_bookings_touch_updated_at
  before update on chime_bookings
  for each row execute function chime_touch_updated_at();
