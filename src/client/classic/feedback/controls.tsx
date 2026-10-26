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
  if (!soundPreference.ready.value || !soundEnabled.value || !inView.value || starting) return;
  starting = true;
  const attempt = ++toggleSequence;
  const success = await gameAudio.enable(audioPreferences.value);
  if (attempt !== toggleSequence) return;
  starting = false;
  playbackStarted = success;
  waitingForInteraction.value = !success;
  if (!success && explicit)
    showToast({ text: 'Audio could not start. Submit a guess or use Start Sound to try again.' });
}

// Called synchronously by Guess submission; typing and opening menus stay silent.
export function startSoundOnGuess() {
  if (!soundPreference.ready.value && soundEnabled.value && inView.value) {
    // Unlock silently now, then honor the server's choice before starting audio.
    void Promise.all([gameAudio.unlock(), soundPreference.restore()]).then(([unlocked]) => {
      if (unlocked) void startSound();
    });
    return;
  }
  void startSound();
}

async function chooseSound(next: boolean) {
  const saved = soundPreference.choose(next);
  // Keep the play call in the click gesture; never wait for a network request first.
  if (next) void startSound(true);
  if (!(await saved) && soundEnabled.value === next)
    showToast({ text: 'Sound works here, but your choice could not be saved for other posts.' });
}

export function toggleSound() {
  return chooseSound(!soundEnabled.value);
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
    void soundPreference.restore();
    return () => {
      toggleSequence++;
      starting = false;
      playbackStarted = false;
      unsubscribe();
      stopVisibility();
      gameAudio.disable();
    };
  }, []);
}

export function SoundButton({ variant = 'toolbar' }: { variant?: 'toolbar' | 'input' }) {
  return (
    <IconButton
      iconOnly
      icon={<SpeakerIcon muted={!soundEnabled.value} />}
      className={
        variant === 'input'
          ? 'h-12 w-12 border border-zinc-300 bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700'
          : undefined
      }
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
          ? waitingForInteraction.value
            ? 'Sound On · Starts With Your Next Guess · Mute Sound'
            : 'Sound On · Your Choice Is Saved · Mute Sound'
          : 'Sound Off · Your Choice Is Saved · Turn On Sound'
      }
    >
      {soundEnabled.value ? 'Sound On' : 'Sound Off'}
    </IconButton>
  );
}

export function SoundPreferences() {
  const settings = audioPreferences.value;
  const { showTemperature, ...temperatureFeedback } = useTemperatureFeedback();
  const preview = (next: Temperature) => {
    void gameAudio.cue(next);
    showTemperature(next);
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Sound is muted by default. Turn it on beside the guess input or below. Your choice is
        remembered across posts. Sound pauses when the game is off-screen or in the background.
      </p>
      {soundEnabled.value && waitingForInteraction.value && (
        <p role="status" className="text-xs text-gray-500 dark:text-gray-400">
          Sound is on. Submit your next guess to start it, or use the sound button below.
        </p>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Music follows your best guess: Exploration → ☀️ Stage Select (Top 1,000) → 🔥 Boss Fight
        (Top 250). Colder guesses keep your current track playing. A win ends with a short fanfare
        and applause, then silence.
      </p>
      <div className="space-y-2">
        {(['music', 'effects', 'motion'] as const).map((key) => (
          <label key={key} className="flex items-center justify-between gap-4 text-sm">
            {
              {
                music: 'Background Music',
                effects: 'Sound Effects',
                motion: 'Temperature Colors and Animations',
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
        onClick={() =>
          soundEnabled.value && waitingForInteraction.value ? chooseSound(true) : toggleSound()
        }
      >
        {soundEnabled.value
          ? waitingForInteraction.value
            ? 'Start Sound'
            : 'Mute Sound'
          : 'Turn On Sound'}
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
        The tint stays between guesses, with a gentle pulse for each change. Very close guesses glow
        more, wins are fiery, and Give Up results are icy. Reduced motion keeps the tint still.
      </p>
    </div>
  );
}
