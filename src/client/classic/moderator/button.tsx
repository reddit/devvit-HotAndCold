import { IconButton } from '../../shared/button';
import { queueHealth } from '../../../shared/lowQueue';
import { ShieldIcon } from '../icons';
import { openModeratorSettings } from './launch';

export function ModeratorSettingsButton({
  queueSize,
  disabled,
}: {
  queueSize?: number | null;
  disabled: boolean;
}) {
  const health = queueHealth(queueSize);
  const warning = health === 'empty' ? 'Word Queue Empty' : 'Word Queue Running Low';
  return (
    <IconButton
      iconOnly
      icon={
        <>
          <span className="relative block h-6 w-6">
            <ShieldIcon />
            {health && (
              <span
                aria-hidden="true"
                data-moderator-queue-badge={health}
                className={`absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[10px] leading-none font-bold text-white ring-2 ring-white dark:ring-gray-950 ${health === 'empty' ? 'bg-red-600' : 'bg-amber-700'}`}
              >
                !
              </span>
            )}
          </span>
          {health && (
            <span id="moderator-queue-warning" className="sr-only">
              {warning}. {queueSize} upcoming words. Open Words to refill the queue.
            </span>
          )}
        </>
      }
      aria-label="Moderator Settings (Experimental)"
      aria-describedby={health ? 'moderator-queue-warning' : undefined}
      title={
        health
          ? `Moderator Settings · ${warning} · Add Upcoming Words`
          : 'Moderator Settings (Experimental)'
      }
      disabled={disabled}
      onClick={(event) => openModeratorSettings(event, health ? 'Words' : 'Latest')}
    >
      Moderator Settings
    </IconButton>
  );
}
