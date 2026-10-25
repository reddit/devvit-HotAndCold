import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestRunControls } from './controls';
import { setActiveTestRun } from './run';
import '../index.css';

vi.mock('../trpc', () => ({
  trpc: {
    moderation: {
      resetTestRun: { mutate: (input: unknown) => (globalThis as any).__resetTestRun(input) },
    },
  },
}));

let container: HTMLDivElement;
let reset: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  reset = vi.fn().mockRejectedValue(new Error('Unavailable'));
  (globalThis as any).__resetTestRun = reset;
  setActiveTestRun(null);
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  setActiveTestRun(null);
  delete (globalThis as any).__resetTestRun;
});

it('does not display test words or controls in a normal game', async () => {
  await act(() => render(<TestRunControls isSubmitting={false} />, container));
  expect(container.textContent).toBe('');
  expect(reset).not.toHaveBeenCalled();
});

it('sends the selected state for the active run and handles a failed reset without losing progress', async () => {
  setActiveTestRun({
    challengeNumber: 1_000_000_001,
    word: 'apple',
    postUrl: 'https://reddit.com/comments/test',
  });
  await act(() => render(<TestRunControls isSubmitting={false} />, container));
  expect(container.textContent).toBe('Playtest');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  const chip = container.querySelector<HTMLButtonElement>('[aria-label="Playtest Controls"]')!;
  await act(() => chip.click());
  expect(chip.getAttribute('aria-expanded')).toBe('true');
  expect(container.textContent).toContain('Test Word: apple');
  for (const [label, state] of [
    ['Reset My Test Run', 'fresh'],
    ['Jump to Solved', 'solved'],
  ]) {
    const button = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === label
    )!;
    await act(async () => button.click());
    expect(reset).toHaveBeenLastCalledWith({ state, expectedChallengeNumber: 1_000_000_001 });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Reload and try again'
    );
    expect(button.disabled).toBe(false);
  }
});

it('disables state changes while the game is submitting a guess', async () => {
  setActiveTestRun({
    challengeNumber: 1_000_000_001,
    word: 'apple',
    postUrl: 'https://reddit.com/comments/test',
  });
  await act(() => render(<TestRunControls isSubmitting />, container));
  const chip = container.querySelector<HTMLButtonElement>('[aria-label="Playtest Controls"]')!;
  expect(chip.disabled).toBe(false);
  await act(() => chip.click());
  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('section button'));
  expect(buttons).toHaveLength(2);
  expect(buttons.every((button) => button.disabled)).toBe(true);
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(chip.getAttribute('aria-expanded')).toBe('false');
  expect(reset).not.toHaveBeenCalled();
});
