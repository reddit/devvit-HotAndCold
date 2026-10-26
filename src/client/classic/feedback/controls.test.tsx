import { render } from 'preact';
import { act } from 'preact/test-utils';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { SoundButton, startSoundOnGuess, useSoundPlayback } from './controls';
import { gameAudio, soundEnabled } from './audio';
import { soundPreference } from './soundPreference';
import { trpc } from '../../trpc';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_sound_controls' },
  showToast: vi.fn(),
}));
vi.mock('../../trpc', () => ({
  trpc: {
    audioSettings: {
      get: { query: vi.fn().mockResolvedValue({ enabled: null }) },
      set: { mutate: vi.fn().mockResolvedValue({}) },
    },
  },
}));

let container: HTMLDivElement;
let report: IntersectionObserverCallback;
let enable: MockInstance<typeof gameAudio.enable>;
let unlock: MockInstance<typeof gameAudio.unlock>;
beforeEach(() => {
  report = () => {};
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        report = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    }
  );
  enable = vi.spyOn(gameAudio, 'enable').mockResolvedValue(true);
  unlock = vi.spyOn(gameAudio, 'unlock').mockResolvedValue(true);
  container = document.createElement('div');
  document.body.append(container);
  soundEnabled.value = false;
  soundPreference.ready.value = false;
  vi.mocked(trpc.audioSettings.get.query).mockResolvedValue({ enabled: null });
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  enable.mockRestore();
  unlock.mockRestore();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const intersect = async (visible: boolean) => {
  await act(() =>
    report(
      [
        {
          target: document.documentElement,
          isIntersecting: visible,
          intersectionRatio: visible ? 1 : 0,
          boundingClientRect: document.documentElement.getBoundingClientRect(),
          intersectionRect: document.documentElement.getBoundingClientRect(),
          rootBounds: null,
          time: performance.now(),
        },
      ],
      {} as IntersectionObserver
    )
  );
};
function SoundTestView({ showButton = true }: { showButton?: boolean }) {
  useSoundPlayback();
  return (
    <>
      {showButton && <SoundButton variant="input" />}
      <button>Open Settings</button>
      <input aria-label="Guess Word" />
      <button onClick={startSoundOnGuess}>Guess</button>
    </>
  );
}
const mount = async () => {
  await act(() => render(<SoundTestView />, container));
  await intersect(true);
};

it('keeps new players muted through guesses until they enable sound, then stops offscreen', async () => {
  const visibility = vi.spyOn(gameAudio, 'setVisible');
  try {
    await mount();
    await expect.poll(() => soundPreference.ready.value).toBe(true);
    const sound = container.querySelector('[data-sound-toggle]')!;
    expect(soundEnabled.value).toBe(false);
    expect(sound.getAttribute('data-audio-playback')).toBe('muted');
    await page.getByRole('button', { name: 'Open Settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Guess Word' }).fill('apple');
    expect(enable).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Guess', exact: true }).click();
    expect(enable).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Turn on music and sound effects' }).click();
    await expect.poll(() => sound.getAttribute('data-audio-playback')).toBe('playing');
    expect(enable).toHaveBeenCalledTimes(1);
    await intersect(false);
    window.dispatchEvent(new Event('focus'));
    expect(visibility).toHaveBeenLastCalledWith(false);
    expect(sound.getAttribute('data-audio-playback')).toBe('offscreen');
    await act(() => render(null, container));
    expect(soundEnabled.value).toBe(true);
  } finally {
    visibility.mockRestore();
  }
});

it('waits for the saved preference and never starts sound for a returning muted player', async () => {
  soundEnabled.value = true;
  let finish: (value: { enabled: boolean | null }) => void = () => {};
  vi.mocked(trpc.audioSettings.get.query).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve))
  );
  await mount();
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  expect(enable).not.toHaveBeenCalled();
  expect(unlock).toHaveBeenCalledTimes(1);
  finish({ enabled: false });
  await expect.poll(() => soundEnabled.value).toBe(false);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  expect(enable).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Turn on music and sound effects' }).click();
  expect(enable).toHaveBeenCalledTimes(1);
  expect(trpc.audioSettings.set.mutate).toHaveBeenCalledWith({ enabled: true });
});

it('starts from the first guess after a slow preference read confirms sound is allowed', async () => {
  soundEnabled.value = true;
  let finish: (value: { enabled: boolean | null }) => void = () => {};
  vi.mocked(trpc.audioSettings.get.query).mockImplementationOnce(
    () => new Promise((resolve) => (finish = resolve))
  );
  await mount();
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  expect(unlock).toHaveBeenCalledTimes(1);
  expect(enable).not.toHaveBeenCalled();
  finish({ enabled: true });
  await expect.poll(() => enable.mock.calls.length).toBe(1);
});

it('preserves an existing browser mute when there is no server choice, and saves explicit mutes', async () => {
  soundEnabled.value = false;
  await mount();
  await expect.poll(() => soundPreference.ready.value).toBe(true);
  expect(soundEnabled.value).toBe(false);
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  expect(enable).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Turn on music and sound effects' }).click();
  await page.getByRole('button', { name: 'Mute music and sound effects' }).click();
  expect(soundEnabled.value).toBe(false);
  expect(trpc.audioSettings.set.mutate).toHaveBeenLastCalledWith({ enabled: false });
});

it('restores an explicit account opt-in while keeping page load silent', async () => {
  vi.mocked(trpc.audioSettings.get.query).mockResolvedValue({ enabled: true });
  await mount();
  await expect.poll(() => soundEnabled.value).toBe(true);
  expect(enable).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Guess', exact: true }).click();
  expect(enable).toHaveBeenCalledTimes(1);
});

it('keeps playback alive when the input sound button disappears on results', async () => {
  const disable = vi.spyOn(gameAudio, 'disable');
  try {
    await mount();
    await page.getByRole('button', { name: 'Turn on music and sound effects' }).click();
    const before = disable.mock.calls.length;
    await act(() => render(<SoundTestView showButton={false} />, container));
    expect(container.querySelector('[data-sound-toggle]')).toBeNull();
    expect(disable).toHaveBeenCalledTimes(before);
    expect(soundEnabled.value).toBe(true);
  } finally {
    disable.mockRestore();
  }
});
