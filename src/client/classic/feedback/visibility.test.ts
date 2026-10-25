import { expect, it, vi } from 'vitest';
import { watchGameVisibility } from './visibility';

it('requires both on-screen intersection and document visibility, even after a focus event', () => {
  let report: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        report = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    }
  );
  let visibility: DocumentVisibilityState = 'visible';
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const changes = vi.fn();
  const stop = watchGameVisibility(changes);
  const intersect = (value: boolean) =>
    report(
      [
        {
          target: document.documentElement,
          isIntersecting: value,
          intersectionRatio: value ? 1 : 0,
        } as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver
    );
  try {
    expect(changes).toHaveBeenLastCalledWith(false);
    intersect(true);
    expect(changes).toHaveBeenLastCalledWith(true);
    intersect(false);
    window.dispatchEvent(new Event('focus'));
    expect(changes).toHaveBeenLastCalledWith(false);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    intersect(true);
    expect(changes).toHaveBeenLastCalledWith(false);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(changes).toHaveBeenLastCalledWith(true);
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(changes).toHaveBeenLastCalledWith(false);
    window.dispatchEvent(new Event('focus'));
    expect(changes).toHaveBeenLastCalledWith(true);
  } finally {
    stop();
    visible.mockRestore();
    vi.unstubAllGlobals();
  }
  expect(disconnect).toHaveBeenCalled();
  changes.mockClear();
  window.dispatchEvent(new Event('focus'));
  expect(changes).not.toHaveBeenCalled();
});

it('detects scrolling past a cross-origin iframe with the real browser observer', async () => {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;top:0;left:0;width:300px;height:200px;overflow:auto;';
  const frame = document.createElement('iframe');
  frame.style.cssText = 'display:block;width:280px;height:180px;border:0;';
  frame.sandbox.add('allow-scripts');
  let visible: boolean | undefined;
  const receive = (event: MessageEvent) => {
    if (event.source === frame.contentWindow && event.data?.type === 'audio-visibility')
      visible = event.data.visible;
  };
  window.addEventListener('message', receive);
  frame.srcdoc = `<html style="height:100%"><body style="margin:0"><script>
    (${watchGameVisibility.toString()})((visible) => parent.postMessage({type:'audio-visibility', visible}, '*'));
  </script></body></html>`;
  const spacer = document.createElement('div');
  spacer.style.height = '400px';
  holder.append(frame, spacer);
  document.body.append(holder);
  try {
    await expect.poll(() => visible).toBe(true);
    holder.scrollTop = 220;
    await expect.poll(() => visible).toBe(false);
    holder.scrollTop = 0;
    await expect.poll(() => visible).toBe(true);
  } finally {
    holder.remove();
    window.removeEventListener('message', receive);
  }
});
