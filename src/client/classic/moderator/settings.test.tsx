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
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    access = vi.fn().mockResolvedValue({ isModerator: true });
    overview = vi.fn().mockResolvedValue({
      challenge: null,
      queueSize: 0,
      notifications: { total: 0, next: [] },
      job: null,
      nextPostAtMs: Date.now(),
    });
    (globalThis as any).__moderationClientMock = {
      access: { query: access },
      overview: { query: overview },
      queue: { query: vi.fn().mockResolvedValue([]) },
    };
  });
  afterEach(async () => {
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

  it('keeps the inline launcher compact and does not fetch private dashboard data', async () => {
    await mount(true);
    expect(container.textContent).toContain('Open moderator settings');
    expect(container.querySelector('nav')).toBeNull();
    expect(overview).not.toHaveBeenCalled();
  });

  it('renders the separate expanded entry directly as the console', async () => {
    await mount(false);
    await expect
      .poll(() => container.querySelector('nav')?.textContent ?? '')
      .toContain('Word queue');
    expect(container.querySelector('nav')?.textContent).toContain('Redis');
    expect(container.textContent).not.toContain('Open moderator settings');
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('does not load the console or private data for non-moderators', async () => {
    access.mockResolvedValue({ isModerator: false });
    await mount(false);
    expect(container.textContent).toContain('available to this community’s moderators');
    expect(container.querySelector('nav')).toBeNull();
    expect(overview).not.toHaveBeenCalled();
  });
});
