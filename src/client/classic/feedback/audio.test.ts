import { describe, expect, it, vi } from 'vitest';
import {
  createGameAudio,
  guessTemperature,
  MUSIC_TRACKS,
  VICTORY_MUSIC,
  VICTORY_APPLAUSE,
  soundEnabled,
  type AudioPreferences,
} from './audio';
import { bestGuessHeat, getRankEmoji } from '../../shared/guessHeat';

vi.mock('@devvit/web/client', () => {
  // This was written even for players who never opted in under the old default.
  localStorage.setItem('hotandcold:sound:v1:community:t2_audio_test', 'true');
  return { context: { userId: 't2_audio_test' } };
});

const settings: AudioPreferences = { music: true, effects: true, motion: true, volume: 0.25 };
function setup() {
  const sources: Array<ReturnType<typeof makeSource>> = [];
  const gains: Array<ReturnType<typeof makeGain>> = [];
  function makeSource() {
    return {
      buffer: null as AudioBuffer | null,
      loop: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null as (() => void) | null,
    };
  }
  function makeGain() {
    return {
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => ({
      url: new TextDecoder().decode(data),
      duration: 60,
    })),
    createBufferSource: () => {
      const source = makeSource();
      sources.push(source);
      return source;
    },
    createGain: () => {
      const gain = makeGain();
      gains.push(gain);
      return gain;
    },
  };
  const createContext = vi.fn(() => ctx as unknown as AudioContext);
  const fetchAudio = vi.fn(async (url: string) => new TextEncoder().encode(url).buffer);
  const audio = createGameAudio({ createContext, fetchAudio });
  return { audio, ctx, createContext, fetchAudio, sources, gains };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('guess-started game audio', () => {
  it('defaults to muted without treating the old cached sound-on default as an opt-in', async () => {
    const { audio, createContext, fetchAudio } = setup();
    expect(soundEnabled.value).toBe(false);
    audio.update(settings);
    audio.setVisible(true);
    await audio.setLevel(2);
    await audio.cue('warmer');
    expect(createContext).not.toHaveBeenCalled();
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('unlocks one context before downloads and starts only quiet Exploration plus effects', async () => {
    const { audio, ctx, fetchAudio, createContext, sources, gains } = setup();
    expect(await audio.enable(settings)).toBe(true);
    expect(ctx.resume.mock.invocationCallOrder[0]).toBeLessThan(
      fetchAudio.mock.invocationCallOrder[0]!
    );
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(fetchAudio.mock.calls.map(([url]) => url)).toEqual([
      MUSIC_TRACKS[0],
      '/audio/warmer.wav',
      '/audio/colder.wav',
    ]);
    expect(sources[0]!.loop).toBe(true);
    expect(gains[0]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.075, 0.6);
    await audio.cue('warmer');
    expect(sources[1]!.loop).toBe(false);
    expect(gains[1]!.gain.value).toBeCloseTo(0.175);
    await audio.enable(settings);
    expect(sources).toHaveLength(2);
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  it('can unlock a first guess silently while waiting for preferences, then honor a mute', async () => {
    const { audio, createContext, fetchAudio, sources } = setup();
    expect(await audio.unlock()).toBe(true);
    expect(createContext).toHaveBeenCalledTimes(1);
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    audio.disable();
    await audio.setLevel(2);
    await audio.cue('warmer');
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('crossfades at the sun and fire milestones without restarting on colder or repeated guesses', async () => {
    const { audio, ctx, sources, gains, fetchAudio } = setup();
    await audio.enable(settings);
    await audio.setLevel(bestGuessHeat([{ rank: 1000 }]));
    expect(sources[0]!.stop).toHaveBeenCalledWith(0.6);
    expect(sources[1]!.buffer).toMatchObject({ url: MUSIC_TRACKS[1] });
    expect(gains[0]!.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 0.6);
    await audio.setLevel(bestGuessHeat([{ rank: 1000 }, { rank: 5000 }]));
    expect(sources).toHaveLength(2);
    ctx.currentTime = 10;
    await audio.setLevel(bestGuessHeat([{ rank: 1000 }, { rank: 250 }]));
    expect(sources[2]!.buffer).toMatchObject({ url: MUSIC_TRACKS[2] });
    expect(sources[1]!.stop).toHaveBeenCalledWith(10.6);
    await audio.setLevel(2);
    expect(sources).toHaveLength(3);
    expect(fetchAudio.mock.calls.filter(([url]) => url.endsWith('.mp3'))).toHaveLength(3);
  });

  it('restores the best milestone silently and skips straight to fire if the first guess is very hot', async () => {
    const { audio, fetchAudio, sources } = setup();
    await audio.setLevel(bestGuessHeat([{ rank: 100 }, { rank: 5000 }]));
    expect(fetchAudio).not.toHaveBeenCalled();
    await audio.enable(settings);
    expect(sources[0]!.buffer).toMatchObject({ url: MUSIC_TRACKS[2] });
    expect(fetchAudio).not.toHaveBeenCalledWith(MUSIC_TRACKS[0]);
    expect(fetchAudio).not.toHaveBeenCalledWith(MUSIC_TRACKS[1]);
  });

  it('stops music, crossfades, and effects immediately on mute and suppresses later cues', async () => {
    const { audio, sources } = setup();
    await audio.enable(settings);
    await audio.setLevel(1);
    await audio.cue('warmer');
    audio.disable();
    for (const source of sources) expect(source.stop).toHaveBeenLastCalledWith();
    await audio.cue('colder');
    await audio.setLevel(2);
    expect(sources).toHaveLength(3);
  });

  it('pauses offscreen, suppresses hidden effects, and resumes the current track at its saved position', async () => {
    const { audio, ctx, sources } = setup();
    await audio.enable(settings);
    ctx.currentTime = 12;
    audio.setVisible(false);
    expect(sources[0]!.stop).toHaveBeenCalled();
    await audio.cue('colder');
    expect(sources).toHaveLength(1);
    ctx.currentTime = 30;
    audio.setVisible(true);
    await flush();
    expect(sources[1]!.start).toHaveBeenCalledWith(30, 12);
  });

  it('does not create audio while offscreen or start a download that finishes after scrolling away', async () => {
    const { audio, createContext, fetchAudio, sources } = setup();
    audio.setVisible(false);
    expect(await audio.enable(settings)).toBe(false);
    expect(createContext).not.toHaveBeenCalled();
    audio.setVisible(true);
    let finish: (data: ArrayBuffer) => void = () => {};
    fetchAudio.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pending = audio.enable(settings);
    await Promise.resolve();
    audio.setVisible(false);
    finish(new ArrayBuffer(0));
    expect(await pending).toBe(false);
    expect(sources).toHaveLength(0);
  });

  it('does not start pending music after mute, or a stale lower tier after a hotter download wins', async () => {
    const { audio, fetchAudio, sources } = setup();
    await audio.enable(settings);
    let finish: (data: ArrayBuffer) => void = () => {};
    fetchAudio.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const warm = audio.setLevel(1);
    await audio.setLevel(2);
    finish(new ArrayBuffer(0));
    await warm;
    expect(sources).toHaveLength(2);
    expect(sources[1]!.buffer).toMatchObject({ url: MUSIC_TRACKS[2] });
    audio.disable();
    fetchAudio.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await audio.setLevel(0);
    const pending = audio.enable(settings);
    audio.disable();
    finish(new ArrayBuffer(0));
    await pending;
    expect(sources).toHaveLength(2);
  });

  it('keeps music and effects independent and avoids loading disabled media', async () => {
    const { audio, fetchAudio, sources } = setup();
    await audio.enable({ ...settings, music: false, effects: false });
    expect(fetchAudio).not.toHaveBeenCalled();
    await audio.cue('warmer');
    expect(sources).toHaveLength(0);
    audio.update({ ...settings, music: false });
    await audio.cue('warmer');
    expect(sources).toHaveLength(1);
    audio.update(settings);
    await flush();
    expect(sources[1]!.loop).toBe(true);
    audio.update({ ...settings, music: false });
    expect(sources[1]!.stop).toHaveBeenCalled();
  });

  it('recovers from blocked audio and retries a failed track download without affecting gameplay', async () => {
    const { audio, ctx, fetchAudio, sources } = setup();
    ctx.resume.mockRejectedValueOnce(new Error('blocked'));
    expect(await audio.enable(settings)).toBe(false);
    await audio.cue('warmer');
    expect(sources).toHaveLength(0);
    expect(await audio.enable(settings)).toBe(true);
    fetchAudio.mockRejectedValueOnce(new Error('offline'));
    await audio.setLevel(1);
    expect(sources).toHaveLength(1);
    expect(await audio.enable(settings)).toBe(true);
    expect(sources[1]!.buffer).toMatchObject({ url: MUSIC_TRACKS[1] });
  });
});

it.each(MUSIC_TRACKS)('ships a complete, browser-decodable music track: %s', async (url) => {
  // Decode offline: verifies the actual bundled files without playing audible test music.
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  const decoder = new OfflineAudioContext(2, 1, 44100);
  const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
  expect(buffer.duration).toBeGreaterThan(20);
  expect(buffer.numberOfChannels).toBeGreaterThan(0);
  const samples = buffer.getChannelData(0);
  expect(samples.some((sample) => Math.abs(sample) > 0.05)).toBe(true);
});

describe('result audio', () => {
  it('ends the loop with one fanfare and applause, then stays silent on reopening or returning', async () => {
    const { audio, sources, fetchAudio } = setup();
    await audio.enable(settings);
    await audio.cue('warmer');
    await audio.finish('win', true);
    expect(sources[0]!.stop).toHaveBeenCalled();
    expect(sources[1]!.stop).toHaveBeenCalled();
    expect(sources.slice(2).map((source) => source.buffer)).toEqual([
      expect.objectContaining({ url: VICTORY_MUSIC }),
      expect.objectContaining({ url: VICTORY_APPLAUSE }),
    ]);
    expect(sources.slice(2).every((source) => !source.loop)).toBe(true);
    await audio.finish('win');
    await audio.finish('win', true);
    await audio.cue('warmer');
    await audio.setLevel(2);
    audio.setVisible(false);
    expect(sources[2]!.stop).toHaveBeenCalled();
    expect(sources[3]!.stop).toHaveBeenCalled();
    audio.setVisible(true);
    audio.disable();
    await audio.enable(settings);
    expect(sources).toHaveLength(4);
    expect(fetchAudio.mock.calls.filter(([url]) => url === VICTORY_MUSIC)).toHaveLength(1);
  });

  it('keeps Give Up and restored results silent, including after sound is enabled', async () => {
    for (const outcome of ['win', 'give-up'] as const) {
      const { audio, sources, fetchAudio } = setup();
      await audio.finish(outcome);
      await audio.enable(settings);
      await audio.cue('colder');
      expect(sources).toHaveLength(0);
      expect(fetchAudio).not.toHaveBeenCalledWith(VICTORY_APPLAUSE);
      expect(fetchAudio).not.toHaveBeenCalledWith(VICTORY_MUSIC);
    }
    const { audio, sources } = setup();
    await audio.enable(settings);
    await audio.finish('give-up');
    expect(sources[0]!.stop).toHaveBeenCalled();
    await audio.setLevel(2);
    expect(sources).toHaveLength(1);
  });

  it('honors music and effect switches separately for celebrations', async () => {
    for (const kind of ['music', 'effects'] as const) {
      const { audio, sources, fetchAudio } = setup();
      await audio.enable({ ...settings, music: kind === 'music', effects: kind === 'effects' });
      await audio.finish('win', true);
      const chosen = kind === 'music' ? VICTORY_MUSIC : VICTORY_APPLAUSE;
      const skipped = kind === 'music' ? VICTORY_APPLAUSE : VICTORY_MUSIC;
      expect(sources.at(-1)!.buffer).toMatchObject({ url: chosen });
      expect(fetchAudio).not.toHaveBeenCalledWith(skipped);
      audio.disable();
      expect(sources.at(-1)!.stop).toHaveBeenCalled();
    }
  });

  it('does not let a late looping track or celebration download restart after results or mute', async () => {
    const { audio, fetchAudio, sources } = setup();
    await audio.enable(settings);
    let finish: (data: ArrayBuffer) => void = () => {};
    fetchAudio.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pendingTier = audio.setLevel(2);
    await audio.finish('win', true);
    finish(new ArrayBuffer(0));
    await pendingTier;
    expect(sources).toHaveLength(3);
    expect(sources.slice(1).every((source) => !source.loop)).toBe(true);

    const other = setup();
    await other.audio.enable(settings);
    other.fetchAudio.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const pendingWin = other.audio.finish('win', true);
    other.audio.disable();
    finish(new ArrayBuffer(0));
    await pendingWin;
    expect(other.sources).toHaveLength(1);
  });

  it('can celebrate a first-guess win while the original audio unlock is still pending', async () => {
    const { audio, ctx, sources } = setup();
    let resume: () => void = () => {};
    ctx.resume.mockImplementationOnce(() => new Promise<void>((resolve) => (resume = resolve)));
    const enabling = audio.enable(settings);
    await audio.finish('win'); // Results may mount before the submission promise resolves.
    await audio.finish('win', true);
    expect(sources).toHaveLength(0);
    resume();
    expect(await enabling).toBe(true);
    expect(sources.map((source) => source.buffer)).toEqual([
      expect.objectContaining({ url: VICTORY_MUSIC }),
      expect.objectContaining({ url: VICTORY_APPLAUSE }),
    ]);
  });
});

it.each([VICTORY_MUSIC, VICTORY_APPLAUSE])('ships a short, audible one-shot: %s', async (url) => {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(
    await response.arrayBuffer()
  );
  expect(buffer.duration).toBeGreaterThan(1);
  expect(buffer.duration).toBeLessThan(12);
  expect(buffer.getChannelData(0).some((sample) => Math.abs(sample) > 0.05)).toBe(true);
});

describe('soundtrack milestone boundaries', () => {
  it.each([
    [1001, null, 0],
    [1000, '☀️', 1],
    [251, '☀️', 1],
    [250, '🔥', 2],
    [1, '🔥', 2],
    [0, null, 0],
    [-1, null, 0],
    [NaN, null, 0],
    [Infinity, null, 0],
  ] as const)('uses the same heat for rank %s emojis and music', (rank, emoji, level) => {
    expect(getRankEmoji(rank)).toBe(emoji);
    expect(bestGuessHeat([{ rank }])).toBe(level);
  });
  it('resets to Exploration for a fresh run and ignores a Give Up answer reveal', () => {
    expect(bestGuessHeat([])).toBe(0);
    expect(bestGuessHeat([{ rank: 5000 }, { rank: 0 }])).toBe(0);
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
