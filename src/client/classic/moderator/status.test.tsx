import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queueStatusKey, useModeratorStatus } from './status';
import { queueHealth } from '../../../shared/lowQueue';

const mock = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_mod', subredditId: 't5_test' },
}));
vi.mock('../../trpc', () => ({
  trpc: { moderation: { access: { query: mock.access } } },
}));

let container: HTMLDivElement;
function Status() {
  const status = useModeratorStatus();
  return (
    <div data-moderator={status.isModerator} data-queue-size={status.queueSize ?? 'unknown'} />
  );
}
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  mock.access.mockReset().mockResolvedValue({ isModerator: true, queueSize: 0 });
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
});
const size = () => container.firstElementChild?.getAttribute('data-queue-size');
const changed = async (value: string, key = queueStatusKey) => {
  await act(() => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key,
        newValue: value,
        storageArea: localStorage,
      })
    );
  });
};

it('updates an open game immediately after queue changes in another view, without polling', async () => {
  await act(() => render(<Status />, container));
  await expect.poll(size).toBe('0');
  await changed('20');
  expect(size()).toBe('20');
  expect(mock.access).toHaveBeenCalledTimes(1);
  await changed('0', 'another-community-or-account');
  await changed('-1');
  await changed('invalid');
  expect(size()).toBe('20');
});

it('refreshes on focus, clears badges when the queue refills, and drops counts after access is revoked', async () => {
  await act(() => render(<Status />, container));
  await expect.poll(size).toBe('0');
  mock.access.mockResolvedValueOnce({ isModerator: true, queueSize: 40 });
  await act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await expect.poll(size).toBe('40');
  mock.access.mockResolvedValueOnce({ isModerator: false });
  await act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await expect
    .poll(() => container.firstElementChild?.getAttribute('data-moderator'))
    .toBe('false');
  expect(size()).toBe('unknown');
  await changed('0');
  expect(size()).toBe('unknown');
});

it('does not restore a stale browser count when the server count is unavailable', async () => {
  localStorage.setItem(queueStatusKey, '0');
  mock.access.mockResolvedValue({ isModerator: true, queueSize: null });
  await act(() => render(<Status />, container));
  await expect.poll(() => container.firstElementChild?.getAttribute('data-moderator')).toBe('true');
  expect(size()).toBe('unknown');
});

it('does not let a slow focus response overwrite a refill from another view', async () => {
  await act(() => render(<Status />, container));
  await expect.poll(size).toBe('0');
  let finish: (status: { isModerator: boolean; queueSize: number }) => void = () => {};
  mock.access.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  await act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await changed('20');
  await act(async () => {
    finish({ isModerator: true, queueSize: 0 });
  });
  expect(size()).toBe('20');
});

it.each([
  [0, 'empty'],
  [1, 'low'],
  [7, 'low'],
  [8, null],
  [null, null],
  [undefined, null],
  [-1, null],
  [NaN, null],
] as const)(
  'reports queue health for %s words without treating unknown values as empty',
  (count, health) => {
    expect(queueHealth(count)).toBe(health);
  }
);
