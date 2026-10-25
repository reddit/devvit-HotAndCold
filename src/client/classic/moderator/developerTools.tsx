import { useState } from 'preact/hooks';
import { context } from '@devvit/web/client';
import { experimentDefinitions, experiments } from '../../../shared/experiments/experiments';
import {
  localExperimentOverrides,
  setClientExperimentOverride,
} from '../../core/experimentOverrides';
import { trpc } from '../../trpc';

export function DeveloperTools() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const userId = context.userId ?? '';
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="font-bold">Local Experiments</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          These overrides apply to your account in this browser for this app version. Reopen the
          game after a playtest update. They do not change other players’ experiments.
        </p>
        {(Object.keys(experimentDefinitions) as (keyof typeof experimentDefinitions)[]).map(
          (key) => (
            <label className="block space-y-2 text-sm" key={key}>
              <span className="block font-semibold">Use Suggested Guess With Empty Input</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                Pressing Guess with an empty input uses the placeholder word. It never submits
                automatically.
              </span>
              <select
                className="w-full rounded-lg border border-gray-300 bg-transparent p-2 dark:border-gray-700"
                value={localExperimentOverrides.value[key]?.[userId] ?? 'default'}
                onChange={(event) => {
                  setClientExperimentOverride(
                    key,
                    userId,
                    event.currentTarget.value === 'default' ? null : event.currentTarget.value
                  );
                }}
              >
                <option value="default">
                  Default ({experiments.evaluate(userId, key).treatment === 'on' ? 'On' : 'Off'})
                </option>
                <option value="control">Off</option>
                <option value="on">On</option>
              </select>
            </label>
          )
        )}
      </section>
      <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h3 className="font-bold">Test Push Notification</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Sends a real test push to your account linking to the latest daily puzzle. Daily reminders
          must already be enabled. The server checks developer access again.
        </p>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setError('');
            setMessage('');
            try {
              const result = await trpc.notifications.testPush.mutate();
              if (result.ok) setMessage('Test notification sent.');
              else setError(result.reason);
            } catch {
              setError(
                'Could not send a test notification. Check your access and reminder opt-in.'
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Sending…' : 'Send Test Push to Me'}
        </button>
        {message && (
          <p role="status" className="text-sm text-cyan-800 dark:text-cyan-200">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-300">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
