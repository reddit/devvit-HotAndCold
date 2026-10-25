import { requestExpandedMode } from '@devvit/web/client';

export const popupTitles = {
  'player-settings': 'Settings',
  'give-up': 'Give Up This Puzzle?',
  'score-breakdown': 'Score Breakdown',
  'comment-composer': 'Share Your Results',
  'playtest-controls': 'Playtest Controls',
  results: 'Results',
} as const;
export type PopupEntry = keyof typeof popupTitles;

export function openPopup(event: MouseEvent, entry: PopupEntry) {
  requestExpandedMode(event, entry, { title: popupTitles[entry] });
}
