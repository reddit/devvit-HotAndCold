import { useEffect } from 'preact/hooks';
import { effect, signal } from '@preact/signals';
import { showToast } from '@devvit/web/client';
import { IconButton } from '../../shared/button';
import { audioPreferences, gameAudio, soundEnabled } from './audio';
import type { Temperature } from './audio';
import { GuessTemperature, useTemperatureFeedback } from './temperature';
import { SpeakerIcon } from '../icons';
import { soundPreference } from './soundPreference';
import { watchGameVisibility } from './visibility';

let toggleSequence = 0;
const inView = signal(false);
let playbackStarted = false;
let starting = false;
const waitingForInteraction = signal(false);

async function startSound(explicit = false) {
  if (!soundEnabled.value || !inView.value || playbackStarted || starting) return;
  starting = true;
  const attempt = ++toggleSequence;
  const success = await gameAudio.enable(audioPreferences.value);
  if (attempt !== toggleSequence) return;
  starting = false;
  playbackStarted = success;
  waitingForInteraction.value = !success;
  if (!success && explicit)
    showToast({ text: 'Audio could not start. Tap the game to try again.' });
}

export async function toggleSound() {
  const next = !soundEnabled.value;
  const saved = soundPreference.choose(next);
  // Keep the play call in the click gesture; never wait for a network request first.
  if (next) void startSound(true);
  if (!(await saved) && soundEnabled.value === next)
    showToast({ text: 'Sound works here, but your choice could not be saved for other posts.' });
}

export function useSoundPlayback() {
  useEffect(() => {
    const stopVisibility = watchGameVisibility((visible) => {
      inView.value = visible;
      gameAudio.setVisible(visible);
    });
    const unsubscribe = effect(() => {
      gameAudio.update(audioPreferences.value);
      if (!soundEnabled.value) {
        toggleSequence++;
        starting = false;
        playbackStarted = false;
        waitingForInteraction.value = false;
        gameAudio.disable();
      } else waitingForInteraction.value = !playbackStarted;
    });
    const interaction = (event: Event) => {
      if (
        !event.isTrusted ||
        (event.target instanceof Element && event.target.closest('[data-sound-toggle]'))
      )
        return;
      void startSound();
    };
    document.addEventListener('pointerdown', interaction, true);
    document.addEventListener('keydown', interaction, true);
    void soundPreference.restore();
    return () => {
      toggleSequence++;
      starting = false;
      playbackStarted = false;
      waitingForInteraction.value = soundEnabled.value;
      unsubscribe();
      stopVisibility();
      document.removeEventListener('pointerdown', interaction, true);
      document.removeEventListener('keydown', interaction, true);
      gameAudio.disable();
    };
  }, []);
}

export function SoundButton() {
  useSoundPlayback();
  return (
    <IconButton
      iconOnly
      icon={<SpeakerIcon muted={!soundEnabled.value} />}
      aria-label={
        soundEnabled.value ? 'Mute music and sound effects' : 'Turn on music and sound effects'
      }
      aria-pressed={soundEnabled.value}
      data-audio-playback={
        !soundEnabled.value
          ? 'muted'
          : !inView.value
            ? 'offscreen'
            : waitingForInteraction.value
              ? 'awaiting-interaction'
              : 'playing'
      }
      data-sound-toggle
      onClick={toggleSound}
      title={
        soundEnabled.value
          ? 'Sound On · Your Choice Is Saved · Mute Sound'
          : 'Sound Off · Your Choice Is Saved · Turn On Sound'
      }
    >
      {soundEnabled.value ? 'Sound on' : 'Sound off'}
    </IconButton>
  );
}

export function SoundPreferences() {
  const settings = audioPreferences.value;
  const { showTemperature, ...temperatureFeedback } = useTemperatureFeedback();
  const preview = (next: Temperature) => {
    gameAudio.cue(next);
    showTemperature(next);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Starts muted until you turn it on. Your sound choice is remembered across posts. Sound
        pauses when the game is off-screen.
      </p>
      {soundEnabled.value && waitingForInteraction.value && (
        <p role="status" className="text-xs text-gray-500 dark:text-gray-400">
          Sound is on. Tap or type in the game to resume it in this post.
        </p>
      )}
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
        data-sound-toggle
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
        <GuessTemperature {...temperatureFeedback} contained />
      </div>
      <p className="text-xs text-gray-500">
        A subtle tint stays between guesses, with a gentle pulse for each change. Reduced motion
        keeps the tint still.
      </p>
    </div>
  );
}
