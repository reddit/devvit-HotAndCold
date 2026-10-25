import { render } from 'preact';
import { act } from 'preact/test-utils';
import { page } from '@vitest/browser/context';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import '../index.css';
import { Header } from './header';
import { ResultsActions, WinPage } from './WinPage';
import { setReminderOptIn } from './state/userSettings';
import { reminderBusy, reminderStatus } from './state/reminders';
import { settingsOpen } from './settings';
import { setActiveTestRun } from '../playtest/run';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_player', subredditName: 'testsub', postData: { challengeNumber: 1 } },
  showToast: vi.fn(),
  showShareSheet: (...args: unknown[]) => (globalThis as any).__gameControlsMock.share(...args),
  requestExpandedMode: (...args: unknown[]) =>
    (globalThis as any).__gameControlsMock.expand(...args),
}));
vi.mock('../trpc', () => ({
  trpc: new Proxy(
    {},
    { get: (_target, property) => (globalThis as any).__gameControlsMock[property] }
  ),
}));
vi.mock('../core/hints', async (original) => ({
  ...(await original<any>()),
  loadHintsForChallenge: () => (globalThis as any).__gameControlsMock.hints(),
}));
let container: HTMLDivElement;
let mock: any;
beforeEach(() => {
  setActiveTestRun(null);
  container = document.createElement('div');
  document.body.append(container);
  settingsOpen.value = false;
  setReminderOptIn(false);
  reminderBusy.value = false;
  reminderStatus.value = 'loading';
  mock = {
    share: vi.fn(),
    expand: vi.fn(),
    cta: {
      isOptedIntoReminders: { query: vi.fn().mockResolvedValue(false) },
      setReminder: { mutate: vi.fn().mockResolvedValue({}) },
      toggleReminder: { mutate: vi.fn().mockResolvedValue({ newValue: true }) },
      getCallToAction: { query: vi.fn().mockResolvedValue(null) },
    },
  };
  (globalThis as any).__gameControlsMock = mock;
});
afterEach(async () => {
  await act(() => render(null, container));
  setActiveTestRun(null);
  container.remove();
  delete (globalThis as any).__gameControlsMock;
  await page.viewport(1280, 720);
});
const mount = async (children: any) => {
  await act(async () => {
    render(children, container);
  });
};
const button = (label: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label') === label || button.textContent?.trim() === label
  );
const results = (
  <ResultsActions didWin challengeNumber={1} stats={{ score: 100, timeToSolve: '1m' }} />
);

it('restores the bell and direct moderator shield, enlarges branding, and removes the overflow menu', async () => {
  await mount(<Header isModerator />);
  await expect
    .poll(
      () =>
        Boolean(button('Turn On Daily Reminders')) && !button('Turn On Daily Reminders')!.disabled
    )
    .toBe(true);
  expect(button('Game Actions')).toBeUndefined();
  expect(button('Pssst… How to Play')).toBeDefined();
  const logo = container.querySelector<HTMLElement>('[aria-label="Hot and Cold"]')!;
  expect(logo.getBoundingClientRect().height).toBe(40);
  expect(container.querySelector('[aria-label="Game Toolbar"] svg')?.getAttribute('width')).toBe(
    '24'
  );
  await act(() => {
    button('Moderator Settings (Experimental)')!.click();
  });
  expect(mock.expand).toHaveBeenCalledWith(expect.any(MouseEvent), 'moderator-console', {
    title: 'Moderator Settings (Experimental)',
  });
  expect(settingsOpen.value).toBe(false);
});

it('fits all seven moderator toolbar controls in a narrow view without horizontal scrolling', async () => {
  await page.viewport(320, 440);
  container.style.width = '288px';
  await mount(<Header isModerator />);
  const toolbar = container.querySelector<HTMLElement>('[aria-label="Game Toolbar"]')!;
  expect(toolbar.querySelectorAll('button')).toHaveLength(7);
  expect(toolbar.scrollWidth).toBe(toolbar.clientWidth);
  expect(container.querySelector('header')!.getBoundingClientRect().height).toBeLessThanOrEqual(
    104
  );
});

it.each([
  [320, 440],
  [620, 512],
  [768, 600],
])('keeps the playtest chip at the regular header height at %s × %s', async (width, height) => {
  await page.viewport(width!, height!);
  container.style.width = `${width! - 32}px`;
  await mount(<Header isModerator />);
  const normal = container.querySelector('header')!.getBoundingClientRect();
  await act(() => render(null, container));
  setActiveTestRun({
    challengeNumber: 1_000_000_001,
    word: 'apple',
    postUrl: 'https://reddit.com/comments/test',
  });
  await mount(<Header isModerator />);
  const header = container.querySelector('header')!;
  expect(header.getBoundingClientRect().height).toBe(normal.height);
  expect(header.scrollWidth).toBe(header.clientWidth);
  expect(button('Playtest Controls')).toBeDefined();
  expect(header.textContent).not.toContain('Test Word');
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

it('offers a prominent reminder after solving, then hides it and updates the toolbar after opt-in', async () => {
  await mount(
    <>
      <Header isModerator={false} />
      {results}
    </>
  );
  await expect.poll(() => Boolean(button('Remind Me to Play Daily'))).toBe(true);
  await act(async () => {
    button('Remind Me to Play Daily')!.click();
  });
  await expect.poll(() => button('Remind Me to Play Daily')).toBeUndefined();
  expect(button('Turn Off Daily Reminders')!.getAttribute('aria-pressed')).toBe('true');
  expect(mock.cta.setReminder.mutate).toHaveBeenCalledTimes(1);
  expect(mock.cta.toggleReminder.mutate).not.toHaveBeenCalled();
});

it('hides the solved reminder for subscribers and keeps Share Results available with its icon even without another CTA', async () => {
  mock.cta.isOptedIntoReminders.query.mockResolvedValue(true);
  await mount(
    <>
      <Header isModerator={false} />
      {results}
    </>
  );
  await expect.poll(() => reminderStatus.value).toBe('ready');
  expect(button('Remind Me to Play Daily')).toBeUndefined();
  const share = button('Share Results')!;
  expect(share.querySelector('svg')).not.toBeNull();
  await act(async () => {
    share.click();
  });
  expect(mock.share).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringContaining('I solved Hot & Cold #1') })
  );
});

it('keeps long solved-page lists in one scrolling area with reachable navigation controls', async () => {
  await page.viewport(320, 440);
  container.className = 'flex h-[380px] w-[288px] flex-col';
  const words = Array.from({ length: 100 }, (_, i) => ({
    word: `hint${i}`,
    rank: i + 1,
    similarity: 0.8,
    isHint: true,
  }));
  mock.hints = vi.fn().mockResolvedValue(words);
  mock.game = {
    get: {
      query: vi.fn().mockResolvedValue({
        challengeInfo: { totalPlayers: 100 },
        challengeUserInfo: {
          username: 'player',
          solvedAtMs: 2000,
          startedPlayingAtMs: 1000,
          guesses: [{ word: 'apple', rank: 1, similarity: 1 }],
          score: null,
        },
      }),
    },
  };
  mock.leaderboard = {
    get: { query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: null }) },
  };
  await mount(<WinPage />);
  await expect.poll(() => Boolean(button('Closest'))).toBe(true);
  await act(() => {
    button('Closest')!.click();
  });
  const scroller = container.querySelector<HTMLElement>('[aria-label="Results"]')!;
  await expect.poll(() => scroller.scrollHeight > scroller.clientHeight).toBe(true);
  expect(
    Array.from(scroller.querySelectorAll('*')).filter((element) =>
      ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
    )
  ).toHaveLength(0);
  await expect.poll(() => Boolean(button('↓ Scroll Down'))).toBe(true);
  await act(() => {
    button('↓ Scroll Down')!.click();
  });
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
  await act(() => {
    button('Guesses')!.click();
  });
  expect(container.querySelector<HTMLElement>('[aria-label="Results"]')!.scrollTop).toBe(0);
  expect(container.scrollWidth).toBe(container.clientWidth);
});
