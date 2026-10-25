import type { TestRun } from '../../shared/playtest';

let activeTestRun: TestRun | null = null;

export const getActiveTestRun = () => activeTestRun;
export const setActiveTestRun = (run: TestRun | null) => {
  activeTestRun = run;
};
