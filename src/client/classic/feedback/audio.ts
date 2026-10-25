import { context } from '@devvit/web/client';
import { localStorageSignal } from '../../utils/localStorageSignal';

export type Temperature = 'warmer' | 'colder';
export type AudioPreferences = {
  music: boolean;
  effects: boolean;
  motion: boolean;
  volume: number;
};
export const audioPreferences = localStorageSignal<AudioPreferences>({
  key: 'hotandcold:audio:v1',
  initialValue: { music: true, effects: true, motion: true, volume: 0.25 },
});
export const soundEnabled = localStorageSignal<boolean>({
  key: `hotandcold:sound:v1:${context.subredditId ?? context.subredditName ?? 'community'}:${context.userId ?? 'guest'}`,
  initialValue: false,
  serializer: { read: (raw) => JSON.parse(raw) === true, write: JSON.stringify },
});

type Media = Pick<
  HTMLAudioElement,
  'play' | 'pause' | 'load' | 'volume' | 'muted' | 'currentTime' | 'loop' | 'preload'
>;

export function createGameAudio(makeAudio: (url: string) => Media = (url) => new Audio(url)) {
  let enabled = false;
  let visible = true;
  let generation = 0;
  let settings: AudioPreferences = { music: true, effects: true, motion: true, volume: 0.25 };
  let music: Media | undefined;
  const effects: Partial<Record<Temperature, Media>> = {};

  const pauseAll = () => {
    music?.pause();
    effects.warmer?.pause();
    effects.colder?.pause();
  };
  const volume = () => {
    const level = Math.max(0, Math.min(1, settings.volume));
    if (music) music.volume = level * 0.3;
    for (const effect of Object.values(effects)) effect.volume = level * 0.7;
  };
  const ensureMusic = () => {
    music ??= makeAudio('/audio/calm-loop.mp3');
    music.loop = true;
    music.preload = 'none';
    volume();
    return music;
  };
  const playMusic = async () => {
    const track = ensureMusic();
    await track.play();
    // A pending play promise can settle after a scroll-away or mute event.
    if (!enabled || !visible || !settings.music) track.pause();
  };

  return {
    async enable(preferences: AudioPreferences): Promise<boolean> {
      if (!visible) return false;
      settings = preferences;
      enabled = true;
      const attempt = ++generation;
      const starts: Promise<void>[] = [];
      if (settings.music) starts.push(playMusic());
      // Prime these same elements in the user's click gesture for mobile audio.
      for (const direction of ['warmer', 'colder'] as const) {
        const effect = (effects[direction] ??= makeAudio(`/audio/${direction}.wav`));
        effect.muted = true;
        starts.push(
          effect.play().then(() => {
            effect.pause();
            effect.currentTime = 0;
            effect.muted = false;
          })
        );
      }
      volume();
      try {
        await Promise.all(starts);
        if (generation !== attempt) {
          if (!enabled) pauseAll();
          return false;
        }
        if (!visible) pauseAll();
        return true;
      } catch {
        if (generation === attempt) {
          enabled = false;
          pauseAll();
        }
        return false;
      }
    },
    disable() {
      enabled = false;
      generation++;
      pauseAll();
    },
    update(preferences: AudioPreferences) {
      const startMusic = enabled && visible && !settings.music && preferences.music;
      settings = preferences;
      volume();
      if (!settings.music) music?.pause();
      if (!settings.effects) {
        effects.warmer?.pause();
        effects.colder?.pause();
      }
      if (startMusic) void playMusic().catch(() => {});
    },
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      if (!value) pauseAll();
      else if (enabled && settings.music) void playMusic().catch(() => {});
    },
    cue(direction: Temperature) {
      if (!enabled || !visible || !settings.effects) return;
      const effect = effects[direction];
      if (!effect) return;
      effects.warmer?.pause();
      effects.colder?.pause();
      effect.currentTime = 0;
      effect.muted = false;
      void effect.play().catch(() => {});
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
