import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WordRevealGate } from './wordReveal';

let container: HTMLDivElement;
let confirm: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  confirm = vi.fn().mockResolvedValue(undefined);
  cancel = vi.fn();
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
});
const mount = async (target: 'answer' | 'queue' = 'answer', busy = false) => {
  await act(() =>
    render(
      <WordRevealGate target={target} busy={busy} onConfirm={confirm} onCancel={cancel} />,
      container
    )
  );
};
const fields = () => ({
  purpose: container.querySelector('select')!,
  reason: container.querySelector('textarea')!,
  pledge: container.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
  confirmation: container.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!,
  submit: container.querySelector<HTMLButtonElement>('[type="submit"]')!,
});
const choosePurpose = async (purpose = 'word_issue') => {
  await act(() => {
    const field = fields().purpose;
    field.value = purpose;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
};
const enterReason = async (reason: string) => {
  await act(() => {
    const field = fields().reason;
    field.value = reason;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const acknowledge = async () => {
  await act(() => {
    fields().pledge.click();
    const field = fields().confirmation;
    field.value = 'REVEAL';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = async () => {
  await act(() => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

it.each(['answer', 'queue'] as const)(
  'counts words and trimmed characters before unlocking the %s confirmations',
  async (target) => {
    await mount(target);
    expect(fields().pledge.disabled).toBe(true);
    expect(fields().confirmation.disabled).toBe(true);
    await choosePurpose();
    await enterReason('  Review this report!  ');
    expect(container.querySelector('#word-reveal-reason-count')?.textContent).toContain(
      '19 / 500 Characters'
    );
    expect(container.querySelector('#word-reveal-reason-count')?.textContent).toContain('3 Words');
    expect(fields().confirmation.disabled).toBe(true);
    await submit();
    expect(confirm).not.toHaveBeenCalled();
    await enterReason('  Review this report!!  ');
    expect(container.querySelector('#word-reveal-reason-count')?.textContent).toContain(
      '20 / 500 Characters'
    );
    expect(fields().pledge.disabled).toBe(false);
    expect(fields().confirmation.disabled).toBe(false);
    expect(fields().submit.disabled).toBe(true);
    await acknowledge();
    expect(fields().submit.disabled).toBe(false);
    await enterReason('Too short');
    expect(fields().pledge.disabled).toBe(true);
    expect(fields().pledge.checked).toBe(false);
    expect(fields().confirmation.value).toBe('');
    expect(fields().submit.disabled).toBe(true);
    await enterReason('  Review this report!!  ');
    expect(fields().submit.disabled).toBe(true);
    await acknowledge();
    await submit();
    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      purpose: 'word_issue',
      reason: 'Review this report!!',
      promiseNotToCheat: true,
      confirmation: 'REVEAL',
    });
  }
);

it.each([' '.repeat(25), 'x'.repeat(501)])(
  'keeps invalid reasons locked even if submitted programmatically',
  async (reason) => {
    await mount();
    await choosePurpose();
    await enterReason(reason);
    expect(fields().pledge.disabled).toBe(true);
    expect(fields().confirmation.disabled).toBe(true);
    await submit();
    expect(confirm).not.toHaveBeenCalled();
  }
);

it('also requires a purpose and resets confirmations when the purpose changes', async () => {
  await mount();
  await enterReason('Review this report!!');
  expect(fields().confirmation.disabled).toBe(true);
  await choosePurpose();
  await acknowledge();
  expect(fields().submit.disabled).toBe(false);
  await choosePurpose('queue_review');
  expect(fields().pledge.checked).toBe(false);
  expect(fields().confirmation.value).toBe('');
  expect(fields().submit.disabled).toBe(true);
});

it('blocks repeat submissions while busy and keeps cancellation available', async () => {
  await mount();
  await choosePurpose();
  await enterReason('Review this report!!');
  await acknowledge();
  await mount('answer', true);
  expect(fields().submit.disabled).toBe(true);
  expect(fields().confirmation.disabled).toBe(true);
  await submit();
  expect(confirm).not.toHaveBeenCalled();
  const cancelButton = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === 'Keep Words Hidden'
  )!;
  expect(cancelButton.disabled).toBe(false);
  await act(() => {
    cancelButton.click();
  });
  expect(cancel).toHaveBeenCalledOnce();
});
