import { afterEach, expect, it } from 'vitest';
import {
  evaluateClientExperiment,
  localExperimentOverrides,
  setClientExperimentOverride,
} from './experimentOverrides';
const key = 'exp_default_guess_to_on';
afterEach(() => {
  localExperimentOverrides.value = {};
});
it('persists an override for only the chosen account and accepts the default again', () => {
  const other = evaluateClientExperiment(key, 't2_otherdev');
  setClientExperimentOverride(key, 't2_developertest', 'on');
  expect(evaluateClientExperiment(key, 't2_developertest')).toBe('on');
  expect(evaluateClientExperiment(key, 't2_otherdev')).toBe(other);
  expect(
    JSON.parse(localStorage.getItem('hotandcold:experiment-overrides:v1')!)[key].t2_developertest
  ).toBe('on');
  setClientExperimentOverride(key, 't2_developertest', null);
  expect(localExperimentOverrides.value[key]?.t2_developertest).toBeUndefined();
});
it('reacts to a setting changed in another view of the same app version', () => {
  setClientExperimentOverride(key, 't2_developertest', 'on');
  window.dispatchEvent(
    new StorageEvent('storage', {
      storageArea: window.localStorage,
      key: 'hotandcold:experiment-overrides:v1',
      newValue: JSON.stringify({ [key]: { t2_developertest: 'control' } }),
    })
  );
  expect(evaluateClientExperiment(key, 't2_developertest')).toBe('control');
});
