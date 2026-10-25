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
  requestExpandedMode: (...args: unknown[]) =>
    (globalThis as any).__guessActionsMock.expand(...args),
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
    expand: vi.fn(),
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

it('hides locked help buttons, shows Hint at five and Give Up at ten, and blocks repeat submissions', async () => {
  await mount();
  expect(button('Hint')).toBeUndefined();
  expect(button('Give Up')).toBeUndefined();
  expect(container.querySelector('[aria-label="Puzzle Help"]')).toBeNull();
  await act(() => {
    engine.history.value = guesses(5);
  });
  expect(button('Hint').disabled).toBe(false);
  expect(button('Give Up')).toBeUndefined();
  expect(container.querySelector('p')).toBeNull();
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

it('opens Give Up in expanded mode without revealing the answer or changing progress', async () => {
  engine.history.value = guesses(10);
  await mount();
  await act(() => button('Give Up').click());
  expect(mock.expand).toHaveBeenCalledWith(expect.any(MouseEvent), 'give-up', {
    title: 'Give Up This Puzzle?',
  });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(mock.giveUp).not.toHaveBeenCalled();
  expect(mock.navigate).not.toHaveBeenCalled();
});
