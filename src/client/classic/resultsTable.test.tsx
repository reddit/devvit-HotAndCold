import { render } from 'preact';
import { act } from 'preact/test-utils';
import { page } from '@vitest/browser/context';
import { beforeEach, afterEach, expect, it } from 'vitest';
import '../index.css';
import { ResultsTable, ResultsTableRow } from './resultsTable';

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  await page.viewport(1280, 720);
});

it.each([320, 390, 768])(
  'aligns mixed ranks and percentages without overflow at %s px',
  async (width) => {
    await page.viewport(width, 600);
    container.style.width = `${Math.min(width - 40, 576)}px`;
    const rows = [
      { rank: 0, name: 'mountain', value: '100.0%' },
      { rank: 12885, name: 'doctor', value: '60.1%' },
      {
        rank: 9999999,
        name: 'pneumonoultramicroscopicsilicovolcanoconiosis',
        value: '0.0%',
        isHint: true,
      },
      { rank: null, name: 'unknown', value: '—' },
    ];
    await act(() =>
      render(
        <ResultsTable label="Your Guesses" nameHeading="Word" valueHeading="Similarity">
          {rows.map((row) => (
            <ResultsTableRow key={row.name} {...row} />
          ))}
        </ResultsTable>,
        container
      )
    );
    const table = container.querySelector('table')!;
    const cells = Array.from(table.querySelectorAll('tbody tr'), (row) =>
      Array.from(row.children, (cell) => cell.getBoundingClientRect())
    );
    expect(table.getAttribute('aria-label')).toBe('Your Guesses');
    expect(container.textContent).toContain('#9,999,999');
    expect(container.textContent).toContain('Hint');
    expect(table.getBoundingClientRect().width).toBeLessThanOrEqual(container.clientWidth);
    expect(container.scrollWidth).toBe(container.clientWidth);
    for (const row of cells) {
      expect(row[0]!.right).toBe(cells[0]![0]!.right);
      expect(row[1]!.left).toBe(cells[0]![1]!.left);
      expect(row[2]!.right).toBe(cells[0]![2]!.right);
    }
    for (const element of Array.from(table.querySelectorAll('td, th'))) {
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
    }
    if (width < 768) expect(cells[2]![1]!.height).toBeGreaterThan(cells[0]![1]!.height);
  }
);

it('preserves full scores and usernames in a narrow standings table', async () => {
  await page.viewport(320, 600);
  container.style.width = '280px';
  await act(() =>
    render(
      <ResultsTable label="Standings" nameHeading="Player" valueHeading="Score">
        <ResultsTableRow rank={1} name="short" value="9,007,199,254,740,991" isTopThree />
        <ResultsTableRow
          rank={50}
          name="a_very_long_username_to_test_wrapping"
          value="10"
          isCurrentUser
        />
      </ResultsTable>,
      container
    )
  );
  expect(container.scrollWidth).toBe(container.clientWidth);
  expect(container.querySelector('table')!.getBoundingClientRect().width).toBeLessThanOrEqual(280);
  const current = container.querySelector('[aria-current="true"]')!;
  expect(current.textContent).toContain('a_very_long_username_to_test_wrapping (You)');
  expect(container.textContent).toContain('9,007,199,254,740,991');
  expect(getComputedStyle(current.querySelector('td')!).fontVariantNumeric).toBe('tabular-nums');
});
