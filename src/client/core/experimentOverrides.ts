import { experimentDefinitions, experiments } from '../../shared/experiments/experiments';
import { localStorageSignal } from '../utils/localStorageSignal';

type Key = keyof typeof experimentDefinitions;
type Overrides = Partial<Record<Key, Record<string, string>>>;
export const localExperimentOverrides = localStorageSignal<Overrides>({
  key: 'hotandcold:experiment-overrides:v1',
  initialValue: {},
});

export function evaluateClientExperiment(key: Key, userId: string) {
  const override = localExperimentOverrides.value[key]?.[userId];
  return override && (experimentDefinitions[key].treatments as readonly string[]).includes(override)
    ? override
    : experiments.evaluate(userId, key).treatment;
}

export function setClientExperimentOverride(key: Key, userId: string, treatment: string | null) {
  if (
    treatment !== null &&
    !(experimentDefinitions[key].treatments as readonly string[]).includes(treatment)
  )
    return;
  const users = { ...localExperimentOverrides.value[key] };
  if (treatment === null) delete users[userId];
  else users[userId] = treatment;
  localExperimentOverrides.value = { ...localExperimentOverrides.value, [key]: users };
}
