import { useMemo, useState, type CSSProperties } from 'react';

import {
  type AdminApiClient,
  type AdminInsightsPayload,
} from './adminApi';
import { StudioStateNotice, useStudioResource } from './studioState';
import './insightsStudio.css';

type InsightsStudioProps = { api: AdminApiClient };
type InsightRange = 7 | 30 | 90;

const EMPTY: AdminInsightsPayload = {
  range: { days: 30, startsAt: new Date(0).toISOString(), endsAt: new Date(0).toISOString(), timeZone: 'Pacific/Honolulu' },
  summary: {
    appointments: 0,
    appointmentTrend: 0,
    uniqueCustomers: 0,
    customerTrend: 0,
    newCustomers: 0,
    returningCustomers: 0,
    netCollectedMinor: 0,
    collectedTrend: 0,
    completedRate: 0,
    cancelledRate: 0,
    noShowRate: 0,
    averageDurationMinutes: 0,
    pendingApproval: 0,
    currency: 'USD',
  },
  daily: [],
  services: [],
  heatmap: [],
  sources: [],
};

const DAYS = [
  { id: 1, label: 'Mon' }, { id: 2, label: 'Tue' }, { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' }, { id: 5, label: 'Fri' }, { id: 6, label: 'Sat' },
  { id: 7, label: 'Sun' },
];
const HOURS = [8, 10, 12, 14, 16, 18];

function money(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function compactDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function trendLabel(value: number | null): string {
  if (value === null) return 'New this period';
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${value}%`;
}

function sourceLabel(source: string): string {
  if (source === 'widget') return 'Booking widget';
  if (source === 'admin') return 'Added by your team';
  return source.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function Trend({ value }: { value: number | null }) {
  const direction = value === null || value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return <small className={`insights-trend is-${direction}`}>{trendLabel(value)} <span>vs prior period</span></small>;
}

export default function InsightsStudio({ api }: InsightsStudioProps) {
  const [range, setRange] = useState<InsightRange>(30);

  const resource = useStudioResource<AdminInsightsPayload>(
    () => api.getInsights(range),
    [api, range],
    // Insights with no appointments in range is a real answer worth naming,
    // not an empty dashboard the administrator has to interpret.
    { isEmpty: (result) => result.summary.appointments === 0 },
  );
  const payload = resource.data ?? EMPTY;
  const loading = resource.status === 'loading';

  const maxDaily = Math.max(1, ...payload.daily.map((point) => point.appointments));
  const maxService = Math.max(1, ...payload.services.map((service) => service.appointments));
  const maxHeat = Math.max(1, ...payload.heatmap.map((point) => point.appointments));
  const customerTotal = payload.summary.newCustomers + payload.summary.returningCustomers;
  const newShare = customerTotal ? Math.round((payload.summary.newCustomers / customerTotal) * 100) : 0;

  const heat = useMemo(() => {
    const map = new Map<string, number>();
    payload.heatmap.forEach((point) => map.set(`${point.day}-${point.hour}`, point.appointments));
    return map;
  }, [payload.heatmap]);

  const busiest = payload.daily.reduce((best, point) => point.appointments > best.appointments ? point : best, payload.daily[0] ?? { date: '', appointments: 0, completed: 0, cancelled: 0, netCollectedMinor: 0 });
  const strongestService = payload.services[0];

  return (
    <section className="insights-studio" aria-labelledby="insights-title">
      <header className="insights-header">
        <div>
          <p>Money</p>
          <h1 id="insights-title">Insights</h1>
          <span>See how appointments, customers, and deposits are moving together.</span>
        </div>
        <div className="insights-ranges" aria-label="Insight date range">
          {([7, 30, 90] as InsightRange[]).map((days) => (
            <button className={range === days ? 'is-active' : ''} key={days} type="button" onClick={() => setRange(days)}>{days} days</button>
          ))}
        </div>
      </header>

      <StudioStateNotice
        status={resource.status}
        error={resource.error}
        onRetry={resource.reload}
        loadingLabel="Loading business insights..."
        emptyTitle="No appointments in this period"
        emptyBody={`Nothing was booked in the last ${range} days, so there is nothing to measure yet. Try a longer range.`}
      />


      {resource.status === 'ready' || resource.status === 'empty' ? (
      <>
      <div className={`insights-kpis${loading ? ' is-loading' : ''}`}>
        <article><span>Appointments</span><strong>{payload.summary.appointments}</strong><Trend value={payload.summary.appointmentTrend} /></article>
        <article><span>Net customer deposits</span><strong>{money(payload.summary.netCollectedMinor, payload.summary.currency)}</strong><Trend value={payload.summary.collectedTrend} /></article>
        <article><span>Customers served</span><strong>{payload.summary.uniqueCustomers}</strong><Trend value={payload.summary.customerTrend} /></article>
        <article><span>Completion rate</span><strong>{payload.summary.completedRate}%</strong><small>{payload.summary.cancelledRate}% cancelled / {payload.summary.noShowRate}% no-show</small></article>
      </div>

      <div className="insights-primary-grid">
        <article className="insights-panel insights-volume">
          <div className="insights-panel__heading">
            <div><p>Appointment rhythm</p><h2>Daily booking volume</h2></div>
            <span>{payload.summary.averageDurationMinutes} min average</span>
          </div>
          {payload.daily.some((point) => point.appointments > 0) ? (
            <div className="insights-bars" aria-label="Daily appointment volume chart">
              {payload.daily.map((point, index) => (
                <div className="insights-bar" key={point.date} title={`${compactDate(point.date)}: ${point.appointments} appointments`}>
                  <b>{point.appointments || ''}</b>
                  <i style={{ height: `${Math.max(point.appointments ? 8 : 2, (point.appointments / maxDaily) * 100)}%` }} />
                  {(payload.daily.length <= 31 || index % Math.ceil(payload.daily.length / 12) === 0) ? <small>{compactDate(point.date)}</small> : <small />}
                </div>
              ))}
            </div>
          ) : <div className="insights-empty">Appointments will form a trend here as customers book.</div>}
          <div className="insights-chart-key"><span><i />All appointments</span><span><i />Completed appointments are included</span></div>
        </article>

        <article className="insights-panel insights-customers">
          <div className="insights-panel__heading"><div><p>Customer mix</p><h2>New and returning</h2></div></div>
          <div className="insights-customer-mix">
            <div className="insights-donut" style={{ '--new-share': `${newShare}%` } as CSSProperties}>
              <span><strong>{customerTotal}</strong><small>customers</small></span>
            </div>
            <div className="insights-customer-legend">
              <div><i className="is-new" /><span><strong>{payload.summary.newCustomers}</strong><small>New customers</small></span><b>{newShare}%</b></div>
              <div><i className="is-returning" /><span><strong>{payload.summary.returningCustomers}</strong><small>Returning customers</small></span><b>{customerTotal ? 100 - newShare : 0}%</b></div>
            </div>
          </div>
          <div className="insights-customer-note">Returning customers are people whose first Chime appointment happened before this period.</div>
        </article>
      </div>

      <div className="insights-secondary-grid">
        <article className="insights-panel insights-services">
          <div className="insights-panel__heading"><div><p>Service performance</p><h2>What customers are choosing</h2></div><span>Net deposits</span></div>
          <div className="insights-service-list">
            {payload.services.length ? payload.services.map((service) => (
              <div className="insights-service" key={service.id}>
                <span><strong>{service.name}</strong><small>{service.uniqueCustomers} customers / {service.completed} completed</small></span>
                <div><i style={{ width: `${(service.appointments / maxService) * 100}%` }} /></div>
                <b>{service.appointments}</b>
                <em>{money(service.netCollectedMinor, payload.summary.currency)}</em>
              </div>
            )) : <div className="insights-empty is-compact">Published services will appear here.</div>}
          </div>
        </article>

        <article className="insights-panel insights-heatmap">
          <div className="insights-panel__heading"><div><p>Busy-time map</p><h2>When customers come in</h2></div></div>
          <div className="insights-heat-grid">
            <span />{HOURS.map((hour) => <span className="insights-heat-hour" key={hour}>{hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}</span>)}
            {DAYS.map((day) => (
              <div className="insights-heat-row" key={day.id}>
                <span>{day.label}</span>
                {HOURS.map((hour) => {
                  const count = heat.get(`${day.id}-${hour}`) ?? 0;
                  return <i key={hour} title={`${day.label} ${hour}:00 - ${count} appointments`} style={{ '--heat': count / maxHeat } as CSSProperties} />;
                })}
              </div>
            ))}
          </div>
          <div className="insights-heat-legend"><span>Quieter</span><i /><i /><i /><i /><span>Busier</span></div>
        </article>
      </div>

      <div className="insights-tertiary-grid">
        <article className="insights-panel insights-sources">
          <div className="insights-panel__heading"><div><p>Booking sources</p><h2>How appointments arrive</h2></div></div>
          {payload.sources.length ? payload.sources.map((source) => {
            const share = payload.summary.appointments ? Math.round((source.appointments / payload.summary.appointments) * 100) : 0;
            return <div className="insights-source" key={source.source}><span>{sourceLabel(source.source)}</span><div><i style={{ width: `${share}%` }} /></div><b>{share}%</b></div>;
          }) : <div className="insights-empty is-compact">Booking sources will appear with appointments.</div>}
        </article>

        <article className="insights-panel insights-readout">
          <div className="insights-panel__heading"><div><p>Plain-language readout</p><h2>What stands out</h2></div></div>
          <div className="insights-readout-list">
            <div><i className="is-mint" /><span><strong>{busiest.appointments ? `${compactDate(busiest.date)} was busiest` : 'Your busiest day is still forming'}</strong><small>{busiest.appointments ? `${busiest.appointments} appointments on the calendar.` : 'More bookings will reveal a useful pattern.'}</small></span></div>
            <div><i className="is-sky" /><span><strong>{strongestService ? `${strongestService.name} leads demand` : 'Service demand will appear here'}</strong><small>{strongestService ? `${strongestService.appointments} appointments from ${strongestService.uniqueCustomers} customers.` : 'Chime will compare active services automatically.'}</small></span></div>
            <div><i className={payload.summary.cancelledRate > 15 ? 'is-coral' : 'is-lemon'} /><span><strong>{payload.summary.cancelledRate > 15 ? 'Cancellation rate needs attention' : 'Cancellations are under control'}</strong><small>{payload.summary.cancelledRate}% cancelled and {payload.summary.pendingApproval} awaiting approval.</small></span></div>
          </div>
        </article>
      </div>
      </>
      ) : null}
    </section>
  );
}
