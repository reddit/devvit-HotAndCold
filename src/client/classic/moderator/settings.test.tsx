import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModeratorEntry } from './settings';

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
      (element) => element.textContent?.trim() === text
    );
    expect(element, `Missing button: ${text}`).toBeDefined();
    return element!;
  };
  const click = async (text: string) => {
    await act(async () => button(text).click());
  };
  const loadConsole = async () => {
    await mount(false);
    await expect
      .poll(() => container.querySelector('nav')?.textContent ?? '')
      .toContain('Word Queue');
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
    expect(container.querySelector('nav')?.textContent).toContain('Redis');
    expect(container.textContent).not.toContain('Open Moderator Settings');
    expect(overview).toHaveBeenCalledTimes(1);
    expect(queue).not.toHaveBeenCalled();
    expect(revealAnswer).not.toHaveBeenCalled();
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
    await click('Word Queue');
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
    await click('Word Queue');
    expect(container.textContent).not.toContain('secretanswer');
    await click('Overview');
    expect(container.textContent).not.toContain('secretanswer');
  });

  it('does not reveal a late response after the moderator cancels or switches tabs', async () => {
    let resolveAnswer!: (result: unknown) => void;
    revealAnswer.mockReturnValue(new Promise((resolve) => (resolveAnswer = resolve)));
    await loadConsole();
    await click('Request Answer Reveal');
    const form = await fillRevealForm();
    await form.typeConfirmation();
    await click('Confirm and Reveal Answer');
    expect(revealAnswer).toHaveBeenCalledTimes(1);
    await click('Redis');
    await act(() =>
      resolveAnswer({
        challengeNumber: 1,
        word: 'secretanswer',
        expiresAtMs: Date.now() + 60_000,
      })
    );
    await click('Overview');
    expect(container.textContent).not.toContain('secretanswer');
  });

  it('offers test-post creation only when the server identifies a playtest build', async () => {
    await loadConsole();
    await click('Publishing');
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
});
