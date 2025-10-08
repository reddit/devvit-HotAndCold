import { AbTestEngine } from './engine';

export const experiments = new AbTestEngine({
  exp_new_splash: {
    treatments: ['control', 'new'],
  },
  exp_default_guess_to_on: {
    treatments: ['control', 'on'],
  },
});

export type ExperimentKey = keyof typeof experiments extends never
  ? string
  : keyof Parameters<typeof AbTestEngine.prototype.evaluate>[1];

export const experimentDefinitions = {
  exp_new_splash: {
    treatments: ['control', 'new'] as const,
  },
  exp_default_guess_to_on: {
    treatments: ['control', 'on'] as const,
  },
} as const;
