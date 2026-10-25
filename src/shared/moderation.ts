export const WORD_REVEAL_PURPOSES = ['word_issue', 'queue_review', 'publishing_issue'] as const;
export const WORD_REVEAL_LABELS = {
  word_issue: 'Investigate a Reported Word Issue',
  queue_review: 'Verify Queue Order or Content',
  publishing_issue: 'Resolve a Publishing Problem',
};
export const WORD_REVEAL_REASON_MIN_LENGTH = 20;
export const WORD_REVEAL_DURATION_MS = 60_000;

export type WordRevealAcknowledgement = {
  purpose: (typeof WORD_REVEAL_PURPOSES)[number];
  reason: string;
  promiseNotToCheat: true;
  confirmation: 'REVEAL';
};
