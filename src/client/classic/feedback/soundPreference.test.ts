import { signal } from '@preact/signals';
import { expect, it, vi } from 'vitest';
import { createSoundPreference } from './soundPreference';

vi.mock('@devvit/web/client', () => ({ context: {} }));

it('restores an opt-in without writing and ignores a stale read after an explicit mute', async () => {
  const enabled = signal(false);
  let finish: (value: boolean) => void = () => {};
  const load = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
  const save = vi.fn().mockResolvedValue(undefined);
  const preference = createSoundPreference({ enabled, load, save });
  const first = preference.restore();
  expect(preference.ready.value).toBe(false);
  expect(preference.restore()).toBe(first);
  finish(true);
  await first;
  expect(preference.ready.value).toBe(true);
  expect(enabled.value).toBe(true);
  expect(save).not.toHaveBeenCalled();
  const stale = preference.restore();
  await preference.choose(false);
  finish(true);
  await stale;
  expect(enabled.value).toBe(false);
  expect(save).toHaveBeenCalledWith(false);
});

it('keeps the new default when unset and restores an explicit mute without writing a default record', async () => {
  const enabled = signal(true);
  const load = vi
    .fn<() => Promise<boolean | null>>()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(false);
  const save = vi.fn();
  const preference = createSoundPreference({ enabled, load, save });
  await preference.restore();
  expect(enabled.value).toBe(true);
  expect(preference.ready.value).toBe(true);
  await preference.restore();
  expect(enabled.value).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it('serializes quick toggles and keeps the last local choice through a save failure', async () => {
  const enabled = signal(false);
  let finish: () => void = () => {};
  const save = vi
    .fn()
    .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)))
    .mockRejectedValueOnce(new Error('offline'));
  const preference = createSoundPreference({ enabled, load: async () => null, save });
  const on = preference.choose(true);
  const off = preference.choose(false);
  await Promise.resolve();
  expect(save.mock.calls).toEqual([[true]]);
  expect(enabled.value).toBe(false);
  finish();
  expect(await on).toBe(true);
  expect(await off).toBe(false);
  expect(save.mock.calls).toEqual([[true], [false]]);
  expect(enabled.value).toBe(false);
});

it('uses the account-local fallback if loading fails', async () => {
  const enabled = signal(true);
  const preference = createSoundPreference({
    enabled,
    load: async () => {
      throw new Error('offline');
    },
    save: async () => {},
  });
  await preference.restore();
  expect(enabled.value).toBe(true);
});
