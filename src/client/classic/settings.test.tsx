import { render } from 'preact';
import { act } from 'preact/test-utils';
import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../index.css';
import { PlayerSettings, settingsOpen } from './settings';
import { HowToPlayModal } from './howToPlayModal';
import { howToPlayOpen } from './state/howToPlay';
import { userSettings } from './state/userSettings';
import { HelpMenu } from '../shared/helpMenu';

vi.mock('@devvit/web/client', () => ({
  context: { userId: 't2_player', postData: { challengeNumber: 1 } },
  showToast: () => {},
  requestExpandedMode: (...args: unknown[]) => (globalThis as any).__settingsExpand(...args),
}));
vi.mock('../core/guess', () => ({
  resetGuessCache: () => (globalThis as any).__settingsCacheReset(),
}));
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  settingsOpen.value = true;
  (globalThis as any).__settingsCacheReset = vi.fn().mockResolvedValue(undefined);
  (globalThis as any).__settingsExpand = vi.fn();
});
afterEach(async () => {
  await act(() => render(null, container));
  settingsOpen.value = false;
  howToPlayOpen.value = false;
  container.remove();
  delete (globalThis as any).__settingsExpand;
  delete (globalThis as any).__settingsCacheReset;
  await page.viewport(1280, 720);
});
const mount = async () => {
  await act(() => render(<PlayerSettings />, container));
};
const tab = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (button) => button.textContent === name
  )!;

it('keeps player settings focused on sound and gameplay without reminder or moderator steps', async () => {
  await mount();
  expect(tab('Moderation')).toBeUndefined();
  expect(container.textContent).not.toContain('Daily Reminders');
  expect(container.textContent).not.toContain('Open Moderator Settings');
});

it('supports keyboard tabs and applies the explicit guess order and spacing', async () => {
  await mount();
  await act(() => {
    tab('Sound & Effects').focus();
    tab('Sound & Effects').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
  });
  expect(document.activeElement).toBe(tab('Gameplay'));
  expect(tab('Gameplay').getAttribute('aria-selected')).toBe('true');
  const choice = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === label
    )!;
  await act(() => {
    choice('Roomy').click();
    choice('Newest First').click();
  });
  expect(choice('Roomy').getAttribute('aria-pressed')).toBe('true');
  expect(choice('Compact').getAttribute('aria-pressed')).toBe('false');
  expect(choice('Newest First').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('select')).toBeNull();
  expect(userSettings.value.layout).toBe('EXPANDED');
  expect(userSettings.value.sortType).toBe('TIMESTAMP');
  expect(container.textContent).toContain('Your newest guess stays pinned');
});

it.each([
  [320, 440],
  [390, 520],
  [768, 600],
])('fits the gameplay choices and previews without scrolling at %s × %s', async (width, height) => {
  await page.viewport(width!, height!);
  await mount();
  await act(() => {
    tab('Gameplay').click();
  });
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  const scroll = dialog.firstElementChild as HTMLElement;
  const previews = Array.from(container.querySelectorAll<HTMLElement>('[data-setting-preview]'));
  expect(previews).toHaveLength(4);
  expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight + 2);
  expect(scroll.scrollWidth).toBe(scroll.clientWidth);
  for (const preview of previews) {
    const frame = preview.getBoundingClientRect();
    const rows = preview.firstElementChild!.getBoundingClientRect();
    expect(rows.top).toBeGreaterThanOrEqual(frame.top);
    expect(rows.bottom).toBeLessThanOrEqual(frame.bottom);
    expect(rows.right).toBeLessThanOrEqual(scroll.getBoundingClientRect().right);
  }
  const before = scroll.getBoundingClientRect().height;
  await act(() => {
    container.querySelector<HTMLButtonElement>('[aria-label="Roomy"]')!.click();
    container.querySelector<HTMLButtonElement>('[aria-label="Newest First"]')!.click();
  });
  expect(scroll.getBoundingClientRect().height).toBe(before);
  expect(scroll.scrollTop).toBe(0);
  expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight + 2);
});

it('keeps long settings reachable in one bounded scrolling surface', async () => {
  await page.viewport(320, 440);
  await mount();
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  const scroll = dialog.firstElementChild as HTMLElement;
  expect(scroll.getBoundingClientRect().top).toBeGreaterThan(20);
  expect(scroll.getBoundingClientRect().bottom).toBeLessThan(window.innerHeight - 20);
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
  scroll.scrollTop = scroll.scrollHeight;
  expect(scroll.scrollTop).toBeGreaterThan(0);
  const close = container.querySelector<HTMLButtonElement>('[aria-label="Close modal"]')!;
  expect(close.getBoundingClientRect().bottom).toBeLessThan(window.innerHeight);
  await act(() => {
    dialog.click();
  });
  expect(settingsOpen.value).toBe(false);
});

it('leaves clickable space around How to Play and supports closing with Escape', async () => {
  await page.viewport(320, 440);
  howToPlayOpen.value = true;
  await act(() => render(<HowToPlayModal />, container));
  const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
  const card = dialog.firstElementChild!.getBoundingClientRect();
  expect(card.left).toBeGreaterThanOrEqual(24);
  expect(card.top).toBeGreaterThan(20);
  expect(card.bottom).toBeLessThan(window.innerHeight - 20);
  expect(container.textContent).toContain('Warmer');
  expect(container.textContent).toContain('Colder');
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(howToPlayOpen.value).toBe(false);
});

it.each(['Tab', 'Escape'])(
  'lets %s dismiss the actions menu even when every action is disabled',
  async (key) => {
    await act(() =>
      render(<HelpMenu items={[{ name: 'Hint', disabled: true, action: () => {} }]} />, container)
    );
    const trigger = container.querySelector<HTMLButtonElement>('button')!;
    await act(() => {
      trigger.focus();
      trigger.click();
    });
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(() => {
      trigger.dispatchEvent(event);
    });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    if (key === 'Tab') expect(event.defaultPrevented).toBe(false);
    else expect(document.activeElement).toBe(trigger);
  }
);

it('confirms cache clearing and preserves browser history, results, and preferences', async () => {
  await mount();
  const savedHistory = JSON.stringify([{ word: 'local-unsynced', rank: 42 }]);
  window.localStorage.setItem('guess-history:cache-check', savedHistory);
  window.sessionStorage.setItem('guess-solvedAt:cache-check', '123');
  const preferences = JSON.stringify(userSettings.value);
  const button = (text: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === text
    )!;
  await act(() => {
    tab('Gameplay').click();
  });
  await act(() => {
    container.querySelector('summary')!.click();
    button('Clear Word Cache').click();
  });
  expect(container.textContent).toContain('Clear Downloaded Word Data?');
  expect((globalThis as any).__settingsCacheReset).not.toHaveBeenCalled();
  await act(() => {
    button('Cancel').click();
  });
  expect(container.querySelector('[aria-label="Confirm Word Cache Reset"]')).toBeNull();
  await act(() => {
    button('Clear Word Cache').click();
  });
  await act(async () => {
    button('Confirm Clear Word Data').click();
  });
  expect((globalThis as any).__settingsCacheReset).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem('guess-history:cache-check')).toBe(savedHistory);
  expect(window.sessionStorage.getItem('guess-solvedAt:cache-check')).toBe('123');
  expect(JSON.stringify(userSettings.value)).toBe(preferences);
  await expect
    .poll(() => container.querySelector('[role="status"]')?.textContent ?? '')
    .toContain('history and settings were kept');
  window.localStorage.removeItem('guess-history:cache-check');
  window.sessionStorage.removeItem('guess-solvedAt:cache-check');
});
