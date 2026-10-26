import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../index.css';
import { SoundPreferences } from './controls';
import { audioPreferences, soundEnabled } from './audio';
import { TEMPERATURE_FEEDBACK_MS } from './temperature';

vi.mock('@devvit/web/client', () => ({ context: {}, showToast: () => {} }));

let container: HTMLDivElement;
let originalPreferences: typeof audioPreferences.value;
let originalSound: boolean;
beforeEach(async () => {
  originalPreferences = audioPreferences.value;
  originalSound = soundEnabled.value;
  soundEnabled.value = false;
  audioPreferences.value = { ...originalPreferences, motion: true };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  container = document.createElement('div');
  document.body.append(container);
  await act(() => render(<SoundPreferences />, container));
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  audioPreferences.value = originalPreferences;
  soundEnabled.value = originalSound;
  vi.useRealTimers();
});
const preview = async (direction: 'Warmer' | 'Colder') => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === `Preview ${direction}`
  )!;
  await act(() => {
    button.click();
  });
};
const advance = async (ms: number) => {
  await act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const backdrop = () => container.querySelector<HTMLElement>('.temperature-backdrop');
const badge = () => container.querySelector('[role="status"]')?.textContent ?? '';

it('keeps the tint after the badge clears and signals a repeated direction again', async () => {
  expect(backdrop()).toBeNull();
  await preview('Warmer');
  const firstPulse = backdrop()!.getAnimations()[0];
  expect(firstPulse).toBeDefined();
  expect(badge()).toContain('Warmer');
  await advance(TEMPERATURE_FEEDBACK_MS + 1);
  expect(badge()).toBe('');
  expect(backdrop()).not.toBeNull();
  await preview('Warmer');
  expect(badge()).toContain('Warmer');
  expect(backdrop()!.getAnimations()[0]).not.toBe(firstPulse);
  expect(soundEnabled.value).toBe(false);
});

it('switches direction immediately without an older timer hiding the newer cue', async () => {
  await preview('Warmer');
  await advance(700);
  await preview('Colder');
  await advance(701);
  expect(badge()).toContain('Colder');
  await advance(700);
  expect(badge()).toBe('');
  expect(backdrop()).not.toBeNull();
});

it('lets players turn off the tint while retaining the text feedback', async () => {
  await preview('Colder');
  await act(() => {
    audioPreferences.value = { ...audioPreferences.value, motion: false };
  });
  expect(backdrop()).toBeNull();
  expect(badge()).toContain('Colder');
  await advance(TEMPERATURE_FEEDBACK_MS + 1);
  expect(badge()).toBe('');
});
