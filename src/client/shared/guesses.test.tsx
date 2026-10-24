import { signal, type Signal } from '@preact/signals';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Guesses, type GuessItem } from './guesses';
import { userSettings } from '../classic/state/userSettings';

vi.mock('./useDimensions', () => ({
  useDimensions: () => [undefined, { width: 240, height: 32 }, () => {}],
}));

const guesses: GuessItem[] = [
  { word: 'store', similarity: 0.1, rank: 34889, timestamp: 1 },
  { word: 'pizza', similarity: 0.2, rank: 31761, timestamp: 2 },
  { word: 'box', similarity: 0.3, rank: 10928, timestamp: 3 },
];

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('Guesses', () => {
  let container: HTMLDivElement;
  const originalSettings = userSettings.value;

  beforeEach(() => {
    userSettings.value = {
      ...originalSettings,
      sortType: 'SIMILARITY',
      sortDirection: 'DESC',
      layout: 'CONDENSED',
    };
    container = document.createElement('div');
    container.style.lineHeight = '16px';
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => {
      await nextFrame();
      render(null, container);
    });
    container.remove();
    userSettings.value = originalSettings;
  });

  const mount = async (items: GuessItem[] | Signal<GuessItem[]>, latest?: GuessItem) => {
    await act(async () => {
      render(<Guesses items={items} {...(latest ? { latest } : {})} />, container);
    });
    await act(async () => {
      await nextFrame();
      await nextFrame();
    });
  };

  const visibleWords = () =>
    Array.from(container.querySelectorAll('span'))
      .filter((span) => getComputedStyle(span).visibility !== 'hidden')
      .map((span) => span.textContent?.trim())
      .filter((text) => text && !text.startsWith('#'));

  const previousWords = () =>
    Array.from(container.querySelectorAll('[role="listitem"]')).map((row) =>
      row.firstElementChild?.textContent?.trim()
    );

  it('renders each guess once when the latest guess is also the closest', async () => {
    await mount(guesses, guesses[2]);

    expect(visibleWords().filter((word) => word === 'box')).toHaveLength(1);
    expect(visibleWords()).toEqual(['box', 'pizza', 'store']);
    expect(container.querySelector('[aria-label="Latest guess"]')?.textContent).toContain(
      'Latest guess'
    );
    expect(previousWords()).toEqual(['pizza', 'store']);
    expect(guesses).toHaveLength(3);
  });

  it('moves the previous latest guess back into the sorted history after a new guess', async () => {
    const items = signal([...guesses]);
    await mount(items);

    await act(async () => {
      items.value = [
        ...items.value,
        { word: 'train', similarity: 0.05, rank: 40000, timestamp: 4 },
      ];
    });
    await act(nextFrame);

    expect(visibleWords().filter((word) => word === 'train')).toHaveLength(1);
    expect(visibleWords().filter((word) => word === 'box')).toHaveLength(1);
    expect(previousWords()).toEqual(['box', 'pizza']);
    expect(items.value).toHaveLength(4);
  });

  it('paginates only previous guesses and keeps the latest visible on every page', async () => {
    await mount([
      ...guesses.slice(0, 2),
      { word: 'train', similarity: 0.05, rank: 40000, timestamp: 3 },
      { word: 'apple', similarity: 0.01, rank: 50000, timestamp: 4 },
      { ...guesses[2]!, timestamp: 5 },
    ]);

    expect(previousWords()).toEqual(['pizza', 'store']);
    expect(container.textContent).toContain('1 / 2');
    await act(() => {
      container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click();
    });
    expect(previousWords()).toEqual(['train', 'apple']);
    expect(visibleWords().filter((word) => word === 'box')).toHaveLength(1);
    expect(container.textContent).toContain('2 / 2');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Next page"]')?.disabled).toBe(
      true
    );
  });

  it('shows a single guess without a duplicate history row or pagination', async () => {
    await mount([guesses[2]!]);

    expect(visibleWords()).toEqual(['box']);
    expect(previousWords()).toEqual([]);
    expect(container.querySelector('[aria-label="Next page"]')).toBeNull();
  });
});
