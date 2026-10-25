import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RedisSamplePanel } from './redisSample';

const sample = {
  dictionaryBytes: 2048,
  nextEnd: 9,
  rows: [
    {
      challengeNumber: 11,
      cacheBytes: 2048,
      compactCacheBytes: 300,
      players: 1,
      progressPlayers: 5,
      sampledPlayers: 6,
      sampledGuessBytes: 2048,
    },
    {
      challengeNumber: 12,
      cacheBytes: 10240,
      compactCacheBytes: 100,
      players: 4,
      progressPlayers: 6,
      sampledPlayers: 7,
      sampledGuessBytes: 8192,
    },
    {
      challengeNumber: 13,
      cacheBytes: 0,
      compactCacheBytes: 900,
      players: 3,
      progressPlayers: 10,
      sampledPlayers: 9,
      sampledGuessBytes: 1024,
    },
    {
      challengeNumber: 14,
      cacheBytes: 1024,
      compactCacheBytes: 500,
      players: 2,
      progressPlayers: 1,
      sampledPlayers: 3,
      sampledGuessBytes: 4096,
    },
  ],
};
let container: HTMLDivElement;
let clear: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  clear = vi.fn().mockResolvedValue(undefined);
  await act(() =>
    render(<RedisSamplePanel sample={sample} busy={false} onClear={clear} />, container)
  );
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
});
const check = (label: string) =>
  container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const all = () => check('Select All Clearable Puzzles in This Sample');
const puzzle = (number: number) => check(`Select Puzzle #${number}`);
const acknowledgement = () => container.querySelector<HTMLInputElement>('label input')!;
const clearButton = () =>
  Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Clear Selected Caches'
  )!;
const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
  });
};
const order = () =>
  Array.from(container.querySelectorAll('tbody th')).map((cell) =>
    Number(cell.textContent!.replace('#', ''))
  );
const sort = (label: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="Sort by ${label}"]`)!;

it('starts with the largest full JSON caches first and sorts every numeric column in both directions', async () => {
  expect(order()).toEqual([12, 11, 14, 13]);
  const orders: [string, number[]][] = [
    ['Puzzle', [14, 13, 12, 11]],
    ['Full JSON Cache', [12, 11, 14, 13]],
    ['Compact Cache', [13, 14, 11, 12]],
    ['Solvers Indexed', [12, 13, 14, 11]],
    ['Progress Indexed', [13, 12, 11, 14]],
    ['Players Sampled', [13, 12, 11, 14]],
    ['Guess Payloads', [12, 14, 11, 13]],
  ];
  for (const [label, descending] of orders) {
    await click(sort(label));
    expect(order()).toEqual(descending);
    expect(sort(label).closest('th')?.getAttribute('aria-sort')).toBe('descending');
    await click(sort(label));
    expect(order()).toEqual([...descending].reverse());
    expect(sort(label).closest('th')?.getAttribute('aria-sort')).toBe('ascending');
  }
});

it('selects only eligible puzzles and exposes partial, all, and empty selection', async () => {
  expect(clearButton().disabled).toBe(true);
  expect(puzzle(13).disabled).toBe(true);
  await click(puzzle(11));
  expect(all().indeterminate).toBe(true);
  expect(all().checked).toBe(false);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('1 of 3');
  await click(all());
  expect(all().checked).toBe(true);
  expect(all().indeterminate).toBe(false);
  expect([11, 12, 14].every((number) => puzzle(number).checked)).toBe(true);
  expect(puzzle(13).checked).toBe(false);
  await click(all());
  expect([11, 12, 14].every((number) => !puzzle(number).checked)).toBe(true);
  expect(acknowledgement().disabled).toBe(true);
});

it('keeps selection attached to puzzle IDs when sorting and sends only the chosen IDs', async () => {
  await click(puzzle(11));
  await click(puzzle(14));
  await click(sort('Compact Cache'));
  expect(puzzle(11).checked).toBe(true);
  expect(puzzle(14).checked).toBe(true);
  expect(clearButton().disabled).toBe(true);
  await click(acknowledgement());
  await click(clearButton());
  expect(clear).toHaveBeenCalledExactlyOnceWith([11, 14]);
  expect(acknowledgement().checked).toBe(false);
  expect(clearButton().disabled).toBe(true);
});

it('requires a fresh acknowledgement after the selection changes, but not after sorting', async () => {
  await click(puzzle(11));
  await click(acknowledgement());
  await click(sort('Puzzle'));
  expect(acknowledgement().checked).toBe(true);
  await click(puzzle(12));
  expect(acknowledgement().checked).toBe(false);
  expect(clearButton().disabled).toBe(true);
});

it('disables changes while busy and disables cleanup when the sample has no legacy caches', async () => {
  await click(puzzle(11));
  await click(acknowledgement());
  await act(() => render(<RedisSamplePanel sample={sample} busy onClear={clear} />, container));
  expect(
    Array.from(container.querySelectorAll('input, button')).every(
      (element) => (element as HTMLInputElement).disabled
    )
  ).toBe(true);
  await click(clearButton());
  expect(clear).not.toHaveBeenCalled();
  await act(() =>
    render(
      <RedisSamplePanel
        key="empty"
        sample={{ ...sample, rows: sample.rows.map((row) => ({ ...row, cacheBytes: 0 })) }}
        busy={false}
        onClear={clear}
      />,
      container
    )
  );
  expect(all().disabled).toBe(true);
  expect(acknowledgement().disabled).toBe(true);
  expect(clearButton().disabled).toBe(true);
  expect(container.textContent).toContain('may temporarily fail');
  expect(container.textContent).toContain('does not rebuild the full JSON copies');
});
