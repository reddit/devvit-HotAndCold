import { signal } from '@preact/signals';
import { context, showToast } from '@devvit/web/client';
import { trpc } from '../../trpc';
import { getBrowserIanaTimeZone } from '../../../shared/timezones';
import { posthog } from '../../posthog';
import { setReminderOptIn } from './userSettings';

export const reminderStatus = signal<'loading' | 'ready' | 'error'>('loading');
export const reminderBusy = signal(false);
let pendingRefresh: Promise<void> | null = null;

export function refreshReminders(): Promise<void> {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = Promise.resolve().then(async () => {
    try {
      if (context.userId) setReminderOptIn(await trpc.cta.isOptedIntoReminders.query());
      reminderStatus.value = 'ready';
    } catch {
      reminderStatus.value = 'error';
    } finally {
      pendingRefresh = null;
    }
  });
  return pendingRefresh;
}

export async function updateReminders(action: 'enable' | 'toggle') {
  if (!context.userId || reminderBusy.value) return;
  reminderBusy.value = true;
  try {
    const timezone = getBrowserIanaTimeZone();
    let enabled: boolean;
    if (action === 'enable') {
      await trpc.cta.setReminder.mutate({ timezone });
      enabled = true;
    } else enabled = (await trpc.cta.toggleReminder.mutate({ timezone })).newValue;
    setReminderOptIn(enabled);
    reminderStatus.value = 'ready';
    posthog.setPersonProperties({ opted_into_reminders: enabled });
    showToast({
      text: enabled ? 'Daily reminders turned on' : 'Daily reminders turned off',
      appearance: enabled ? 'success' : 'neutral',
    });
    return enabled;
  } catch {
    showToast({ text: 'Could not update daily reminders. Please try again.' });
    return undefined;
  } finally {
    reminderBusy.value = false;
  }
}
