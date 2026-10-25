import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../index.css';
import { GuessActions } from './guessActions';
import type { GuessEngine, GuessHistoryItem } from '../core/guessEngine';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_player', postData: { challengeNumber: 1 } },
  showToast: vi.fn(),
}));
vi.mock('../core/hints', async (original) => ({
  ...(await original<any>()),
  loadHintsForChallenge: (...args: any[]) => (globalThis as any).__guessActionsMock.hints(...args),
}));
vi.mock('../trpc', () => ({
  trpc: {
    guess: {
      giveUp: {
        mutate: (...args: any[]) => (globalThis as any).__guessActionsMock.giveUp(...args),
      },
    },
  },
}));
vi.mock('./state/navigation', () => ({
  navigate: (...args: any[]) => (globalThis as any).__guessActionsMock.navigate(...args),
}));
let container: HTMLDivElement;
let mock: any;
let engine: GuessEngine;
const guesses = (count: number): GuessHistoryItem[] =>
  Array.from({ length: count }, (_, i) => ({
    word: `word${i}`,
    rank: 1000 + i * 10,
    similarity: 0.1,
    timestamp: i + 1,
  }));
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  mock = {
    hints: vi.fn().mockResolvedValue([{ word: 'clue', rank: 500, similarity: 0.5, isHint: true }]),
    giveUp: vi.fn().mockResolvedValue({}),
    navigate: vi.fn(),
    onHint: vi.fn(),
  };
  (globalThis as any).__guessActionsMock = mock;
  engine = {
    history: signal(guesses(0)),
    isSubmitting: signal(false),
    solvedAtMs: signal<number | null>(null),
    lastResult: signal(null),
    hasGuessed: vi.fn(),
    clear: vi.fn(),
    submit: vi.fn(),
    submitHint: vi.fn().mockResolvedValue({ ok: true, word: 'clue', rank: 500, similarity: 0.5 }),
  };
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  delete (globalThis as any).__guessActionsMock;
});
const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label || button.textContent?.trim() === label
  )!;
const mount = async () => {
  await act(() => render(<GuessActions engine={engine} onHint={mock.onHint} />, container));
};

it('unlocks Hint at five and Give Up at ten, and blocks both during a submission', async () => {
  await mount();
  expect(button('Hint').disabled).toBe(true);
  expect(button('Give Up').disabled).toBe(true);
  await act(() => {
    engine.history.value = guesses(5);
  });
  expect(button('Hint').disabled).toBe(false);
  expect(button('Give Up').disabled).toBe(true);
  await act(() => {
    engine.history.value = guesses(10);
  });
  expect(button('Give Up').disabled).toBe(false);
  await act(() => {
    engine.isSubmitting.value = true;
  });
  expect(button('Hint').disabled).toBe(true);
  expect(button('Give Up').disabled).toBe(true);
});

it('chooses a hint from current engine history, submits it as a hint, and reports feedback', async () => {
  engine.history.value = guesses(5);
  await mount();
  await act(async () => {
    button('Hint').click();
  });
  expect(engine.submitHint).toHaveBeenCalledWith('clue');
  expect(mock.onHint).toHaveBeenCalledWith(
    expect.objectContaining({ word: 'clue', rank: 500 }),
    1040
  );
});

it('requires confirmation before giving up and allows keeping the puzzle active', async () => {
  engine.history.value = guesses(10);
  await mount();
  await act(() => {
    button('Give Up').click();
  });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  expect(mock.giveUp).not.toHaveBeenCalled();
  await act(() => {
    button('Keep Playing').click();
  });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(() => {
    button('Give Up').click();
  });
  await act(async () => {
    button('Give Up and Reveal').click();
  });
  expect(mock.giveUp).toHaveBeenCalledWith({ challengeNumber: 1 });
  expect(mock.navigate).toHaveBeenCalledWith('win');
});

it('keeps the confirmation open after a failed Give Up instead of showing a result', async () => {
  mock.giveUp.mockRejectedValue(new Error('offline'));
  engine.history.value = guesses(10);
  await mount();
  await act(() => {
    button('Give Up').click();
  });
  await act(async () => {
    button('Give Up and Reveal').click();
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not give up');
  expect(mock.navigate).not.toHaveBeenCalled();
});
