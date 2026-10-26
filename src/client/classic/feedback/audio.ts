import { context } from '@devvit/web/client';
import { localStorageSignal } from '../../utils/localStorageSignal';
import type { GuessHeat } from '../../shared/guessHeat';

export type Temperature = 'warmer' | 'colder';
export type AudioPreferences = {
  music: boolean;
  effects: boolean;
  motion: boolean;
  volume: number;
};
export const audioPreferences = localStorageSignal<AudioPreferences>({
  key: 'hotandcold:audio:v1',
  initialValue: { music: true, effects: true, motion: true, volume: 0.5 },
});
export const soundEnabled = localStorageSignal<boolean>({
  key: `hotandcold:sound:v1:${context.subredditId ?? context.subredditName ?? 'community'}:${context.userId ?? 'guest'}`,
  // Retain existing browser mute choices; new players start sound on their first guess.
  initialValue: true,
  serializer: { read: (raw) => JSON.parse(raw) === true, write: JSON.stringify },
});

export const MUSIC_TRACKS = [
  '/audio/exploration.mp3',
  '/audio/stage-select.mp3',
  '/audio/boss-fight.mp3',
] as const;
export const VICTORY_MUSIC = '/audio/victory.mp3';
export const VICTORY_APPLAUSE = '/audio/applause.wav';
const CROSSFADE_SECONDS = 0.6;

type Voice = { source: AudioBufferSourceNode; gain: GainNode };
type MusicVoice = Voice & {
  level: GuessHeat;
  buffer: AudioBuffer;
  startedAt: number;
  offset: number;
};
type AudioDependencies = {
  createContext?: () => AudioContext;
  fetchAudio?: (url: string) => Promise<ArrayBuffer>;
};

export function createGameAudio({
  createContext = () => new AudioContext(),
  fetchAudio = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Audio unavailable');
    return response.arrayBuffer();
  },
}: AudioDependencies = {}) {
  let audioContext: AudioContext | undefined;
  let enabled = false;
  let unlocked = false;
  let visible = true;
  let generation = 0;
  let cueSequence = 0;
  let level: GuessHeat = 0;
  let result: 'win' | 'give-up' | null = null;
  let victoryRequested = false;
  let victoryStarted = false;
  let settings: AudioPreferences = { music: true, effects: true, motion: true, volume: 0.5 };
  let music: MusicVoice | undefined;
  const musicVoices = new Set<Voice>();
  const effectVoices = new Set<Voice>();
  const offsets = [0, 0, 0];
  const buffers = new Map<string, Promise<AudioBuffer>>();
  const volume = (scale: number) => Math.max(0, Math.min(1, settings.volume)) * scale;

  const loadBuffer = (url: string) => {
    let pending = buffers.get(url);
    if (!pending) {
      pending = fetchAudio(url)
        .then((data) => audioContext!.decodeAudioData(data))
        .catch((error) => {
          buffers.delete(url);
          throw error;
        });
      buffers.set(url, pending);
    }
    return pending;
  };
  const stopVoices = (voices: Set<Voice>) => {
    for (const voice of voices) {
      voice.source.stop();
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    voices.clear();
  };
  const stopMusic = () => {
    if (music && audioContext) {
      offsets[music.level] =
        (music.offset + audioContext.currentTime - music.startedAt) % music.buffer.duration;
    }
    music = undefined;
    stopVoices(musicVoices);
  };
  const stopEffects = () => {
    cueSequence++;
    stopVoices(effectVoices);
  };
  const makeVoice = (buffer: AudioBuffer, voices: Set<Voice>) => {
    const ctx = audioContext!;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    const voice = { source, gain };
    voices.add(voice);
    source.onended = () => {
      voices.delete(voice);
      source.disconnect();
      gain.disconnect();
    };
    return voice;
  };
  const playMusic = async () => {
    if (
      !enabled ||
      !unlocked ||
      !visible ||
      !settings.music ||
      result !== null ||
      !audioContext ||
      music?.level === level
    )
      return;
    const requested = level;
    const attempt = generation;
    const buffer = await loadBuffer(MUSIC_TRACKS[requested]);
    // Downloads can finish after muting, leaving the post, or reaching a hotter tier.
    if (
      !enabled ||
      !visible ||
      !settings.music ||
      result !== null ||
      generation !== attempt ||
      level !== requested ||
      music?.level === requested
    )
      return;
    const ctx = audioContext;
    const previous = music;
    const voice = makeVoice(buffer, musicVoices);
    const now = ctx.currentTime;
    const offset = offsets[requested] ?? 0;
    voice.source.loop = true;
    voice.gain.gain.setValueAtTime(0, now);
    voice.gain.gain.linearRampToValueAtTime(volume(0.3), now + CROSSFADE_SECONDS);
    voice.source.start(now, offset);
    music = { ...voice, level: requested, buffer, startedAt: now, offset };
    if (previous) {
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(previous.gain.gain.value, now);
      previous.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SECONDS);
      previous.source.stop(now + CROSSFADE_SECONDS);
    }
  };

  const playVictory = async () => {
    if (!victoryRequested || victoryStarted || !enabled || !unlocked || !visible) return;
    victoryRequested = false;
    victoryStarted = true;
    const attempt = generation;
    const loaded = await Promise.all(
      (
        [
          { url: VICTORY_MUSIC, kind: 'music', voices: musicVoices, scale: 0.45 },
          { url: VICTORY_APPLAUSE, kind: 'effects', voices: effectVoices, scale: 0.7 },
        ] as const
      ).map(async ({ url, kind, voices, scale }) => {
        if (!settings[kind]) return null;
        try {
          const buffer = await loadBuffer(url);
          return { buffer, kind, voices, scale };
        } catch {
          // Keep results usable if either optional celebration asset is unavailable.
          return null;
        }
      })
    );
    if (!enabled || !visible || result !== 'win' || generation !== attempt) return;
    for (const asset of loaded) {
      if (!asset || !settings[asset.kind]) continue;
      const voice = makeVoice(asset.buffer, asset.voices);
      voice.gain.gain.value = volume(asset.scale);
      // Start together, once. Returning to the post must never replay a win.
      voice.source.start();
    }
  };

  const unlock = async () => {
    if (!visible) return false;
    try {
      audioContext ??= createContext();
      // Resume inside the original user gesture, even if preference restoration
      // is still pending. This creates no sources, downloads, or audible output.
      await audioContext.resume();
      unlocked = true;
      return visible;
    } catch {
      unlocked = false;
      return false;
    }
  };

  return {
    unlock,
    async enable(preferences: AudioPreferences): Promise<boolean> {
      if (!visible) return false;
      settings = preferences;
      enabled = true;
      const attempt = generation;
      try {
        // One context lets later track changes work without another audio gesture.
        if (!(await unlock())) return false;
        if (!enabled || !visible || generation !== attempt) return false;
        await Promise.all([
          playMusic(),
          playVictory(),
          ...(settings.effects && result === null
            ? ['warmer', 'colder'].map((direction) =>
                loadBuffer(`/audio/${direction}.wav`).catch(() => {})
              )
            : []),
        ]);
        return enabled && visible && generation === attempt;
      } catch {
        if (generation === attempt && !music) {
          enabled = false;
          stopEffects();
        }
        // If a hotter track fails to load, keep the current track and retry next guess.
        return enabled && visible && Boolean(music);
      }
    },
    disable() {
      enabled = false;
      generation++;
      victoryRequested = false;
      stopMusic();
      stopEffects();
    },
    update(preferences: AudioPreferences) {
      settings = preferences;
      if (music && audioContext) {
        music.gain.gain.cancelScheduledValues(audioContext.currentTime);
        music.gain.gain.setValueAtTime(volume(0.3), audioContext.currentTime);
      }
      if (result === 'win') for (const voice of musicVoices) voice.gain.gain.value = volume(0.45);
      for (const voice of effectVoices) voice.gain.gain.value = volume(0.7);
      if (!settings.music) stopMusic();
      else void playMusic().catch(() => {});
      if (!settings.effects) stopEffects();
    },
    setLevel(next: GuessHeat) {
      if (level === next) return Promise.resolve();
      level = next;
      return playMusic().catch(() => {});
    },
    finish(next: 'win' | 'give-up', celebrate = false) {
      if (result !== next) {
        result = next;
        stopMusic();
        stopEffects();
      }
      // Loading/reopening results is silent. Only a new winning submission celebrates.
      if (next === 'win' && celebrate && visible && !victoryStarted) victoryRequested = true;
      return playVictory();
    },
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      if (!value) {
        generation++;
        victoryRequested = false;
        stopMusic();
        stopEffects();
      } else void playMusic().catch(() => {});
    },
    async cue(direction: Temperature) {
      if (!enabled || !unlocked || !visible || !settings.effects || result !== null) return;
      const attempt = generation;
      const sequence = ++cueSequence;
      try {
        const buffer = await loadBuffer(`/audio/${direction}.wav`);
        if (
          !enabled ||
          !visible ||
          !settings.effects ||
          result !== null ||
          attempt !== generation ||
          sequence !== cueSequence
        )
          return;
        stopVoices(effectVoices);
        const voice = makeVoice(buffer, effectVoices);
        voice.gain.gain.value = volume(0.7);
        voice.source.start();
      } catch {
        // Audio is optional; a missing effect must never interrupt a guess.
      }
    },
  };
}

export const gameAudio = createGameAudio();

export function guessTemperature(
  previousRank: number | null | undefined,
  rank: number | null
): Temperature | null {
  if (previousRank == null || rank == null || previousRank < 0 || rank < 0 || previousRank === rank)
    return null;
  return rank < previousRank ? 'warmer' : 'colder';
}
