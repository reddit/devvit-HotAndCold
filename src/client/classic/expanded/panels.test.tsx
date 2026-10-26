import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GiveUpPanel, CommentPanel, ScorePanel } from './panels';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 'player', postData: { challengeNumber: 1 } },
  exitExpandedMode: (...args: unknown[]) => (globalThis as any).__panelsMock.exit(...args),
}));
vi.mock('../../core/guessEngine', () => ({ flushPendingGuesses: async () => {} }));
vi.mock('../state/navigation', () => ({
  navigate: (...args: unknown[]) => (globalThis as any).__panelsMock.navigate(...args),
}));
vi.mock('../../trpc', () => ({
  trpc: {
    guess: {
      giveUp: { mutate: (input: unknown) => (globalThis as any).__panelsMock.giveUp(input) },
    },
    game: { get: { query: (input: unknown) => (globalThis as any).__panelsMock.game(input) } },
    cta: {
      getCommentSuffix: { query: async () => ({ suffix: 'Game Results' }) },
      submitComment: {
        mutate: (input: unknown) => (globalThis as any).__panelsMock.comment(input),
      },
    },
  },
}));

let container: HTMLDivElement;
let mock: any;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  mock = {
    giveUp: vi.fn().mockResolvedValue({}),
    navigate: vi.fn(),
    exit: vi.fn(),
    comment: vi.fn().mockRejectedValue(new Error('offline')),
    game: vi.fn().mockResolvedValue({ challengeUserInfo: { score: null } }),
  };
  (globalThis as any).__panelsMock = mock;
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  delete (globalThis as any).__panelsMock;
});
const button = (text: string) =>
  Array.from(container.querySelectorAll('button')).find(
    (element) => element.getAttribute('aria-label') === text || element.textContent?.trim() === text
  )!;

it('keeps playing without a mutation, then requires a separate confirmation to give up', async () => {
  await act(() => render(<GiveUpPanel />, container));
  expect(mock.giveUp).not.toHaveBeenCalled();
  await act(() => button('Keep Playing').click());
  expect(mock.exit).toHaveBeenCalledTimes(1);
  expect(mock.giveUp).not.toHaveBeenCalled();
  await act(async () => button('Give Up and Reveal').click());
  expect(mock.giveUp).toHaveBeenCalledWith({ challengeNumber: 1 });
  expect(mock.navigate).toHaveBeenCalledWith('win');
  await expect.poll(() => container.textContent).toContain('Your results are ready');
  // Closing expanded mode still requires the user's click after the async operation.
  expect(mock.exit).toHaveBeenCalledTimes(1);
  await act(() => button('View Results').click());
  expect(mock.exit).toHaveBeenCalledTimes(2);
});

it('keeps failed Give Up recoverable without navigating to results', async () => {
  mock.giveUp.mockRejectedValue(new Error('offline'));
  await act(() => render(<GiveUpPanel />, container));
  await act(async () => button('Give Up and Reveal').click());
  await expect
    .poll(() => container.querySelector('[role="alert"]')?.textContent)
    .toContain('Could not give up');
  expect(mock.navigate).not.toHaveBeenCalled();
  expect(button('Give Up and Reveal').disabled).toBe(false);
});

it('retains the comment draft after failure, and only posts on explicit submission', async () => {
  await act(() => render(<CommentPanel />, container));
  expect(mock.comment).not.toHaveBeenCalled();
  const input = container.querySelector('textarea')!;
  await act(() => {
    input.value = 'My game journey';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Post Comment').click());
  expect(mock.comment).toHaveBeenCalledWith({ challengeNumber: 1, comment: 'My game journey' });
  expect(input.value).toBe('My game journey');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    'Your draft is still here'
  );
  mock.comment.mockResolvedValue({});
  await act(async () => button('Post Comment').click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain('comment was posted');
  expect(mock.exit).not.toHaveBeenCalled();
});

it('handles a score that is not available without leaking a puzzle answer', async () => {
  await act(async () => render(<ScorePanel />, container));
  expect(mock.game).toHaveBeenCalledWith({ challengeNumber: 1 });
  await expect.poll(() => container.textContent).toContain('No score is available');
});
