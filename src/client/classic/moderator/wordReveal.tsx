import { useEffect, useRef, useState } from 'preact/hooks';
import {
  WORD_REVEAL_LABELS,
  WORD_REVEAL_PURPOSES,
  WORD_REVEAL_REASON_MIN_LENGTH,
  type WordRevealAcknowledgement,
} from '../../../shared/moderation';

export function WordRevealGate({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: 'answer' | 'queue';
  busy: boolean;
  onCancel: () => void;
  onConfirm: (acknowledgement: WordRevealAcknowledgement) => Promise<void>;
}) {
  const [purpose, setPurpose] = useState('');
  const [reason, setReason] = useState('');
  const [promise, setPromise] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const allowedPurpose = WORD_REVEAL_PURPOSES.find((value) => value === purpose);
  const ready =
    allowedPurpose &&
    reason.trim().length >= WORD_REVEAL_REASON_MIN_LENGTH &&
    promise &&
    confirmation === 'REVEAL';
  const field =
    'mt-2 w-full rounded-lg border border-amber-300 bg-white p-3 text-sm dark:border-amber-800 dark:bg-gray-900';

  return (
    <form
      aria-label="Confirm Word Reveal"
      className="mt-4 space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready || busy) return;
        void onConfirm({
          purpose: allowedPurpose,
          reason: reason.trim(),
          promiseNotToCheat: true,
          confirmation: 'REVEAL',
        });
      }}
    >
      <h3 ref={heading} tabIndex={-1} className="font-bold">
        {target === 'answer' ? 'Reveal the Current Answer?' : 'Reveal This Queue Page?'}
      </h3>
      <p className="text-sm">
        Only reveal words when a moderation task requires them. Seeing an answer can spoil the game
        for you and other players. You can add words and inspect storage without revealing existing
        answers.
      </p>
      <label className="block text-sm font-semibold">
        Moderation Purpose
        <select
          className={field}
          required
          disabled={busy}
          value={purpose}
          onChange={(event) => setPurpose(event.currentTarget.value)}
        >
          <option value="">Choose a Moderation Task</option>
          {WORD_REVEAL_PURPOSES.map((value) => (
            <option key={value} value={value}>
              {WORD_REVEAL_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Why Do You Need to See These Words?
        <textarea
          className={field}
          rows={3}
          required
          disabled={busy}
          minLength={WORD_REVEAL_REASON_MIN_LENGTH}
          maxLength={500}
          value={reason}
          placeholder="Describe the specific moderation task (at least 20 characters)."
          onInput={(event) => setReason(event.currentTarget.value)}
        />
      </label>
      <label className="flex items-start gap-3 text-sm">
        <input
          className="mt-1"
          type="checkbox"
          required
          disabled={busy}
          checked={promise}
          onChange={(event) => setPromise(event.currentTarget.checked)}
        />
        I need these words for moderation, and I promise not to use or share them to cheat.
      </label>
      <label className="block text-sm font-semibold">
        Type REVEAL to Confirm
        <input
          className={field}
          required
          disabled={busy}
          autoComplete="off"
          spellcheck={false}
          value={confirmation}
          onInput={(event) => setConfirmation(event.currentTarget.value)}
        />
      </label>
      <p className="text-xs text-gray-600 dark:text-gray-300">
        This reveals only{' '}
        {target === 'answer' ? 'the selected answer' : 'this page of up to 50 words'} for 60
        seconds. Words hide again when you change tabs, refresh, or leave this view.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy || !ready}
          className="rounded-lg bg-amber-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-amber-200 dark:text-amber-950"
        >
          Confirm and Reveal {target === 'answer' ? 'Answer' : 'Queue Page'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-gray-400 px-4 py-2 text-sm font-semibold"
          onClick={onCancel}
        >
          Keep Words Hidden
        </button>
      </div>
    </form>
  );
}
