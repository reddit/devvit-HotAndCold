import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModeratorEntry } from './settings';
import '../../index.css';

vi.mock('@devvit/web/client', () => ({
  context: { subredditName: 'testsub' },
  requestExpandedMode: () => {},
  exitExpandedMode: () => {},
}));
vi.mock('../../trpc', () => ({
  trpc: {
    moderation: new Proxy(
      {},
      { get: (_target, property) => (globalThis as any).__moderationClientMock[property] }
    ),
  },
}));

describe('moderator settings entry points', () => {
  let container: HTMLDivElement;
  let overview: ReturnType<typeof vi.fn>;
  let access: ReturnType<typeof vi.fn>;
  let queue: ReturnType<typeof vi.fn>;
  let revealAnswer: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    access = vi.fn().mockResolvedValue({ isModerator: true });
    overview = vi.fn().mockResolvedValue({
      challenge: { challengeNumber: '1', totalPlayers: 0, totalSolves: 0 },
      queueSize: 75,
      lowQueueAlertsEnabled: false,
      notifications: { total: 0, next: [] },
      job: null,
      nextPostAtMs: Date.now(),
    });
    queue = vi.fn().mockImplementation(async ({ page }) => ({
      page,
      words: [{ word: 'secretqueuedword' }],
      expiresAtMs: Date.now() + 60_000,
    }));
    revealAnswer = vi.fn().mockImplementation(async () => ({
      challengeNumber: 1,
      word: 'secretanswer',
      expiresAtMs: Date.now() + 60_000,
    }));
    (globalThis as any).__moderationClientMock = {
      access: { query: access },
      overview: { query: overview },
      queue: { mutate: queue },
      revealAnswer: { mutate: revealAnswer },
      setLowQueueAlerts: {
        mutate: vi.fn().mockImplementation(async ({ enabled }) => ({ enabled })),
      },
      createTestPost: {
        mutate: vi.fn().mockResolvedValue({ postUrl: 'https://reddit.com/comments/test' }),
      },
    };
  });
  afterEach(async () => {
    vi.useRealTimers();
    await act(() => render(null, container));
    container.remove();
    delete (globalThis as any).__moderationClientMock;
  });
  const mount = async (launcher: boolean) => {
    await act(async () => {
      render(<ModeratorEntry launcher={launcher} />, container);
    });
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  };
  const button = (text: string) => {
    const element = Array.from(container.querySelectorAll('button')).find(
      (element) =>
        element.getAttribute('aria-label') === text || element.textContent?.trim() === text
    );
    expect(element, `Missing button: ${text}`).toBeDefined();
    return element!;
  };
  const click = async (text: string) => {
    await act(async () => button(text).click());
  };
  const loadConsole = async () => {
    await mount(false);
    await expect.poll(() => container.querySelector('nav')?.textContent ?? '').toContain('Words');
  };
  const fillRevealForm = async () => {
    const form = container.querySelector<HTMLFormElement>(
      'form[aria-label="Confirm Word Reveal"]'
    )!;
    const select = form.querySelector('select')!;
    const reason = form.querySelector('textarea')!;
    const promise = form.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const confirmation = form.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
    await act(() => {
      select.value = 'word_issue';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      reason.value = 'Investigating a player report about this puzzle.';
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      promise.checked = true;
      promise.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return {
      typeConfirmation: async () => {
        await act(() => {
          confirmation.value = 'REVEAL';
          confirmation.dispatchEvent(new Event('input', { bubbles: true }));
        });
      },
    };
  };

  it('keeps the inline launcher compact and does not fetch private dashboard data', async () => {
    await mount(true);
    expect(container.textContent).toContain('Open Moderator Settings');
    expect(container.querySelector('nav')).toBeNull();
    expect(overview).not.toHaveBeenCalled();
  });

  it('renders the separate expanded entry directly as the console', async () => {
    await loadConsole();
    expect(container.querySelector('nav')?.textContent).toContain('Storage');
    expect(container.textContent).not.toContain('Open Moderator Settings');
    expect(overview).toHaveBeenCalledTimes(1);
    expect(queue).not.toHaveBeenCalled();
    expect(revealAnswer).not.toHaveBeenCalled();
  });

  it('replaces the tabs and cards with ordered navigation summaries and loads actions only in the selected section', async () => {
    const inspect = vi.fn();
    (globalThis as any).__moderationClientMock.redisSample = { query: inspect };
    await loadConsole();
    const nav = container.querySelector('nav')!;
    expect(
      Array.from(nav.querySelectorAll('button')).map((element) =>
        element.getAttribute('aria-label')
      )
    ).toEqual(['Latest', 'Schedule', 'Reminders', 'Words', 'Storage']);
    expect(nav.textContent).toContain('75 Words · About 75 Days');
    expect(nav.textContent).toContain('Next Post');
    expect(nav.textContent).toContain('0 Pending Groups');
    expect(container.textContent).not.toContain('Dashboard');
    for (const section of ['Latest', 'Schedule', 'Reminders', 'Words', 'Storage']) {
      await click(section);
      expect(container.querySelector('[aria-current="page"]')?.getAttribute('aria-label')).toBe(
        section
      );
      expect(container.querySelector('#moderator-details-heading')?.textContent).toBe(section);
    }
    expect(queue).not.toHaveBeenCalled();
    expect(revealAnswer).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('persists the individual low-queue opt-in and leaves it unchanged on failure', async () => {
    await loadConsole();
    await click('Words');
    const toggle = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    const mutate = (globalThis as any).__moderationClientMock.setLowQueueAlerts.mutate;
    await act(async () => toggle().click());
    await expect.poll(() => toggle().getAttribute('aria-checked')).toBe('true');
    expect(mutate).toHaveBeenLastCalledWith({ enabled: true });
    await click('Schedule');
    expect(container.querySelector('[role="switch"]')).toBeNull();
    await click('Words');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    mutate.mockRejectedValueOnce(new Error('Unable to save preference.'));
    await act(async () => toggle().click());
    await expect
      .poll(() => container.querySelector('[role="alert"]')?.textContent)
      .toContain('Unable to save preference');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    await act(async () => toggle().click());
    await expect.poll(() => toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('places navigation on the right and keeps details beside it in a wide view', async () => {
    container.style.width = '900px';
    await loadConsole();
    const nav = container.querySelector('nav')!;
    const details = container.querySelector<HTMLElement>('#moderator-details')!;
    await expect.poll(() => getComputedStyle(details).display).toBe('block');
    expect(nav.getBoundingClientRect().left).toBeGreaterThan(details.getBoundingClientRect().right);
    expect(getComputedStyle(button('Back to Settings')).display).toBe('none');
    await click('Words');
    expect(getComputedStyle(nav).display).toBe('block');
    expect(getComputedStyle(details).display).toBe('block');
    expect(document.activeElement).toBe(container.querySelector('#moderator-details-heading'));
  });

  it('uses list then details on narrow screens, restores focus on Back, and has no nested panel scroller', async () => {
    container.style.width = '320px';
    await loadConsole();
    const main = container.querySelector('main')!;
    main.style.height = '440px';
    const nav = container.querySelector('nav')!;
    const details = container.querySelector<HTMLElement>('#moderator-details')!;
    await expect.poll(() => getComputedStyle(details).display).toBe('none');
    expect(getComputedStyle(nav).display).toBe('block');
    expect(main.scrollWidth).toBe(main.clientWidth);
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
    expect(
      Array.from(main.querySelectorAll('*')).filter((element) =>
        ['auto', 'scroll'].includes(getComputedStyle(element).overflowY)
      )
    ).toHaveLength(0);
    await click('Schedule');
    expect(getComputedStyle(nav).display).toBe('none');
    expect(getComputedStyle(details).display).toBe('block');
    expect(getComputedStyle(button('Back to Settings')).display).not.toBe('none');
    expect(document.activeElement).toBe(container.querySelector('#moderator-details-heading'));
    expect(container.textContent).toContain('Next Scheduled Post');
    const extra = Array.from(container.querySelectorAll('details')).find(
      (element) => element.querySelector('summary')?.textContent === 'Post an Extra Puzzle Now'
    );
    expect(extra?.open).toBe(false);
    expect(main.scrollWidth).toBe(main.clientWidth);
    await click('Back to Settings');
    expect(getComputedStyle(nav).display).toBe('block');
    expect(getComputedStyle(details).display).toBe('none');
    expect(document.activeElement).toBe(button('Schedule'));
    await click('Words');
    expect(container.textContent).toContain('Upcoming words are hidden.');
    await click('Request Queue Reveal');
    const form = await fillRevealForm();
    await form.typeConfirmation();
    await click('Confirm and Reveal Queue Page');
    await expect.poll(() => container.textContent).toContain('secretqueuedword');
    await click('Back to Settings');
    expect(container.textContent).not.toContain('secretqueuedword');
    await click('Words');
    expect(container.querySelector('form[aria-label="Confirm Word Reveal"]')).toBeNull();
    expect(container.textContent).not.toContain('secretqueuedword');
    expect(queue).toHaveBeenCalledTimes(1);
    // Resizing with a section selected preserves it and brings the list back beside it.
    container.style.width = '900px';
    await expect.poll(() => getComputedStyle(nav).display).toBe('block');
    expect(getComputedStyle(details).display).toBe('block');
    expect(container.querySelector('#moderator-details-heading')?.textContent).toBe('Words');
  });

  it('does not load the console or private data for non-moderators', async () => {
    access.mockResolvedValue({ isModerator: false });
    await mount(false);
    expect(container.textContent).toContain('available to this community’s moderators');
    expect(container.querySelector('nav')).toBeNull();
    expect(overview).not.toHaveBeenCalled();
  });

  it('keeps queued words unfetched until every confirmation is complete and hides them on page changes', async () => {
    await loadConsole();
    await click('Words');
    expect(container.textContent).toContain('Upcoming words are hidden.');
    expect(queue).not.toHaveBeenCalled();
    await click('Request Queue Reveal');
    expect(button('Confirm and Reveal Queue Page').disabled).toBe(true);
    const form = await fillRevealForm();
    expect(button('Confirm and Reveal Queue Page').disabled).toBe(true);
    expect(queue).not.toHaveBeenCalled();
    await form.typeConfirmation();
    await click('Confirm and Reveal Queue Page');
    await expect.poll(() => container.textContent).toContain('secretqueuedword');
    expect(queue).toHaveBeenCalledWith({
      page: 0,
      purpose: 'word_issue',
      reason: 'Investigating a player report about this puzzle.',
      promiseNotToCheat: true,
      confirmation: 'REVEAL',
    });
    await click('Next');
    expect(container.textContent).not.toContain('secretqueuedword');
    expect(container.textContent).toContain('Page 2');
    expect(queue).toHaveBeenCalledTimes(1);
    await click('Previous');
    expect(container.textContent).not.toContain('secretqueuedword');
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it('hides a confirmed answer after 60 seconds and when leaving the view', async () => {
    await loadConsole();
    await click('Latest');
    const reveal = async () => {
      await click('Request Answer Reveal');
      const form = await fillRevealForm();
      await form.typeConfirmation();
      await click('Confirm and Reveal Answer');
      await expect.poll(() => container.textContent).toContain('secretanswer');
    };
    await reveal();
    await act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(container.textContent).not.toContain('secretanswer');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await reveal();
    await act(() => {
      vi.advanceTimersByTime(60_001);
    });
    expect(container.textContent).not.toContain('secretanswer');
    expect(container.textContent).toContain('Request Answer Reveal');
    vi.useRealTimers();
    await reveal();
    await click('Words');
    expect(container.textContent).not.toContain('secretanswer');
    await click('Latest');
    expect(container.textContent).not.toContain('secretanswer');
  });

  it('does not reveal a late response after the moderator cancels or switches tabs', async () => {
    let resolveAnswer!: (result: unknown) => void;
    revealAnswer.mockReturnValue(new Promise((resolve) => (resolveAnswer = resolve)));
    await loadConsole();
    await click('Latest');
    await click('Request Answer Reveal');
    const form = await fillRevealForm();
    await form.typeConfirmation();
    await click('Confirm and Reveal Answer');
    expect(revealAnswer).toHaveBeenCalledTimes(1);
    await click('Storage');
    await act(() =>
      resolveAnswer({
        challengeNumber: 1,
        word: 'secretanswer',
        expiresAtMs: Date.now() + 60_000,
      })
    );
    await click('Latest');
    expect(container.textContent).not.toContain('secretanswer');
  });

  it('offers test-post creation only when the server identifies a playtest build', async () => {
    await loadConsole();
    await click('Schedule');
    expect(container.textContent).not.toContain('Playtest Tools');
    overview.mockResolvedValue({
      challenge: null,
      queueSize: 1,
      notifications: { total: 0, next: [] },
      job: null,
      nextPostAtMs: Date.now(),
      playtestAvailable: true,
    });
    await click('Refresh');
    await expect.poll(() => container.textContent).toContain('Playtest Tools');
    expect(container.querySelector<HTMLInputElement>('#test-word')?.value).toBe('apple');
    await click('Create Test Post');
    await expect.poll(() => container.textContent).toContain('Open Test Post');
    expect((globalThis as any).__moderationClientMock.createTestPost.mutate).toHaveBeenCalledWith({
      word: 'apple',
    });
  });

  const storageRow = (challengeNumber: number, cacheBytes = 2048) => ({
    challengeNumber,
    cacheBytes,
    compactCacheBytes: 100,
    players: 0,
    progressPlayers: 0,
    sampledPlayers: 0,
    sampledGuessBytes: 0,
  });
  const checkbox = (label: string) =>
    container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

  it('clears selection and acknowledgement when inspecting a different storage sample', async () => {
    const sample = vi
      .fn()
      .mockResolvedValueOnce({ rows: [storageRow(10)], nextEnd: 5, dictionaryBytes: 100 })
      .mockResolvedValueOnce({ rows: [storageRow(5)], nextEnd: null, dictionaryBytes: 100 });
    (globalThis as any).__moderationClientMock.redisSample = { query: sample };
    await loadConsole();
    await click('Storage');
    await click('Inspect Latest Puzzles');
    await expect.poll(() => Boolean(checkbox('Select Puzzle #10'))).toBe(true);
    await act(() => {
      checkbox('Select Puzzle #10').click();
    });
    const acknowledgement = Array.from(container.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('I Understand the Selected Outage'))!
      .querySelector('input')!;
    await act(() => {
      acknowledgement.click();
    });
    expect(button('Clear Selected Caches').disabled).toBe(false);
    await click('Inspect Older Puzzles');
    await expect.poll(() => Boolean(checkbox('Select Puzzle #5'))).toBe(true);
    expect(checkbox('Select Puzzle #5').checked).toBe(false);
    expect(button('Clear Selected Caches').disabled).toBe(true);
    expect(sample).toHaveBeenLastCalledWith({ endChallenge: 5 });
  });

  it('passes only selected puzzles to cleanup and refreshes the sample afterward', async () => {
    const sample = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [storageRow(2), storageRow(1)],
        nextEnd: null,
        dictionaryBytes: 100,
      })
      .mockResolvedValueOnce({
        rows: [storageRow(2), storageRow(1, 0)],
        nextEnd: null,
        dictionaryBytes: 100,
      });
    const clear = vi.fn().mockResolvedValue({ cleared: 1, bytes: 2048 });
    (globalThis as any).__moderationClientMock.redisSample = { query: sample };
    (globalThis as any).__moderationClientMock.clearWordCaches = { mutate: clear };
    await loadConsole();
    await click('Storage');
    await click('Inspect Latest Puzzles');
    await expect.poll(() => Boolean(checkbox('Select Puzzle #1'))).toBe(true);
    await act(() => {
      checkbox('Select Puzzle #1').click();
    });
    const acknowledgement = Array.from(container.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('I Understand the Selected Outage'))!
      .querySelector('input')!;
    await act(() => {
      acknowledgement.click();
    });
    await click('Clear Selected Caches');
    await expect.poll(() => clear.mock.calls.length).toBe(1);
    expect(clear).toHaveBeenCalledWith({ challengeNumbers: [1], confirm: 'CLEAR_CACHES' });
    await expect.poll(() => sample.mock.calls.length).toBe(2);
    await expect.poll(() => checkbox('Select Puzzle #1').disabled).toBe(true);
    expect(button('Clear Selected Caches').disabled).toBe(true);
    expect(container.textContent).toContain('Game data and compact caches were preserved');
  });
});
