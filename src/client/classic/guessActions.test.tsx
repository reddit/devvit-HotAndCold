import { render } from 'preact';
import { act } from 'preact/test-utils';
import { signal } from '@preact/signals';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../index.css';
import { GuessActions } from './guessActions';
import type { GuessEngine, GuessHistoryItem } from '../core/guessEngine';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_player', postData: { challengeNumber: 1 } },
  showToast: vi.fn(),
  exitExpandedMode: (...args: unknown[]) => (globalThis as any).__guessActionsMock.exit(...args),
  requestExpandedMode: (...args: unknown[]) =>
    (globalThis as any).__guessActionsMock.expand(...args),
}));
vi.mock('../core/hints', async (original) => ({
  ...(await original<any>()),
  loadHintsForChallenge: (...args: any[]) => (globalThis as any).__guessActionsMock.hints(...args),
}));
vi.mock('../core/guessEngine', () => ({
  flushPendingGuesses: (...args: unknown[]) =>
    (globalThis as any).__guessActionsMock.flush(...args),
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
    flush: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn(),
    onHint: vi.fn(),
    expand: vi.fn(),
    exit: vi.fn(),
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
  await page.viewport(1280, 720);
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

it('opens a compact overlay without changing progress and returns focus after cancellation', async () => {
  engine.history.value = guesses(10);
  await mount();
  button('Give Up').focus();
  await act(() => button('Give Up').click());
  expect(mock.expand).not.toHaveBeenCalled();
  expect(mock.exit).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(
    'give-up-title'
  );
  expect(container.textContent).toContain('Give Up This Puzzle?');
  expect(mock.giveUp).not.toHaveBeenCalled();
  expect(mock.navigate).not.toHaveBeenCalled();
  await act(() => button('Keep Playing').click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(button('Give Up'));
  expect(mock.giveUp).not.toHaveBeenCalled();
});

it('dismisses with Escape, the backdrop, or the close button without giving up', async () => {
  engine.history.value = guesses(10);
  await mount();
  for (const method of ['escape', 'backdrop', 'close']) {
    await act(() => button('Give Up').click());
    await act(() => {
      if (method === 'escape')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (method === 'backdrop')
        container.querySelector<HTMLElement>('[role="dialog"]')!.click();
      else button('Close modal').click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  }
  expect(mock.giveUp).not.toHaveBeenCalled();
  expect(mock.navigate).not.toHaveBeenCalled();
});

it('flushes unsynced guesses before one confirmed Give Up and closes directly into results', async () => {
  engine.history.value = guesses(10);
  let finish: () => void = () => {};
  mock.flush.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await mount();
  await act(() => button('Give Up').click());
  const confirm = button('Give Up and Reveal');
  await act(() => {
    confirm.click();
    confirm.click();
  });
  expect(mock.flush).toHaveBeenCalledTimes(1);
  expect(mock.flush).toHaveBeenCalledWith(1);
  expect(mock.giveUp).not.toHaveBeenCalled();
  expect(button('Keep Playing').disabled).toBe(true);
  expect(button('Close modal').disabled).toBe(true);
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    container.querySelector<HTMLElement>('[role="dialog"]')!.click();
  });
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => {
    finish();
  });
  await expect.poll(() => mock.navigate.mock.calls.length).toBe(1);
  expect(mock.giveUp).toHaveBeenCalledTimes(1);
  expect(mock.giveUp).toHaveBeenCalledWith({ challengeNumber: 1 });
  expect(mock.navigate).toHaveBeenCalledWith('win');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(mock.expand).not.toHaveBeenCalled();
});

it.each([
  [320, 360],
  [320, 440],
  [390, 520],
  [768, 600],
])('fits the overlay and an error without scrolling at %s × %s', async (width, height) => {
  await page.viewport(width!, height!);
  engine.history.value = guesses(10);
  mock.giveUp.mockRejectedValue(new Error('offline'));
  await mount();
  await act(() => button('Give Up').click());
  if (width === 320 && height === 360)
    await page.screenshot({ path: '__screenshots__/give-up-overlay.png' });
  await act(async () => button('Give Up and Reveal').click());
  await expect
    .poll(() => container.querySelector('[role="alert"]')?.textContent)
    .toContain('Could not give up');
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  const panel = dialog.querySelector('section')!;
  const bounds = panel.getBoundingClientRect();
  expect(bounds.top).toBeGreaterThan(0);
  expect(bounds.bottom).toBeLessThan(height!);
  expect(bounds.left).toBeGreaterThan(0);
  expect(bounds.right).toBeLessThan(width!);
  expect(dialog.scrollHeight).toBe(dialog.clientHeight);
  expect(dialog.scrollWidth).toBe(dialog.clientWidth);
  expect(panel.scrollHeight).toBe(panel.clientHeight);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not give up');
  expect(mock.navigate).not.toHaveBeenCalled();
  expect(button('Give Up and Reveal').disabled).toBe(false);
  await act(() => button('Keep Playing').click());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});
