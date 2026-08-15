insert into chime_services (id, name, description, duration_minutes, deposit_amount_cents, sort_order)
values
  ('consultation', 'Consultation', 'A quick consultation to review your needs and next steps.', 30, 2000, 10),
  ('repair', 'Repair Session', 'Hands-on troubleshooting and repair support.', 60, 2000, 20),
  ('installation', 'Installation', 'Setup and installation for your hardware or software.', 90, 2000, 30)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  duration_minutes = excluded.duration_minutes,
  deposit_amount_cents = excluded.deposit_amount_cents,
  sort_order = excluded.sort_order,
  active = true;

-- Example slot generator: creates 30-minute openings for the next 180 days, Monday-Saturday, 9:00-4:30.
insert into chime_availability_slots (service_id, starts_at, ends_at, label)
select
  service_id,
  starts_at,
  starts_at + interval '30 minutes',
  case when extract(hour from starts_at) in (11, 14) then 'Popular' else null end
from (
  select
    s.id as service_id,
    (d::date + make_time(h, m, 0)) at time zone current_setting('TimeZone') as starts_at
  from chime_services s
  cross join generate_series(current_date, current_date + interval '180 days', interval '1 day') d
  cross join generate_series(9, 16) h
  cross join (values (0), (30)) minutes(m)
  where extract(dow from d) between 1 and 6
) generated
on conflict do nothing;
