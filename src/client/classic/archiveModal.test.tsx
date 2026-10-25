import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchiveModal } from './archiveModal';
import {
  archiveEntries,
  archiveInitialized,
  archiveOpen,
  resetArchiveState,
} from './state/archive';

vi.mock('../requireChallengeNumber', () => ({ requireChallengeNumber: () => 2 }));
vi.mock('@devvit/web/client', () => ({
  navigateTo: (url: string) => (globalThis as any).__archiveNavigate(url),
}));
vi.mock('../trpc', () => ({ trpc: { archive: { list: { query: vi.fn() } } } }));

let container: HTMLDivElement;
let navigate: ReturnType<typeof vi.fn>;
const url = 'https://www.reddit.com/r/test/comments/old';
beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  navigate = vi.fn().mockResolvedValue(undefined);
  (globalThis as any).__archiveNavigate = navigate;
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
