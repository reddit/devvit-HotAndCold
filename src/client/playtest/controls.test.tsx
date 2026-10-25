import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestRunControls } from './controls';
import { setActiveTestRun } from './run';

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
  expect(container.textContent).toContain('Playtest Only · Test Word: apple');
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
  const buttons = Array.from(container.querySelectorAll('button'));
  expect(buttons).toHaveLength(2);
  expect(buttons.every((button) => button.disabled)).toBe(true);
});
