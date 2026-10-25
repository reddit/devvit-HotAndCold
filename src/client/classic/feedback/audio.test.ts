import { describe, expect, it, vi } from 'vitest';
import { createGameAudio, guessTemperature, soundEnabled, type AudioPreferences } from './audio';

const settings: AudioPreferences = { music: true, effects: true, motion: true, volume: 0.25 };
function setup() {
  const assets = new Map<string, ReturnType<typeof media>>();
  function media() {
    return {
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
      volume: 1,
      muted: false,
      currentTime: 0,
      loop: false,
      preload: 'none' as const,
    };
  }
  const create = vi.fn((url: string) => {
    const audio = media();
    assets.set(url, audio);
    return audio;
  });
  return { audio: createGameAudio(create), create, assets };
}

describe('opt-in game audio', () => {
  it('starts muted and does not create or load media before opting in', () => {
    const { audio, create } = setup();
    expect(soundEnabled.value).toBe(false);
    audio.update(settings);
    audio.setVisible(true);
    audio.cue('warmer');
    expect(create).not.toHaveBeenCalled();
  });

  it('plays quiet music only after enabling and stops all playback when muted', async () => {
    const { audio, assets } = setup();
    expect(await audio.enable(settings)).toBe(true);
    const music = assets.get('/audio/calm-loop.mp3')!;
    const warmer = assets.get('/audio/warmer.wav')!;
    expect(music.loop).toBe(true);
    expect(music.volume).toBeCloseTo(0.075);
    warmer.play.mockClear();
    audio.cue('warmer');
    expect(warmer.play).toHaveBeenCalledTimes(1);
    audio.disable();
    audio.cue('warmer');
    expect(music.pause).toHaveBeenCalled();
    expect(warmer.play).toHaveBeenCalledTimes(1);
  });

  it('pauses hidden tabs, suppresses hidden effects, and resumes opted-in music', async () => {
    const { audio, assets } = setup();
    await audio.enable(settings);
    const music = assets.get('/audio/calm-loop.mp3')!;
    const colder = assets.get('/audio/colder.wav')!;
    colder.play.mockClear();
    audio.setVisible(false);
    audio.cue('colder');
    expect(music.pause).toHaveBeenCalled();
    expect(colder.play).not.toHaveBeenCalled();
    audio.setVisible(true);
    expect(music.play).toHaveBeenCalledTimes(2);
  });

  it('allows music and effects to be controlled independently', async () => {
    const { audio, assets } = setup();
    await audio.enable({ ...settings, music: false, effects: false });
    expect(assets.has('/audio/calm-loop.mp3')).toBe(false);
    const warmer = assets.get('/audio/warmer.wav')!;
    warmer.play.mockClear();
    audio.cue('warmer');
    expect(warmer.play).not.toHaveBeenCalled();
    audio.update({ ...settings, music: false });
    audio.cue('warmer');
    expect(warmer.play).toHaveBeenCalledTimes(1);
  });

  it('handles browser playback rejection without throwing or playing subsequent effects', async () => {
    const { audio, create, assets } = setup();
    create.mockImplementationOnce((url) => {
      const media = {
        play: vi.fn().mockRejectedValue(new Error('autoplay blocked')),
        pause: vi.fn(),
        load: vi.fn(),
        volume: 1,
        muted: false,
        currentTime: 0,
        loop: false,
        preload: 'none' as const,
      };
      assets.set(url, media);
      return media;
    });
    expect(await audio.enable(settings)).toBe(false);
    const warmer = assets.get('/audio/warmer.wav')!;
    warmer.play.mockClear();
    audio.cue('warmer');
    expect(warmer.play).not.toHaveBeenCalled();
  });

  it('does not restart music when muted while its first play request is pending', async () => {
    const { audio, create, assets } = setup();
    let finish: () => void = () => {};
    create.mockImplementationOnce((url) => {
      const media = {
        play: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finish = resolve;
            })
        ),
        pause: vi.fn(),
        load: vi.fn(),
        volume: 1,
        muted: false,
        currentTime: 0,
        loop: false,
        preload: 'none' as const,
      };
      assets.set(url, media);
      return media;
    });
    const pending = audio.enable(settings);
    audio.disable();
    finish();
    expect(await pending).toBe(false);
    expect(assets.get('/audio/calm-loop.mp3')!.pause).toHaveBeenCalledTimes(2);
  });
});

describe('relative guess temperature', () => {
  it.each([
    [undefined, 100, null],
    [null, 100, null],
    [-1, 100, null],
    [100, null, null],
    [100, -1, null],
    [100, 100, null],
    [1000, 200, 'warmer'],
    [200, 1000, 'colder'],
    [1, 0, 'warmer'],
  ] as const)('compares previous rank %s with %s: %s', (previous, current, expected) => {
    expect(guessTemperature(previous, current)).toBe(expected);
  });
});
