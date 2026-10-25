import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Modal } from '../shared/modal';
import { SoundPreferences } from './feedback/controls';
import { userSettings } from './state/userSettings';
import { resetGuessCache } from '../core/guess';

export const settingsOpen = signal(false);
type SettingsTab = 'Sound & Effects' | 'Gameplay';

export async function clearDownloadedWordData() {
  // Downloadable rank/lemma caches only. Keep all local history, solved state,
  // preferences, and in-flight submissions; no reload interrupts their sync.
  await resetGuessCache();
}

function ChoiceToggle<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; preview: ComponentChildren; description: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-semibold">{label}</legend>
      <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-label={option.label}
            title={option.description}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`flex min-h-10 min-w-0 flex-1 items-center justify-between gap-1 rounded-md px-1.5 py-1 text-xs font-semibold ${value === option.value ? 'bg-white text-cyan-800 shadow-sm dark:bg-gray-600 dark:text-cyan-100' : 'text-gray-600 dark:text-gray-300'}`}
          >
            <span className="min-w-0 text-left">{option.label}</span>
            {option.preview}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function GuessPreview({
  roomy = false,
  newestFirst = false,
}: {
  roomy?: boolean;
  newestFirst?: boolean;
}) {
  const samples = [
    { word: 'sun', rank: 24 },
    { word: 'sky', rank: 360 },
  ];
  if (newestFirst) samples.reverse();
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-[52px] shrink-0 items-center"
      data-setting-preview
    >
      <span
        className={`grid w-full text-[11px] leading-3 font-normal ${roomy ? 'gap-2' : 'gap-0'}`}
      >
        {samples.map(({ word, rank }) => (
          <span key={word} className="flex justify-between gap-0.5">
            <span className="text-gray-700 dark:text-gray-200">{word}</span>
            <span
              className={`tabular-nums ${rank < 250 ? 'text-red-700 dark:text-red-300' : 'text-yellow-800 dark:text-yellow-200'}`}
            >
              #{rank}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

export function PlayerSettings() {
  const [tab, setTab] = useState<SettingsTab>('Sound & Effects');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState('');
  const settings = userSettings.value;
  const tabs: SettingsTab[] = ['Sound & Effects', 'Gameplay'];
  const selectedTab = tabs.includes(tab) ? tab : 'Sound & Effects';
  const close = () => {
    settingsOpen.value = false;
    setError('');
    setConfirmReset(false);
    setNotice('');
  };
  return (
    <Modal isOpen={settingsOpen.value} onClose={close} labelledBy="player-settings-title">
      <section className="w-[min(84vw,420px)] bg-white text-gray-900 shadow-xl dark:bg-gray-900 dark:text-gray-100">
        <header className="sticky top-0 z-10 space-y-2 border-b border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
          <h2 id="player-settings-title" className="text-lg font-bold">
            Settings
          </h2>
          <div
            role="tablist"
            aria-label="Settings"
            className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800"
          >
            {tabs.map((name, index) => (
              <button
                key={name}
                id={`settings-tab-${index}`}
                role="tab"
                aria-selected={selectedTab === name}
                aria-controls="settings-panel"
                tabIndex={selectedTab === name ? 0 : -1}
                onKeyDown={(event) => {
                  const nextIndex =
                    event.key === 'ArrowRight'
                      ? (index + 1) % tabs.length
                      : event.key === 'ArrowLeft'
                        ? (index + tabs.length - 1) % tabs.length
                        : event.key === 'Home'
                          ? 0
                          : event.key === 'End'
                            ? tabs.length - 1
                            : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  setTab(tabs[nextIndex]!);
                  setError('');
                  const tabButtons =
                    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                      '[role="tab"]'
                    );
                  tabButtons?.[nextIndex]?.focus();
                }}
                className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold ${selectedTab === name ? 'bg-white text-cyan-800 shadow-sm dark:bg-gray-700 dark:text-cyan-200' : 'text-gray-600 dark:text-gray-300'}`}
                onClick={() => {
                  setTab(name);
                  setError('');
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </header>
        <div
          id="settings-panel"
          role="tabpanel"
          aria-labelledby={`settings-tab-${tabs.indexOf(selectedTab)}`}
          className={selectedTab === 'Gameplay' ? 'space-y-2 p-3' : 'space-y-4 p-4'}
        >
          {selectedTab === 'Sound & Effects' && <SoundPreferences />}
          {selectedTab === 'Gameplay' && (
            <>
              <ChoiceToggle
                label="Guess Spacing"
                value={settings.layout}
                options={[
                  {
                    value: 'CONDENSED',
                    label: 'Compact',
                    preview: <GuessPreview />,
                    description: 'Example: Guesses With Less Space Between Rows',
                  },
                  {
                    value: 'EXPANDED',
                    label: 'Roomy',
                    preview: <GuessPreview roomy />,
                    description: 'Example: Guesses With More Space Between Rows',
                  },
                ]}
                onChange={(layout) => {
                  userSettings.value = { ...userSettings.value, layout };
                }}
              />
              <ChoiceToggle
                label="Guess Order"
                value={settings.sortType}
                options={[
                  {
                    value: 'SIMILARITY',
                    label: 'Closest First',
                    preview: <GuessPreview />,
                    description: 'Example: Sun #24 Before Sky #360, the Newer Guess',
                  },
                  {
                    value: 'TIMESTAMP',
                    label: 'Newest First',
                    preview: <GuessPreview newestFirst />,
                    description: 'Example: Sky #360, the Newer Guess, Before Sun #24',
                  },
                ]}
                onChange={(sortType) => {
                  userSettings.value = { ...userSettings.value, sortType, sortDirection: 'DESC' };
                }}
              />
              <p className="text-[11px] leading-[14px] text-gray-500 dark:text-gray-400">
                Your newest guess stays pinned.
              </p>
              <details className="rounded-xl border border-gray-200 p-2 dark:border-gray-700">
                <summary className="text-xs font-semibold">Troubleshooting</summary>
                <p className="my-3 text-xs text-gray-500 dark:text-gray-400">
                  Clear downloaded word rankings if they seem incorrect. Your guess history,
                  results, browser preferences, and reminders are kept. Word data downloads again as
                  needed; the game stays open.
                </p>
                {confirmReset ? (
                  <div
                    role="group"
                    aria-label="Confirm Word Cache Reset"
                    className="space-y-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800"
                  >
                    <p className="text-sm font-semibold">Clear Downloaded Word Data?</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Only downloaded ranking data is removed. Your guesses and settings stay saved.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
                        onClick={() => setConfirmReset(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-semibold text-white"
                        onClick={async () => {
                          setBusy(true);
                          setError('');
                          try {
                            await clearDownloadedWordData();
                            setConfirmReset(false);
                            setNotice(
                              'Downloaded word data cleared. Your history and settings were kept.'
                            );
                          } catch {
                            setError('Could not clear word data. Please try again.');
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? 'Clearing…' : 'Confirm Clear Word Data'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
                    onClick={() => {
                      setNotice('');
                      setConfirmReset(true);
                    }}
                  >
                    Clear Word Cache
                  </button>
                )}
              </details>
            </>
          )}
          {notice && (
            <p role="status" className="text-sm text-cyan-800 dark:text-cyan-200">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      </section>
    </Modal>
  );
}
