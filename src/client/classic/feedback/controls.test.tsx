import { render } from 'preact';
import { act } from 'preact/test-utils';
import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { SoundButton } from './controls';
import { gameAudio, soundEnabled } from './audio';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_sound_controls' },
  showToast: vi.fn(),
}));
vi.mock('../../trpc', () => ({
  trpc: {
    audioSettings: {
      get: { query: async () => ({ enabled: true }) },
      set: { mutate: vi.fn().mockResolvedValue({}) },
    },
  },
}));

it('restores the saved choice without autoplay, starts after a game interaction, and preserves it on unmount', async () => {
  let report: IntersectionObserverCallback = () => {};
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
  const enable = vi.spyOn(gameAudio, 'enable').mockResolvedValue(true);
  const visibility = vi.spyOn(gameAudio, 'setVisible');
  const container = document.createElement('div');
  document.body.append(container);
  soundEnabled.value = false;
  try {
    await act(() =>
      render(
        <>
          <SoundButton />
          <button>Interact With Game</button>
        </>,
        container
      )
    );
    await expect.poll(() => soundEnabled.value).toBe(true);
    const intersect = async (value: boolean) => {
      await act(() =>
        report(
          [
            {
              target: document.documentElement,
              isIntersecting: value,
              intersectionRatio: value ? 1 : 0,
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
    await intersect(true);
    const sound = container.querySelector('[data-sound-toggle]')!;
    expect(sound.getAttribute('data-audio-playback')).toBe('awaiting-interaction');
    expect(enable).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Interact With Game', exact: true }).click();
    await expect.poll(() => sound.getAttribute('data-audio-playback')).toBe('playing');
    expect(enable).toHaveBeenCalledTimes(1);
    await intersect(false);
    window.dispatchEvent(new Event('focus'));
    expect(visibility).toHaveBeenLastCalledWith(false);
    expect(sound.getAttribute('data-audio-playback')).toBe('offscreen');
    await act(() => render(null, container));
    expect(soundEnabled.value).toBe(true);
  } finally {
    await act(() => render(null, container));
    container.remove();
    soundEnabled.value = false;
    enable.mockRestore();
    visibility.mockRestore();
    vi.unstubAllGlobals();
  }
});
