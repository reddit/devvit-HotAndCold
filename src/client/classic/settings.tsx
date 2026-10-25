import { signal } from '@preact/signals';
import { useState } from 'preact/hooks';
import { Modal } from '../shared/modal';
import { SoundPreferences } from './feedback/controls';
import { userSettings } from './state/userSettings';
import { openModeratorSettings } from './moderator/launch';
import { resetGuessCache } from '../core/guess';
import { isLoggedOut } from '../shared/user';

export const settingsOpen = signal(false);
type SettingsTab = 'Sound & Effects' | 'Gameplay' | 'Moderation';

export async function resetLocalGameCache() {
  await resetGuessCache();
  // This retains the previous Reset Cache behavior. Server progress is untouched.
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.location.reload();
}

export function PlayerSettings({
  isModerator,
  onToggleReminder,
}: {
  isModerator: boolean;
  onToggleReminder: () => Promise<unknown>;
}) {
  const [tab, setTab] = useState<SettingsTab>('Sound & Effects');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const settings = userSettings.value;
  const tabs: SettingsTab[] = [
    'Sound & Effects',
    'Gameplay',
    ...(isModerator ? ['Moderation' as const] : []),
  ];
  const selectedTab = tabs.includes(tab) ? tab : 'Sound & Effects';
  const close = () => {
    settingsOpen.value = false;
    setError('');
  };
  return (
    <Modal isOpen={settingsOpen.value} onClose={close} labelledBy="player-settings-title">
      <section className="w-[min(84vw,420px)] bg-white text-gray-900 shadow-xl dark:bg-gray-900 dark:text-gray-100">
        <header className="sticky top-0 z-10 space-y-3 border-b border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
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
          className="space-y-4 p-4"
        >
          {selectedTab === 'Sound & Effects' && <SoundPreferences />}
          {selectedTab === 'Gameplay' && (
            <>
              <label className="block text-sm font-semibold">
                Guess Spacing
                <select
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-transparent p-2 dark:border-gray-600"
                  value={settings.layout}
                  onChange={(event) => {
                    userSettings.value = {
                      ...userSettings.value,
                      layout: event.currentTarget.value as typeof settings.layout,
                    };
                  }}
                >
                  <option value="CONDENSED">Compact</option>
                  <option value="EXPANDED">Roomy</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">
                Guess Order
                <select
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-transparent p-2 dark:border-gray-600"
                  value={settings.sortType}
                  onChange={(event) => {
                    userSettings.value = {
                      ...userSettings.value,
                      sortType: event.currentTarget.value as typeof settings.sortType,
                      sortDirection: 'DESC',
                    };
                  }}
                >
                  <option value="SIMILARITY">Closest First</option>
                  <option value="TIMESTAMP">Newest First</option>
                </select>
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Your newest guess stays pinned in either order.
              </p>
              {!isLoggedOut() && (
                <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
                  <h3 className="text-sm font-semibold">Daily Reminders</h3>
                  <p className="my-2 text-xs text-gray-500 dark:text-gray-400">
                    {settings.isUserOptedIntoReminders
                      ? 'Subscribed to new daily puzzles.'
                      : 'Get a notification when a new daily puzzle is ready.'}
                  </p>
                  <button
                    disabled={busy}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await onToggleReminder();
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {settings.isUserOptedIntoReminders ? 'Turn Off Reminders' : 'Turn On Reminders'}
                  </button>
                </div>
              )}
              <details className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <summary className="text-sm font-semibold">Troubleshooting</summary>
                <p className="my-3 text-xs text-gray-500 dark:text-gray-400">
                  Reset cached word data and browser preferences, then reload. Synced progress stays
                  on the server; unsynced guesses may be lost.
                </p>
                <button
                  disabled={busy}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600"
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await resetLocalGameCache();
                    } catch {
                      setError('Could not reset the cache. Try reloading the game.');
                      setBusy(false);
                    }
                  }}
                >
                  Reset Cache and Reload
                </button>
              </details>
            </>
          )}
          {selectedTab === 'Moderation' && isModerator && (
            <>
              <h3 className="text-sm font-semibold">Moderator Settings (Experimental)</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Manage the word queue, daily publishing, reminders, and Redis in a full-size view.
                Secret words stay hidden until you confirm a reveal.
              </p>
              <button
                className="w-full rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-gray-950"
                onClick={(event) => {
                  openModeratorSettings(event);
                  close();
                }}
              >
                Open Moderator Settings ↗
              </button>
            </>
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
