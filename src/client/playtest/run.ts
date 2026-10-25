import { context } from '@devvit/web/client';
import type { TestRun } from '../../shared/playtest';

let activeTestRun: TestRun | null = null;

export const getActiveTestRun = () => activeTestRun;
export const setActiveTestRun = (run: TestRun | null) => {
  activeTestRun = run;
};

const runChangeKey = () => `playtest:run-changed:${context.userId}:${context.postId}`;

export function notifyTestRunChanged(challengeNumber: number) {
  localStorage.setItem(runChangeKey(), String(challengeNumber));
}

export function watchTestRunChanges(onChange: () => void) {
  const check = () => {
    const next = Number(localStorage.getItem(runChangeKey()));
    if (next >= 1_000_000_000 && next > (getActiveTestRun()?.challengeNumber ?? Infinity))
      onChange();
  };
  const storage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === runChangeKey()) check();
  };
  window.addEventListener('storage', storage);
  window.addEventListener('focus', check);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener('focus', check);
  };
}
