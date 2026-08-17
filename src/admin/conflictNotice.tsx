/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from 'react';

import './conflictNotice.css';

/**
 * Shown when a save is refused because the record changed in another session.
 *
 * The server already prevents the overwrite: every mutation carries If-Match
 * with the version the editor loaded, and a stale version returns 409. What was
 * missing is the plan's other half — showing a comparison rather than only
 * saying "Service changed in another session. Refresh before saving."
 *
 * Refreshing is the safe default, but it silently discards the administrator's
 * work, and they cannot tell whether that matters without seeing what actually
 * differs. This lists the fields where the two versions disagree so the choice
 * is informed.
 */

export interface ConflictField {
  label: string;
  /** What the administrator has on screen. */
  mine: ReactNode;
  /** What another session already saved. */
  theirs: ReactNode;
}

interface ConflictNoticeProps {
  title: string;
  /** Fields that actually differ. An empty list means only the version moved. */
  fields: ConflictField[];
  /** Discard local edits and load the saved record. */
  onReload: () => void;
  /** Keep editing, so nothing is lost while deciding. */
  onDismiss: () => void;
}

export function ConflictNotice({ title, fields, onReload, onDismiss }: ConflictNoticeProps) {
  return (
    <div className="conflict-notice" role="alert">
      <strong>{title}</strong>
      <p>
        Someone else saved this while you were editing. Nothing of yours was
        overwritten, and nothing of theirs was either.
      </p>

      {fields.length ? (
        <table className="conflict-notice__table">
          <thead>
            <tr>
              <th scope="col">Field</th>
              <th scope="col">Yours</th>
              <th scope="col">Already saved</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.label}>
                <th scope="row">{field.label}</th>
                <td>{field.mine}</td>
                <td>{field.theirs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="conflict-notice__identical">
          The saved version matches what you have. Reloading costs you nothing.
        </p>
      )}

      <div className="conflict-notice__actions">
        <button onClick={onDismiss} type="button">Keep my edits open</button>
        <button className="conflict-notice__reload" onClick={onReload} type="button">
          Discard mine and load the saved version
        </button>
      </div>
    </div>
  );
}

/**
 * Compares two records field by field, returning only what differs.
 *
 * Takes the object type directly rather than constraining to
 * Record<string, unknown>, so an interface without an index signature — which
 * is most of them — can be passed without casting.
 */
export function compareRecords<T extends object>(
  mine: T,
  theirs: T,
  fields: Array<{ key: keyof T & string; label: string; format?: (value: unknown) => ReactNode }>,
): ConflictField[] {
  return fields.flatMap((field) => {
    const a = mine[field.key];
    const b = theirs[field.key];
    if (JSON.stringify(a) === JSON.stringify(b)) return [];
    const format = field.format ?? ((value: unknown) => String(value ?? '—'));
    return [{ label: field.label, mine: format(a), theirs: format(b) }];
  });
}
