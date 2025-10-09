import { AbTestEngine } from './engine';

export const experimentDefinitions = {
  exp_default_guess_to_on: {
    treatments: ['control', 'on'] as const,
  },
} as const;

export const experiments = new AbTestEngine(experimentDefinitions);

export type ExperimentKey = keyof typeof experiments extends never
  ? string
  : keyof Parameters<typeof AbTestEngine.prototype.evaluate>[1];
