import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestRunControls, TestRunPanel } from './controls';
import { setActiveTestRun, watchTestRunChanges, notifyTestRunChanged } from './run';
import '../index.css';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 'player', postId: 'test' },
  requestExpandedMode: (...args: unknown[]) => (globalThis as any).__testControlsExpand(...args),
  exitExpandedMode: vi.fn(),
}));

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
  (globalThis as any).__testControlsExpand = vi.fn();
  localStorage.removeItem('playtest:run-changed:player:test');
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  setActiveTestRun(null);
  delete (globalThis as any).__resetTestRun;
  delete (globalThis as any).__testControlsExpand;
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
  expect((globalThis as any).__testControlsExpand).toHaveBeenCalledWith(
    expect.any(MouseEvent),
    'playtest-controls',
    { title: 'Playtest Controls' }
  );
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(() => render(<TestRunPanel />, container));
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
  expect(chip.disabled).toBe(true);
  await act(() => chip.click());
  expect((globalThis as any).__testControlsExpand).not.toHaveBeenCalled();
  expect(reset).not.toHaveBeenCalled();
});

it('returns to the new test run without touching old local history and ignores stale notifications', () => {
  setActiveTestRun({ challengeNumber: 1_000_000_002, word: 'apple', postUrl: 'test' });
  const changed = vi.fn();
  const stop = watchTestRunChanges(changed);
  notifyTestRunChanged(1_000_000_001);
  window.dispatchEvent(new Event('focus'));
  expect(changed).not.toHaveBeenCalled();
  notifyTestRunChanged(1_000_000_003);
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'playtest:run-changed:player:test',
      storageArea: localStorage,
    })
  );
  expect(changed).toHaveBeenCalledTimes(1);
  stop();
});
