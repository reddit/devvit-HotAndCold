import { requestExpandedMode } from '@devvit/web/client';

export const SettingsIcon = () => (
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9.5 3-1 3-3 1-.5 3-2 2 2 2 .5 3 3 1 1 3h5l1-3 3-1 .5-3 2-2-2-2-.5-3-3-1-1-3h-5Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export function openModeratorSettings(event: MouseEvent) {
  requestExpandedMode(event, 'moderator-console', { title: 'Moderator settings (Experimental)' });
}
