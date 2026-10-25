import { requestExpandedMode } from '@devvit/web/client';

export { GearIcon as SettingsIcon } from '../icons';

export function openModeratorSettings(event: MouseEvent) {
  requestExpandedMode(event, 'moderator-console', { title: 'Moderator Settings (Experimental)' });
}
