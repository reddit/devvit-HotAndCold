import { render } from 'preact';
import { act } from 'preact/test-utils';
import { page } from '@vitest/browser/context';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import '../index.css';
import { Header } from './header';
import { ResultsActions, WinPage } from './WinPage';
import { WinPageLoggedOut } from './WinPageLoggedOut';
import { signal } from '@preact/signals';
import type { GuessEngine } from '../core/guessEngine';
import { setReminderOptIn } from './state/userSettings';
import { reminderBusy, reminderStatus } from './state/reminders';
import { setActiveTestRun } from '../playtest/run';
import { takeInitialModeratorSection } from './moderator/launch';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_player', subredditName: 'testsub', postData: { challengeNumber: 1 } },
  showToast: vi.fn(),
  exitExpandedMode: vi.fn(),
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
  await act(() => button('Settings')!.click());
  expect(mock.expand).toHaveBeenLastCalledWith(expect.any(MouseEvent), 'player-settings', {
    title: 'Settings',
  });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
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
  [0, 'empty'],
  [1, 'low'],
  [7, 'low'],
  [8, null],
  [null, null],
] as const)(
  'shows moderator queue attention for %s words without changing toolbar size',
  async (queueSize, health) => {
    await page.viewport(320, 440);
    container.style.width = '288px';
    await mount(<Header isModerator queueSize={queueSize} />);
    const badge = container.querySelector('[data-moderator-queue-badge]');
    expect(badge?.getAttribute('data-moderator-queue-badge') ?? null).toBe(health);
    const shield = button('Moderator Settings (Experimental)')!;
    if (health) {
      expect(shield.title).toContain(
        health === 'empty' ? 'Word Queue Empty' : 'Word Queue Running Low'
      );
      expect(container.querySelector('#moderator-queue-warning')?.textContent).toContain(
        `${queueSize} upcoming words`
      );
    }
    await act(() => shield.click());
    expect(takeInitialModeratorSection()).toBe(health ? 'Words' : 'Latest');
    const toolbar = container.querySelector<HTMLElement>('[aria-label="Game Toolbar"]')!;
    expect(toolbar.scrollWidth).toBe(toolbar.clientWidth);
    expect(container.querySelector('header')!.getBoundingClientRect().height).toBeLessThanOrEqual(
      104
    );
  }
);

it('keeps queue counts and moderator badges out of the player toolbar', async () => {
  await mount(<Header isModerator={false} queueSize={0} />);
  expect(button('Moderator Settings (Experimental)')).toBeUndefined();
  expect(container.querySelector('[data-moderator-queue-badge]')).toBeNull();
  expect(container.textContent).not.toContain('Word Queue');
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

it('keeps long solved-page lists in one scrolling area with native scrolling', async () => {
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
  await mount(<WinPage expanded />);
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
  expect(button('↓ Scroll Down')).toBeUndefined();
  scroller.scrollTop = scroller.scrollHeight;
  expect(scroller.scrollTop).toBeGreaterThan(0);
  await act(() => {
    button('Guesses')!.click();
  });
  expect(container.querySelector<HTMLElement>('[aria-label="Results"]')!.scrollTop).toBe(0);
  expect(container.scrollWidth).toBe(container.clientWidth);
});

it('opens full results from the compact inline summary without showing inline tabs or lists', async () => {
  mock.hints = vi.fn().mockResolvedValue([]);
  mock.game = {
    get: {
      query: vi.fn().mockResolvedValue({ challengeInfo: {}, challengeUserInfo: { guesses: [] } }),
    },
  };
  mock.leaderboard = {
    get: { query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: null }) },
  };
  await mount(<WinPage />);
  await expect.poll(() => Boolean(button('View Results'))).toBe(true);
  await act(() => button('View Results')!.click());
  expect(mock.expand).toHaveBeenCalledWith(expect.any(MouseEvent), 'results', { title: 'Results' });
  expect(localStorage.getItem('results-tab:1')).toBe('0');
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  expect(
    getComputedStyle(container.querySelector('[aria-label="Puzzle Results"]')!).overflowY
  ).toBe('clip');
  expect(mock.hints).not.toHaveBeenCalled();
  expect(mock.cta.getCallToAction.query).not.toHaveBeenCalled();
});

it.each([
  [320, 360],
  [320, 440],
  [390, 520],
  [620, 512],
  [768, 600],
])(
  'keeps the complete inline win and its actions visible without scrolling at %s × %s',
  async (width, height) => {
    await page.viewport(width!, height!);
    const guesses = Array.from({ length: 99 }, (_, index) => ({
      word: `guess${index}`,
      rank: index % 3 ? 1000 - index * 8 : 40000,
      similarity: 0.5,
      timestampMs: index + 1000,
    }));
    guesses.push({
      word: 'pneumonoultramicroscopicsilicovolcanoconiosis',
      rank: 1,
      similarity: 1,
      timestampMs: 73000,
    });
    mock.hints = vi.fn();
    mock.game = {
      get: {
        query: vi.fn().mockResolvedValue({
          challengeInfo: { totalPlayers: 100, totalSolves: 25 },
          challengeUserInfo: {
            guesses,
            startedPlayingAtMs: 1000,
            solvedAtMs: 73000,
            score: { finalScore: 96 },
          },
        }),
      },
    };
    mock.leaderboard = {
      get: {
        query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: { score: 12 } }),
      },
    };
    await mount(
      <div className="mx-auto flex h-[100dvh] min-h-0 max-w-2xl flex-col overflow-hidden px-4 py-6 md:px-6">
        <Header isModerator />
        <WinPage />
      </div>
    );
    await expect.poll(() => Boolean(button('Remind Me to Play Daily'))).toBe(true);
    const summary = container.querySelector<HTMLElement>('[aria-label="Puzzle Results"]')!;
    expect(summary.querySelector('.temperature-backdrop--victory')).not.toBeNull();
    const bounds = summary.getBoundingClientRect();
    expect(summary.scrollHeight).toBeLessThanOrEqual(summary.clientHeight);
    expect(summary.scrollWidth).toBe(summary.clientWidth);
    expect(container.scrollWidth).toBe(container.clientWidth);
    for (const action of Array.from(summary.querySelectorAll<HTMLButtonElement>('button'))) {
      action.focus();
      const frame = action.getBoundingClientRect();
      expect(frame.top).toBeGreaterThanOrEqual(bounds.top);
      expect(frame.bottom).toBeLessThanOrEqual(bounds.bottom);
      expect(frame.bottom).toBeLessThanOrEqual(height! - 20);
      expect(frame.left).toBeGreaterThanOrEqual(bounds.left);
      expect(frame.right).toBeLessThanOrEqual(bounds.right);
      expect(summary.scrollTop).toBe(0);
    }
    summary.scrollTop = 1000;
    expect(summary.scrollTop).toBe(0);
    expect(button('Share Results')?.querySelector('svg')).not.toBeNull();
    expect(button('View Results')).toBeDefined();
    expect(mock.hints).not.toHaveBeenCalled();
    const chart = summary.querySelector<HTMLElement>('.inline-results-chart')!;
    if (width! >= 620) expect(chart.getBoundingClientRect().height).toBeGreaterThan(0);
    if (height! === 360) expect(getComputedStyle(chart).display).toBe('none');
  }
);

it('does not turn a Give Up reveal into a winning point in the journey chart', async () => {
  mock.game = {
    get: {
      query: vi.fn().mockResolvedValue({
        challengeInfo: {},
        challengeUserInfo: {
          gaveUpAtMs: 3000,
          startedPlayingAtMs: 1000,
          guesses: [
            { word: 'tree', rank: 1000, similarity: 0.1, timestampMs: 1000 },
            { word: 'pear', rank: 4, similarity: 0.9, timestampMs: 2000 },
            { word: 'apple', rank: 0, similarity: 1, isHint: true, timestampMs: 3000 },
          ],
        },
      }),
    },
  };
  mock.leaderboard = {
    get: { query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: null }) },
  };
  await mount(
    <div className="flex h-[400px] flex-col">
      <WinPage />
    </div>
  );
  await expect.poll(() => container.textContent).toContain('Nice Try!');
  expect(container.querySelector('.temperature-backdrop--frozen')).not.toBeNull();
  expect(container.querySelector('.temperature-backdrop--victory')).toBeNull();
  const chart = container.querySelector('svg[aria-label^="Guess journey"]')!;
  expect(chart.getAttribute('aria-label')).toContain('over 2 guesses. Best rank 4');
  expect(container.textContent).toContain('apple');
  expect(button('Remind Me to Play Daily')).toBeUndefined();
});

it('keeps guest results and their actions inside a short inline post too', async () => {
  await page.viewport(320, 360);
  const engine = {
    history: signal([
      { word: 'pear', rank: 4, similarity: 0.9, timestamp: 1000 },
      { word: 'apple', rank: 1, similarity: 1, timestamp: 2000 },
    ]),
  } as GuessEngine;
  await mount(
    <div className="mx-auto flex h-[100dvh] max-w-2xl flex-col overflow-hidden px-4 py-6">
      <Header isModerator={false} />
      <WinPageLoggedOut engine={engine} />
    </div>
  );
  await expect.poll(() => container.textContent).toContain('apple');
  const summary = container.querySelector<HTMLElement>('[aria-label="Puzzle Results"]')!;
  expect(summary.scrollHeight).toBeLessThanOrEqual(summary.clientHeight);
  for (const action of Array.from(summary.querySelectorAll<HTMLButtonElement>('button'))) {
    action.focus();
    expect(action.getBoundingClientRect().bottom).toBeLessThanOrEqual(340);
    expect(summary.scrollTop).toBe(0);
  }
  expect(button('Share Results')).toBeDefined();
  expect(button('View Results')).toBeDefined();
});
