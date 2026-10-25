import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from '@vitest/browser/context';
import '../index.css';
import { ArchiveModal } from './archiveModal';
import {
  archiveEntries,
  archiveInitialized,
  archiveOpen,
  resetArchiveState,
} from './state/archive';

vi.mock('../requireChallengeNumber', () => ({ requireChallengeNumber: () => 2 }));
vi.mock('@devvit/web/client', () => ({
  context: { postData: { challengeNumber: 2 } },
  exitExpandedMode: () => {},
  requestExpandedMode: () => {},
  navigateTo: (url: string) => (globalThis as any).__archiveNavigate(url),
}));
vi.mock('../trpc', () => ({
  trpc: {
    archive: {
      list: { query: (...args: unknown[]) => (globalThis as any).__archiveQuery(...args) },
    },
  },
}));

let container: HTMLDivElement;
let navigate: ReturnType<typeof vi.fn>;
const url = 'https://www.reddit.com/r/test/comments/old';
beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  navigate = vi.fn().mockResolvedValue(undefined);
  (globalThis as any).__archiveNavigate = navigate;
  (globalThis as any).__archiveQuery = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  resetArchiveState();
  archiveEntries.value = [
    {
      challengeNumber: 1,
      totalPlayers: 0,
      totalSolves: 0,
      totalGuesses: 0,
      totalHints: 0,
      totalGiveUps: 0,
      status: 'not_played',
      score: null,
      startedPlayingAtMs: null,
      solvedAtMs: null,
      gaveUpAtMs: null,
      postUrl: url,
      postId: 't3_old',
    },
  ];
  archiveInitialized.value = true;
  archiveOpen.value = true;
  await act(() => render(<ArchiveModal />, container));
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  archiveOpen.value = false;
  resetArchiveState();
  delete (globalThis as any).__archiveNavigate;
  delete (globalThis as any).__archiveQuery;
  await page.viewport(1280, 720);
});

it('keeps the close button and one scrollable list inside a small expanded viewport', async () => {
  await page.viewport(320, 440);
  await act(() => {
    archiveEntries.value = Array.from({ length: 40 }, (_, index) => ({
      ...archiveEntries.value[0]!,
      challengeNumber: index + 1,
    }));
  });
  const list = container.querySelector<HTMLElement>('[aria-label="Archive Challenges"]')!;
  const close = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Close Archive'
  )!;
  expect(close.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(list.clientHeight).toBeGreaterThan(100);
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  list.scrollTop = list.scrollHeight;
  expect(list.scrollTop).toBeGreaterThan(0);
  expect(close.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
});

it.each(['empty', 'failed'])('does not repeatedly fetch an %s archive', async (kind) => {
  const query = (globalThis as any).__archiveQuery;
  if (kind === 'failed') query.mockRejectedValue(new Error('Try later'));
  await act(() => {
    resetArchiveState();
  });
  await expect.poll(() => query.mock.calls.length).toBe(1);
  await expect.poll(() => archiveInitialized.value).toBe(true);
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(query).toHaveBeenCalledTimes(1);
  if (kind === 'failed') {
    const retry = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Try Again'
    )!;
    await act(() => {
      retry.click();
    });
    await expect.poll(() => query.mock.calls.length).toBe(2);
  }
});

it('exposes the destination as a real link and preserves ordinary Reddit navigation', async () => {
  const link = container.querySelector('a')!;
  expect(link.href).toBe(url);
  expect(link.title).toBe(url);
  expect(link.textContent?.trim()).toBe('Play');
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => {
    link.dispatchEvent(event);
  });
  expect(event.defaultPrevented).toBe(true);
  expect(navigate).toHaveBeenCalledWith(url);
  expect(archiveOpen.value).toBe(false);
});

it('leaves modified clicks to the browser for opening a new tab', async () => {
  const link = container.querySelector('a')!;
  let intercepted = false;
  // Observe the app's decision, then prevent a real browser tab opening in this test.
  link.addEventListener('click', (event) => {
    intercepted = event.defaultPrevented;
    event.preventDefault();
  });
  await act(() => {
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  });
  expect(intercepted).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  expect(archiveOpen.value).toBe(true);
});
