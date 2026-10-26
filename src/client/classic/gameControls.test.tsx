import { render } from 'preact';
import { act } from 'preact/test-utils';
import { page, userEvent } from '@vitest/browser/context';
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
import { InlineResults } from './inlineResults';
import { PlayPage } from './PlayPage';
import { soundEnabled } from './feedback/audio';
import { ExpandedPage } from '../shared/expandedPage';
import { ResultsIcon } from './icons';
import { ErrorBoundary } from '../shared/error';

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
      hasJoinedSubreddit: { query: vi.fn().mockResolvedValue(true) },
    },
    audioSettings: {
      get: { query: vi.fn().mockResolvedValue({ enabled: null }) },
      set: { mutate: vi.fn().mockResolvedValue({}) },
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

it('fits all six moderator toolbar controls in a narrow view without horizontal scrolling', async () => {
  await page.viewport(320, 440);
  container.style.width = '288px';
  await mount(<Header isModerator />);
  const toolbar = container.querySelector<HTMLElement>('[aria-label="Game Toolbar"]')!;
  expect(toolbar.querySelectorAll('button')).toHaveLength(6);
  expect(toolbar.scrollWidth).toBe(toolbar.clientWidth);
  expect(container.querySelector('header')!.getBoundingClientRect().height).toBeLessThanOrEqual(
    104
  );
});

it.each([
  [320, 440],
  [390, 520],
  [620, 512],
])(
  'aligns the muted sound control, input, and Guess at %s × %s without stealing keyboard input',
  async (width, height) => {
    await page.viewport(width!, height!);
    soundEnabled.value = false;
    const engine: GuessEngine = {
      history: signal([{ word: 'box', rank: 10928, similarity: 0.2, timestamp: 1 }]),
      isSubmitting: signal(false),
      solvedAtMs: signal<number | null>(null),
      lastResult: signal(null),
      hasGuessed: vi.fn(),
      clear: vi.fn(),
      submit: vi.fn(),
      submitHint: vi.fn(),
    };
    await mount(
      <div className="relative isolate flex h-[100dvh] flex-col overflow-hidden bg-white px-4 py-6 text-gray-900 dark:bg-gray-950 dark:text-white">
        <Header isModerator />
        <PlayPage engine={engine} />
      </div>
    );
    const sound = container.querySelector<HTMLButtonElement>('[data-sound-toggle]')!;
    const input = container.querySelector('input')!;
    const guess = button('Guess')!;
    const controls = [sound, input, guess].map((element) => element.getBoundingClientRect());
    expect(controls.map(({ height }) => height)).toEqual([48, 48, 48]);
    expect(controls[0]!.top).toBe(controls[1]!.top);
    expect(controls[1]!.top).toBe(controls[2]!.top);
    expect(controls[0]!.right).toBeLessThan(controls[1]!.left);
    expect(controls[1]!.right).toBeLessThan(controls[2]!.left);
    expect(controls[2]!.right).toBeLessThanOrEqual(width! - 16);
    expect(input.getBoundingClientRect().width).toBeGreaterThan(120);
    expect(container.querySelector('[aria-label="Game Toolbar"] [data-sound-toggle]')).toBeNull();
    expect(container.scrollWidth).toBe(container.clientWidth);
    const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (width === 620)
      await page.screenshot({ path: `__screenshots__/sound-beside-input-${theme}.png` });
    sound.focus();
    await userEvent.keyboard(' ');
    await expect.poll(() => sound.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(sound);
    expect(input.value).toBe('');
    expect(engine.submit).not.toHaveBeenCalled();
  }
);

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

it.each([
  [720, 594, true, 'COMMENT'],
  [620, 512, true, 'COMMENT'],
  [390, 600, true, null],
  [320, 640, true, null],
  [720, 594, false, 'COMMENT'],
  [320, 640, false, 'COMMENT'],
] as const)(
  'fits Me and Global summaries and every action at %s × %s (win: %s, CTA: %s)',
  async (width, height, didWin, cta) => {
    await page.viewport(width, height);
    localStorage.setItem('results-tab:1', '0');
    mock.cta.getCallToAction.query.mockResolvedValue(cta);
    mock.game = {
      get: {
        query: vi.fn().mockResolvedValue({
          challengeInfo: {
            totalPlayers: 1234567,
            totalSolves: 678901,
            totalGuesses: 123456789,
            totalHints: 123456,
            totalGiveUps: 12345,
          },
          challengeUserInfo: {
            username: 'player',
            startedPlayingAtMs: 1000,
            ...(didWin ? { solvedAtMs: 2862000 } : { gaveUpAtMs: 2862000 }),
            guesses: [
              { word: 'fruit', rank: 10000, similarity: 0.6, timestampMs: 1000 },
              { word: 'apple', rank: 0, similarity: 1, timestampMs: 2862000 },
            ],
            score: { finalScore: 60 },
          },
        }),
      },
    };
    mock.leaderboard = {
      get: { query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: { score: 1 } }) },
    };
    await mount(
      <ExpandedPage title="Results" icon={<ResultsIcon />} compactSpacing>
        <WinPage expanded />
      </ExpandedPage>
    );
    await expect.poll(() => Boolean(button('Share Results'))).toBe(true);
    if (didWin) await expect.poll(() => Boolean(button('Remind Me to Play Daily'))).toBe(true);
    if (cta)
      await expect.poll(() => Boolean(button('Share Your Journey in the Thread'))).toBe(true);
    const assertFits = () => {
      const main = container.querySelector('main')!;
      expect(main.scrollHeight).toBeLessThanOrEqual(main.clientHeight);
      expect(main.scrollWidth).toBe(main.clientWidth);
      for (const action of Array.from(main.querySelectorAll('button'))) {
        const bounds = action.getBoundingClientRect();
        expect(bounds.bottom).toBeLessThanOrEqual(main.getBoundingClientRect().bottom);
      }
      for (const card of Array.from(main.querySelectorAll('.result-stat'))) {
        expect(card.scrollWidth).toBe(card.clientWidth);
      }
    };
    assertFits();
    await act(() => button('Global')!.click());
    expect(container.querySelector('[aria-label^="Player outcomes"]')).not.toBeNull();
    assertFits();
  }
);

it('allows one native page scroll instead of clipping summary actions on very short screens', async () => {
  await page.viewport(320, 320);
  localStorage.setItem('results-tab:1', '0');
  mock.game = {
    get: {
      query: vi.fn().mockResolvedValue({
        challengeInfo: {},
        challengeUserInfo: {
          solvedAtMs: 2000,
          startedPlayingAtMs: 1000,
          guesses: [{ word: 'apple', rank: 0, similarity: 1 }],
        },
      }),
    },
  };
  mock.leaderboard = {
    get: { query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: null }) },
  };
  await mount(
    <ExpandedPage title="Results" compactSpacing>
      <WinPage expanded />
    </ExpandedPage>
  );
  await expect.poll(() => Boolean(button('Remind Me to Play Daily'))).toBe(true);
  const main = container.querySelector('main')!;
  expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
  const nestedScrollers = Array.from(main.querySelectorAll<HTMLElement>('*')).filter(
    (element) =>
      element.scrollHeight > element.clientHeight &&
      ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
  );
  expect(nestedScrollers).toHaveLength(0);
  main.scrollTop = main.scrollHeight;
  expect(button('Share Results')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    main.getBoundingClientRect().bottom
  );
});

it.each([true, false])(
  'fits the expanded guest summary without scrolling (win: %s)',
  async (didWin) => {
    await page.viewport(320, 520);
    mock.game = { reveal: { query: vi.fn().mockResolvedValue({ secretWord: 'apple' }) } };
    const engine = {
      history: signal([
        { word: 'fruit', rank: 10000, similarity: 0.6, timestamp: 1000 },
        ...(didWin ? [{ word: 'apple', rank: 0, similarity: 1, timestamp: 2000 }] : []),
      ]),
    } as GuessEngine;
    await mount(
      <ExpandedPage title="Results" icon={<ResultsIcon />} compactSpacing>
        <WinPageLoggedOut engine={engine} expanded />
      </ExpandedPage>
    );
    await expect.poll(() => container.textContent).toContain('apple');
    const main = container.querySelector('main')!;
    expect(main.scrollHeight).toBeLessThanOrEqual(main.clientHeight);
    expect(main.scrollWidth).toBe(main.clientWidth);
    expect(button('Share Results')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      main.getBoundingClientRect().bottom
    );
  }
);

it('shows the branded splash until results data arrives, then replaces it with the game', async () => {
  let finish: (value: any) => void = () => {};
  mock.game = {
    get: {
      query: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      ),
    },
  };
  mock.leaderboard = {
    get: { query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: null }) },
  };
  await mount(<WinPage />);
  const loading = container.querySelector('[role="status"][aria-label="Loading Hot and Cold"]');
  expect(loading).not.toBeNull();
  expect(loading?.textContent).toContain('Hot & Cold');
  expect(button('View Results')).toBeUndefined();
  await act(async () => finish({ challengeInfo: {}, challengeUserInfo: { guesses: [] } }));
  await expect.poll(() => Boolean(button('View Results'))).toBe(true);
  expect(container.querySelector('[aria-label="Loading Hot and Cold"]')).toBeNull();
});

it.each([
  [620, 512],
  [320, 360],
])(
  'centers the results loader after mounting over the initial HTML splash at %s × %s',
  async (width, height) => {
    await page.viewport(width!, height!);
    container.innerHTML = `
    <div class="loading-splash" role="status" aria-label="Loading Hot and Cold">
      <div class="loading-splash__spinner" aria-hidden="true">
        <img src="/assets/hot-and-cold-icon.png" alt="" width="144" height="144" />
      </div>
      <div class="loading-splash__caption">
        <p class="loading-splash__name" aria-hidden="true">Hot &amp; Cold</p>
        <p class="loading-splash__message">Loading…</p>
      </div>
    </div>`;
    mock.game = { get: { query: vi.fn(() => new Promise(() => {})) } };
    mock.leaderboard = {
      get: { query: vi.fn().mockResolvedValue({ leaderboardByScore: [], userRank: null }) },
    };
    await mount(
      <ErrorBoundary>
        <div className="relative isolate h-[100dvh] min-h-[100dvh] w-full overflow-hidden">
          <div className="mx-auto flex h-full min-h-0 max-w-2xl flex-col overflow-hidden px-4 py-6 md:px-6">
            <Header isModerator={false} showSoundControl />
            <WinPage />
          </div>
        </div>
      </ErrorBoundary>
    );
    const loaders = container.querySelectorAll('.loading-splash');
    expect(loaders).toHaveLength(1);
    const loader = loaders[0]!;
    const image = loader.querySelector('img')!.getBoundingClientRect();
    const bounds = loader.getBoundingClientRect();
    expect(getComputedStyle(loader).display).toBe('grid');
    expect(Math.abs(image.x + image.width / 2 - (bounds.x + bounds.width / 2))).toBeLessThan(1);
    expect(Math.abs(image.y + image.height / 2 - (bounds.y + bounds.height / 2))).toBeLessThan(1);
    expect(container.querySelectorAll('.loading-splash__spinner')).toHaveLength(1);
    expect(
      loader.querySelector('.loading-splash__caption')!.getBoundingClientRect().bottom
    ).toBeLessThanOrEqual(bounds.bottom);
  }
);

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
    const art = summary.querySelector<SVGElement>('[data-result-art="hot"]')!;
    expect(art.getAttribute('aria-hidden')).toBe('true');
    expect(art.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
    expect(art.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      summary.getBoundingClientRect().top
    );
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
    expect(button('View Results')?.querySelector('svg')).not.toBeNull();
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
  expect(container.querySelector('[data-result-art="cold"]')).not.toBeNull();
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

it.each([true, false])(
  'keeps View Results opaque and readable with the matching artwork (win: %s)',
  async (didWin) => {
    await page.viewport(700, 512);
    const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    await mount(
      <div className="relative isolate flex h-[100dvh] flex-col overflow-hidden bg-white px-4 py-6 text-gray-900 dark:bg-gray-950 dark:text-white">
        <Header isModerator />
        <InlineResults
          didWin={didWin}
          word={didWin ? 'mountain' : 'ocean'}
          stats={[
            { label: didWin ? 'Score' : 'Guesses', value: didWin ? 86 : 11 },
            { label: 'Time', value: didWin ? '3m 25s' : '36h 40m' },
            { label: 'Rank', value: didWin ? '#1' : '—' },
          ]}
          guesses={Array.from({ length: 17 }, (_, i) => ({
            rank: i === 16 ? (didWin ? 0 : 33) : Math.round(30000 / (i + 1)),
            timestamp: i,
          }))}
          actions={
            <ResultsActions
              compact
              didWin={didWin}
              challengeNumber={1}
              stats={{ score: 86, timeToSolve: '3m 25s' }}
            />
          }
        />
      </div>
    );
    if (didWin) await expect.poll(() => Boolean(button('Remind Me to Play Daily'))).toBe(true);
    const style = getComputedStyle(button('View Results')!);
    const colorBytes = (color: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    };
    const luminance = (color: number[]) =>
      color
        .slice(0, 3)
        .map((channel) => channel / 255)
        .map((channel) =>
          channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        )
        .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
    const background = colorBytes(style.backgroundColor);
    expect(background[3]).toBe(255);
    const foreground = luminance(colorBytes(style.color));
    const base = luminance(background);
    expect(
      (Math.max(foreground, base) + 0.05) / (Math.min(foreground, base) + 0.05)
    ).toBeGreaterThanOrEqual(7);
    const art = container.querySelector<SVGElement>(
      `[data-result-art="${didWin ? 'hot' : 'cold'}"]`
    )!;
    expect(art.getBoundingClientRect().height).toBe(88);
    expect(art.getAnimations()).toHaveLength(0);
    expect(
      container.querySelector('[aria-label="Puzzle Results"]')!.scrollHeight
    ).toBeLessThanOrEqual(container.querySelector('[aria-label="Puzzle Results"]')!.clientHeight);
    await page.screenshot({
      path: `__screenshots__/result-${didWin ? 'hot' : 'cold'}-${theme}.png`,
    });
  }
);

it('shares the standings page with its graph, keeps Global local, and ignores stale summary responses', async () => {
  localStorage.setItem('results-tab:1', '0');
  mock.game = {
    get: {
      query: vi.fn().mockResolvedValue({
        challengeInfo: { totalPlayers: 100, totalSolves: 30, totalGiveUps: 10 },
        challengeUserInfo: {
          username: 'player',
          solvedAtMs: 2000,
          startedPlayingAtMs: 1000,
          guesses: [{ word: 'apple', rank: 0, similarity: 1 }],
          score: null,
        },
      }),
    },
  };
  let finishSummary: (data: unknown) => void = () => {};
  const entries = Array.from({ length: 10 }, (_, index) => ({
    member: index === 4 ? 'player' : `finisher${index}`,
    score: 100 - index * 5,
  }));
  mock.leaderboard = {
    get: {
      query: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishSummary = resolve;
            })
        )
        .mockResolvedValue({ leaderboardByScore: entries, userRank: { score: 5 } }),
    },
  };
  await mount(<WinPage expanded />);
  await expect.poll(() => Boolean(button('Global'))).toBe(true);
  expect(mock.leaderboard.get.query).toHaveBeenCalledWith({
    challengeNumber: 1,
    start: 0,
    stop: 0,
  });
  await act(() => button('Global')!.click());
  expect(
    container.querySelector('[aria-label^="Player outcomes"]')?.getAttribute('aria-label')
  ).toContain('30 solved, 10 gave up, 60 unfinished');
  expect(mock.leaderboard.get.query).toHaveBeenCalledTimes(1);
  await act(() => button('Standings')!.click());
  await expect
    .poll(() => container.querySelectorAll('table[aria-label="Standings"] tbody tr').length)
    .toBe(10);
  expect(mock.leaderboard.get.query).toHaveBeenLastCalledWith({
    challengeNumber: 1,
    start: 0,
    stop: 49,
  });
  expect(container.querySelectorAll('svg[aria-label^="Scores"] rect')).toHaveLength(10);
  expect(container.querySelector('tr[aria-current="true"]')?.textContent).toContain('player (You)');
  await act(async () => {
    finishSummary({ leaderboardByScore: [entries[0]], userRank: { score: 999 } });
  });
  expect(container.querySelectorAll('table[aria-label="Standings"] tbody tr')).toHaveLength(10);
  expect(
    container.querySelector('svg[aria-label^="Scores"]')?.getAttribute('aria-label')
  ).toContain('Your position in this chart: 5');
  expect(container.textContent).not.toContain('#999');
});

it('distinguishes a failed standings request from an empty leaderboard and can retry', async () => {
  localStorage.setItem('results-tab:1', '4');
  mock.game = {
    get: {
      query: vi.fn().mockResolvedValue({ challengeInfo: {}, challengeUserInfo: { guesses: [] } }),
    },
  };
  mock.leaderboard = {
    get: {
      query: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue({ leaderboardByScore: [], userRank: null }),
    },
  };
  await mount(<WinPage expanded />);
  await expect
    .poll(() => container.querySelector('[role="alert"]')?.textContent)
    .toContain('Could not load standings');
  expect(container.textContent).not.toContain('No one has completed');
  await act(() => button('Try Again')!.click());
  await expect.poll(() => container.textContent).toContain('No one has completed');
  expect(container.querySelector('svg[aria-label^="Scores"]')).toBeNull();
});
