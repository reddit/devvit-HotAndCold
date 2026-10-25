import { useEffect, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import { showToast } from '@devvit/web/client';
import { IconButton } from '../../shared/button';
import { Modal } from '../../shared/modal';
import { audioPreferences, gameAudio, soundEnabled, soundSettingsOpen } from './audio';
import type { Temperature } from './audio';
import { GuessTemperature, TEMPERATURE_FEEDBACK_MS } from './temperature';

const SpeakerIcon = ({ muted }: { muted: boolean }) => (
  <svg
    aria-hidden="true"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    {muted ? (
      <path d="m16 9 6 6m0-6-6 6" />
    ) : (
      <>
        <path d="M15 8a6 6 0 0 1 0 8" />
        <path d="M18 5a10 10 0 0 1 0 14" />
      </>
    )}
  </svg>
);

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
      icon={<SpeakerIcon muted={!soundEnabled.value} />}
      aria-label={
        soundEnabled.value ? 'Mute music and sound effects' : 'Turn on music and sound effects'
      }
      aria-pressed={soundEnabled.value}
      onClick={toggleSound}
      title="Sound starts muted. Choose music and effects in the menu."
    >
      {soundEnabled.value ? 'Sound on' : 'Sound off'}
    </IconButton>
  );
}

export function SoundSettings() {
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
    <Modal
      isOpen={soundSettingsOpen.value}
      onClose={() => {
        soundSettingsOpen.value = false;
      }}
    >
      <div className="w-[88vw] max-w-sm space-y-3 rounded-2xl bg-white p-4 shadow-lg dark:bg-gray-900">
        <div>
          <h2 className="text-lg font-bold">Sound & Effects</h2>
          <p className="mt-1 text-xs text-gray-500">Starts muted whenever you open the game.</p>
        </div>
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
    </Modal>
  );
}
