import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { showToast } from '@devvit/web/client';
import { IconButton } from '../../shared/button';
import { audioPreferences, gameAudio, soundEnabled } from './audio';
import type { Temperature } from './audio';
import { GuessTemperature, TEMPERATURE_FEEDBACK_MS } from './temperature';
import { SpeakerIcon } from '../icons';

let toggleSequence = 0;
export async function toggleSound() {
  const attempt = ++toggleSequence;
  if (soundEnabled.value) {
    gameAudio.disable();
    soundEnabled.value = false;
    return;
  }
  soundEnabled.value = true;
  const success = await gameAudio.enable(audioPreferences.value);
  if (attempt !== toggleSequence) return;
  soundEnabled.value = success;
  if (!success) showToast({ text: 'Audio could not start. Tap the sound button to try again.' });
}

export function SoundButton() {
  useEffect(() => {
    const unsubscribe = effect(() => gameAudio.update(audioPreferences.value));
    const visibility = () => gameAudio.setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', visibility);
    const blur = () => gameAudio.setVisible(false);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', visibility);
    visibility();
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', visibility);
      gameAudio.disable();
      soundEnabled.value = false;
    };
  }, []);
  return (
    <IconButton
      iconOnly
      icon={<SpeakerIcon muted={!soundEnabled.value} />}
      aria-label={
        soundEnabled.value ? 'Mute music and sound effects' : 'Turn on music and sound effects'
      }
      aria-pressed={soundEnabled.value}
      onClick={toggleSound}
      title="Sound Starts Muted · Choose Music and Effects in Settings"
    >
      {soundEnabled.value ? 'Sound on' : 'Sound off'}
    </IconButton>
  );
}

export function SoundPreferences() {
  const settings = audioPreferences.value;
  const [direction, setDirection] = useState<Temperature | null>(null);
  const [sequence, setSequence] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const preview = (next: Temperature) => {
    gameAudio.cue(next);
    setDirection(next);
    setSequence((value) => value + 1);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDirection(null), TEMPERATURE_FEEDBACK_MS);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Starts muted whenever you open the game.
      </p>
      <div className="space-y-2">
        {(['music', 'effects', 'motion'] as const).map((key) => (
          <label key={key} className="flex items-center justify-between gap-4 text-sm">
            {
              {
                music: 'Background Music',
                effects: 'Hotter / Colder Sounds',
                motion: 'Gentle Guess Animations',
              }[key]
            }
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(event) => {
                audioPreferences.value = { ...settings, [key]: event.currentTarget.checked };
              }}
            />
          </label>
        ))}
      </div>
      <label className="block text-xs">
        Volume <span className="float-right">{Math.round(settings.volume * 100)}%</span>
        <input
          className="mt-1 w-full"
          aria-label="Sound volume"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.volume}
          onInput={(event) => {
            audioPreferences.value = { ...settings, volume: Number(event.currentTarget.value) };
          }}
        />
      </label>
      <button
        className="w-full rounded-full bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-gray-950"
        onClick={toggleSound}
      >
        {soundEnabled.value ? 'Mute Sound' : 'Turn On Sound'}
      </button>
      <div className="relative isolate overflow-hidden rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
        <p className="text-xs font-medium">Preview feedback without making a guess</p>
        <div className="my-2 flex gap-2">
          <button
            className="flex-1 rounded-lg border border-orange-300 p-2 text-sm"
            onClick={() => preview('warmer')}
          >
            Preview Warmer
          </button>
          <button
            className="flex-1 rounded-lg border border-cyan-300 p-2 text-sm"
            onClick={() => preview('colder')}
          >
            Preview Colder
          </button>
        </div>
        <GuessTemperature direction={direction} sequence={sequence} contained />
      </div>
      <p className="text-xs text-gray-500">
        Gentle animations include a brief background tint and follow your device’s reduced-motion
        setting.
      </p>
    </div>
  );
}
