import './loadingSplash.css';
import clsx from 'clsx';

/** Matches the initial HTML fallback, so startup stays branded before scripts load. */
export function LoadingSplash({ inline = false }: { inline?: boolean }) {
  return (
    <div
      className={clsx('loading-splash', inline && 'loading-splash--inline')}
      role="status"
      aria-label="Loading Hot and Cold"
    >
      <div className="loading-splash__spinner" aria-hidden="true">
        <img src="/assets/hot-and-cold-icon.png" alt="" width="144" height="144" />
      </div>
      <div className="loading-splash__caption">
        <p className="loading-splash__name" aria-hidden="true">
          Hot &amp; Cold
        </p>
        <p className="loading-splash__message">Loading…</p>
      </div>
    </div>
  );
}
