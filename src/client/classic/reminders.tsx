import { useEffect } from 'preact/hooks';
import { context } from '@devvit/web/client';
import { IconButton } from '../shared/button';
import { BellIcon } from './icons';
import { userSettings } from './state/userSettings';
import { refreshReminders, reminderBusy, reminderStatus, updateReminders } from './state/reminders';

export function ReminderButton({ prominent = false }: { prominent?: boolean }) {
  useEffect(() => {
    void refreshReminders();
  }, []);
  const optedIn = userSettings.value.isUserOptedIntoReminders;
  if (!context.userId || (prominent && (reminderStatus.value !== 'ready' || optedIn))) return null;
  if (prominent)
    return (
      <button
        type="button"
        disabled={reminderBusy.value}
        onClick={() => void updateReminders('enable')}
        className="inline-flex w-full max-w-sm items-center justify-center gap-2 rounded-full bg-cyan-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
      >
        <BellIcon />
        {reminderBusy.value ? 'Turning On…' : 'Remind Me to Play Daily'}
      </button>
    );
  return (
    <IconButton
      iconOnly
      icon={<BellIcon off={!optedIn} />}
      aria-label={optedIn ? 'Turn Off Daily Reminders' : 'Turn On Daily Reminders'}
      aria-pressed={optedIn}
      disabled={reminderBusy.value || reminderStatus.value === 'loading'}
      onClick={() => void updateReminders('toggle')}
    >
      Daily Reminders
    </IconButton>
  );
}
