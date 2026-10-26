import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from '@vitest/browser/context';
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

vi.mock('./run', async (original) => ({
  ...(await original<typeof import('./run')>()),
  reloadTestRun: () => (globalThis as any).__testControlsReload(),
}));

let container: HTMLDivElement;
let reset: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
const testRun = {
  challengeNumber: 1_000_000_001,
  word: 'apple',
  postUrl: 'https://reddit.com/comments/test',
};
const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) =>
      element.getAttribute('aria-label') === label || element.textContent?.trim() === label
  )!;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  reset = vi.fn().mockRejectedValue(new Error('Unavailable'));
  reload = vi.fn();
  (globalThis as any).__resetTestRun = reset;
  (globalThis as any).__testControlsReload = reload;
  setActiveTestRun(null);
  (globalThis as any).__testControlsExpand = vi.fn();
  localStorage.removeItem('playtest:run-changed:player:test');
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  setActiveTestRun(null);
  delete (globalThis as any).__resetTestRun;
  delete (globalThis as any).__testControlsReload;
  delete (globalThis as any).__testControlsExpand;
  await page.viewport(1280, 720);
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
  expect((globalThis as any).__testControlsExpand).not.toHaveBeenCalled();
  expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby')).toBe(
    'playtest-title'
  );
  expect(container.textContent).toContain('Test Word: apple');
  for (const [label, state] of [
    ['Reset Test Run', 'fresh'],
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
  expect(reload).not.toHaveBeenCalled();
  expect(localStorage.getItem('playtest:run-changed:player:test')).toBeNull();
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

it('closes with Escape, the backdrop, or X and restores focus without resetting the run', async () => {
  setActiveTestRun(testRun);
  await act(() => render(<TestRunControls isSubmitting={false} />, container));
  const chip = button('Playtest Controls');
  chip.focus();
  for (const method of ['escape', 'backdrop', 'close']) {
    await act(() => chip.click());
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Test Word: apple');
    await act(() => {
      if (method === 'escape')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      else if (method === 'backdrop')
        container.querySelector<HTMLElement>('[role="dialog"]')!.click();
      else button('Close modal').click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(chip);
  }
  expect(reset).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it.each([
  ['Reset Test Run', 'fresh'],
  ['Jump to Solved', 'solved'],
])(
  'applies %s once, keeps the pending overlay open, and reloads the new run',
  async (label, state) => {
    setActiveTestRun(testRun);
    let finish: (value: typeof testRun) => void = () => {};
    reset.mockImplementation(
      () =>
        new Promise<typeof testRun>((resolve) => {
          finish = resolve;
        })
    );
    await act(() => render(<TestRunControls isSubmitting={false} />, container));
    await act(() => button('Playtest Controls').click());
    const action = button(label!);
    await act(() => {
      action.click();
      action.click();
    });
    expect(reset).toHaveBeenCalledExactlyOnceWith({
      state,
      expectedChallengeNumber: testRun.challengeNumber,
    });
    expect(button('Reset Test Run').disabled).toBe(true);
    expect(button('Jump to Solved').disabled).toBe(true);
    expect(button('Close modal').disabled).toBe(true);
    await act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      container.querySelector<HTMLElement>('[role="dialog"]')!.click();
      button('Close modal').click();
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(reload).not.toHaveBeenCalled();
    await act(async () => finish({ ...testRun, challengeNumber: 1_000_000_002 }));
    await expect.poll(() => reload.mock.calls.length).toBe(1);
    expect(localStorage.getItem('playtest:run-changed:player:test')).toBe('1000000002');
    expect(container.textContent).not.toContain('Return to Game');
  }
);

it.each([
  [320, 360],
  [320, 440],
  [390, 520],
  [620, 512],
])(
  'fits the controls and a recoverable error without scrolling at %s × %s',
  async (width, height) => {
    await page.viewport(width!, height!);
    setActiveTestRun(testRun);
    await act(() => render(<TestRunControls isSubmitting={false} />, container));
    await act(() => button('Playtest Controls').click());
    if (width === 320 && height === 360)
      await page.screenshot({ path: '__screenshots__/playtest-overlay.png' });
    await act(async () => button('Reset Test Run').click());
    await expect
      .poll(() => container.querySelector('[role="alert"]')?.textContent)
      .toContain('Reload and try again');
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
    expect(panel.scrollWidth).toBe(panel.clientWidth);
    expect(button('Reset Test Run').getBoundingClientRect().top).toBe(
      button('Jump to Solved').getBoundingClientRect().top
    );
  }
);

it('retains the return action for an older expanded-controls link', async () => {
  setActiveTestRun(testRun);
  reset.mockResolvedValue({ ...testRun, challengeNumber: 1_000_000_002 });
  await act(() => render(<TestRunPanel />, container));
  await act(async () => button('Reset Test Run').click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain('test run is ready');
  expect(button('Return to Game')).toBeDefined();
  expect(reload).not.toHaveBeenCalled();
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
