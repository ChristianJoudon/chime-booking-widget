/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { getAdminConnection, describeMissingConnection } from './adminConnection';
import './studioState.css';

/**
 * Every admin data request resolves to exactly one of these. The tightening
 * plan calls for three; 'unconfigured' is split out from 'failed' because the
 * remedy is completely different — one is a setup step, the other is a retry.
 *
 * There is deliberately no state that renders invented data.
 */
export type StudioStatus = 'loading' | 'ready' | 'empty' | 'unconfigured' | 'failed';

export interface StudioResource<T> {
  data: T | null;
  status: StudioStatus;
  /** Present for 'unconfigured' and 'failed'. */
  error: string | null;
  /** Re-runs the loader. Safe to bind directly to a Retry button. */
  reload: () => void;
}

interface UseStudioResourceOptions<T> {
  /** Lets a studio distinguish "loaded, but nothing in it" from "loaded". */
  isEmpty?: (value: T) => boolean;
  /** Skip loading entirely, e.g. while a prerequisite is missing. */
  skip?: boolean;
}

/**
 * Standardizes the load lifecycle so studios stop hand-rolling it, and so a
 * missing connection can never quietly render as an empty dashboard.
 */
export function useStudioResource<T>(
  load: () => Promise<T>,
  dependencies: readonly unknown[],
  options: UseStudioResourceOptions<T> = {},
): StudioResource<T> {
  const { isEmpty, skip = false } = options;
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<StudioStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (skip) return;

    if (!getAdminConnection()) {
      setStatus('unconfigured');
      setError(describeMissingConnection());
      setData(null);
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    void load()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus(isEmpty?.(result) ? 'empty' : 'ready');
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setData(null);
        setStatus('failed');
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Chime could not load this workspace.',
        );
      });

    return () => {
      cancelled = true;
    };
    // `load` is intentionally excluded: callers pass an inline closure, and the
    // explicit dependency list is what should drive reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, attempt, skip]);

  return { data, status, error, reload };
}

interface StudioStateNoticeProps {
  status: StudioStatus;
  error?: string | null;
  onRetry?: () => void;
  /** Shown for 'loading'. */
  loadingLabel?: string;
  /** Shown for 'empty'. */
  emptyTitle?: string;
  emptyBody?: ReactNode;
}

/**
 * Renders the non-ready states. Returns null for 'ready' so a studio can place
 * this above its content unconditionally.
 */
export function StudioStateNotice({
  status,
  error,
  onRetry,
  loadingLabel = 'Loading...',
  emptyTitle = 'Nothing here yet',
  emptyBody,
}: StudioStateNoticeProps) {
  if (status === 'ready') return null;

  if (status === 'loading') {
    return (
      <div className="studio-state studio-state--loading" role="status" aria-live="polite">
        <span className="studio-state__spinner" aria-hidden="true" />
        <span>{loadingLabel}</span>
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="studio-state studio-state--empty" role="status">
        <strong>{emptyTitle}</strong>
        {emptyBody ? <span>{emptyBody}</span> : null}
      </div>
    );
  }

  const isSetup = status === 'unconfigured';
  return (
    <div className="studio-state studio-state--problem" role="alert">
      <strong>{isSetup ? 'Chime is not connected' : 'This workspace could not load'}</strong>
      <span>{error ?? 'No further detail was reported.'}</span>
      {/* Retrying a setup problem just fails again; the fix is in a file. */}
      {!isSetup && onRetry ? (
        <button type="button" onClick={onRetry}>Try again</button>
      ) : null}
    </div>
  );
}
