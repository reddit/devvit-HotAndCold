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
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  settingsOpen.value = true;
  (globalThis as any).__settingsExpand = vi.fn();
});
afterEach(async () => {
  await act(() => render(null, container));
  settingsOpen.value = false;
  howToPlayOpen.value = false;
  container.remove();
  delete (globalThis as any).__settingsExpand;
  await page.viewport(1280, 720);
});
const mount = async (isModerator = false) => {
  await act(() =>
    render(
      <PlayerSettings isModerator={isModerator} onToggleReminder={async () => {}} />,
      container
    )
  );
};
const tab = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (button) => button.textContent === name
  )!;

it('shows moderation only to moderators and launches the separate expanded console', async () => {
  await mount();
  expect(tab('Moderation')).toBeUndefined();
  await mount(true);
  await act(() => {
    tab('Moderation').click();
  });
  const launch = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Open Moderator Settings')
  )!;
  await act(() => {
    launch.click();
  });
  expect((globalThis as any).__settingsExpand).toHaveBeenCalledWith(
    expect.any(MouseEvent),
    'moderator-console',
    { title: 'Moderator Settings (Experimental)' }
  );
  expect(settingsOpen.value).toBe(false);
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
  const [spacing, order] = Array.from(container.querySelectorAll('select'));
  await act(() => {
    spacing!.value = 'EXPANDED';
    spacing!.dispatchEvent(new Event('change', { bubbles: true }));
    order!.value = 'TIMESTAMP';
    order!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(userSettings.value.layout).toBe('EXPANDED');
  expect(userSettings.value.sortType).toBe('TIMESTAMP');
  expect(container.textContent).toContain('Your newest guess stays pinned');
});

it('keeps long settings reachable in one bounded scrolling surface', async () => {
  await page.viewport(320, 440);
  await mount(true);
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
