import { context, requestExpandedMode } from '@devvit/web/client';

export { GearIcon as SettingsIcon } from '../icons';

const initialSectionKey = `moderator-initial-section:${context.subredditId ?? context.subredditName}:${context.userId}`;

export function takeInitialModeratorSection(): 'Latest' | 'Words' {
  try {
    const section = localStorage.getItem(initialSectionKey);
    localStorage.removeItem(initialSectionKey);
    return section === 'Words' ? 'Words' : 'Latest';
  } catch {
    return 'Latest';
  }
}

export function openModeratorSettings(event: MouseEvent, section: 'Latest' | 'Words' = 'Latest') {
  try {
    localStorage.setItem(initialSectionKey, section);
  } catch {
    // The console still opens if browser storage is unavailable.
  }
  requestExpandedMode(event, 'moderator-console', { title: 'Moderator Settings (Experimental)' });
}
