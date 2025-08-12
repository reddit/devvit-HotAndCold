// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createLocalStorageSignal,
  localStorageSignal,
  type Serializer,
} from './localStorageSignal';

function createMockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as Storage;
}

describe('localStorageSignal', () => {
  beforeEach(() => {
    // Reset jsdom localStorage between tests
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it('hydrates from initialValue when storage empty', () => {
    const { signal } = createLocalStorageSignal({
      key: 'k1',
      initialValue: { a: 1 },
    });
    expect(signal.value).toEqual({ a: 1 });
  });

  it('supports lazy initialValue function', () => {
    const { signal } = createLocalStorageSignal({
      key: 'k2',
      initialValue: () => 'lazy',
    });
    expect(signal.value).toBe('lazy');
  });

  it('hydrates from existing storage (JSON serializer default)', () => {
    window.localStorage.setItem('k3', JSON.stringify({ a: 2 }));
    const { signal } = createLocalStorageSignal<{ a: number }>({
      key: 'k3',
      initialValue: { a: 0 },
    });
    expect(signal.value).toEqual({ a: 2 });
  });

  it('writes to storage on change', () => {
    const { signal } = createLocalStorageSignal<string>({ key: 'k4', initialValue: 'x' });
    signal.value = 'y';
    expect(window.localStorage.getItem('k4')).toBe(JSON.stringify('y'));
  });

  it('does not rewrite identical encoded value', () => {
    const spy = vi.spyOn(window.localStorage, 'setItem');
    window.localStorage.setItem('k5', JSON.stringify('same'));
    const { signal } = createLocalStorageSignal<string>({ key: 'k5', initialValue: 'x' });
    spy.mockClear();
    signal.value = 'same';
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('supports custom serializer', () => {
    const serializer: Serializer<number> = {
      read: (raw) => Number(raw),
      write: (v) => String(v),
    };
    window.localStorage.setItem('k6', '42');
    const { signal } = createLocalStorageSignal<number>({ key: 'k6', initialValue: 0, serializer });
    expect(signal.value).toBe(42);
    signal.value = 7;
    expect(window.localStorage.getItem('k6')).toBe('7');
  });

  it('removeOnNullish removes the key when value becomes null', () => {
    const { signal } = createLocalStorageSignal<string | null>({
      key: 'k8',
      initialValue: 'a',
      removeOnNullish: true,
    });
    expect(window.localStorage.getItem('k8')).toBe(JSON.stringify('a'));
    signal.value = null;
    expect(window.localStorage.getItem('k8')).toBeNull();
  });

  it('custom storage injection is used instead of window.localStorage', () => {
    const storage = createMockStorage();
    const { signal } = createLocalStorageSignal<string>({ key: 'k9', initialValue: 'a', storage });
    signal.value = 'b';
    // Written to custom storage, not to window.localStorage
    expect(storage.getItem('k9')).toBe(JSON.stringify('b'));
    expect(window.localStorage.getItem('k9')).toBeNull();
  });

  it('syncTabs propagates changes via StorageEvent', () => {
    const { signal } = createLocalStorageSignal<string>({ key: 'k10', initialValue: 'a' });
    expect(signal.value).toBe('a');
    const ev = new StorageEvent('storage', {
      key: 'k10',
      newValue: JSON.stringify('other'),
      oldValue: JSON.stringify('a'),
      storageArea: window.localStorage,
    });
    window.dispatchEvent(ev);
    expect(signal.value).toBe('other');
  });

  it('syncTabs=false ignores StorageEvent updates', () => {
    const { signal } = createLocalStorageSignal<string>({
      key: 'k11',
      initialValue: 'a',
      syncTabs: false,
    });
    const ev = new StorageEvent('storage', {
      key: 'k11',
      newValue: JSON.stringify('other'),
      oldValue: JSON.stringify('a'),
      storageArea: window.localStorage,
    });
    window.dispatchEvent(ev);
    expect(signal.value).toBe('a');
  });

  it('storage event with null newValue resets to initial', () => {
    const { signal } = createLocalStorageSignal<string>({ key: 'k12', initialValue: 'init' });
    signal.value = 'changed';
    const ev = new StorageEvent('storage', {
      key: 'k12',
      newValue: null,
      oldValue: JSON.stringify('changed'),
      storageArea: window.localStorage,
    });
    window.dispatchEvent(ev);
    expect(signal.value).toBe('init');
  });

  it('custom equality prevents update on storage event when values are considered equal', () => {
    const { signal } = createLocalStorageSignal<string>({
      key: 'k12b',
      initialValue: 'A',
      equality: (a, b) => a.toLowerCase() === b.toLowerCase(),
    });
    const ev = new StorageEvent('storage', {
      key: 'k12b',
      newValue: JSON.stringify('a'),
      oldValue: JSON.stringify('A'),
      storageArea: window.localStorage,
    });
    window.dispatchEvent(ev);
    expect(signal.value).toBe('A');
  });

  it('dispose stops persisting and removes listener', () => {
    const { signal, dispose } = createLocalStorageSignal<string>({ key: 'k13', initialValue: 'a' });
    dispose();
    signal.value = 'b';
    // No further writes occur after dispose
    expect(window.localStorage.getItem('k13')).toBe(JSON.stringify('a'));
    // Storage events no longer affect signal
    const ev = new StorageEvent('storage', {
      key: 'k13',
      newValue: JSON.stringify('c'),
      oldValue: JSON.stringify('a'),
      storageArea: window.localStorage,
    });
    window.dispatchEvent(ev);
    expect(signal.value).toBe('b');
  });

  it('reset sets signal to initial and updates storage', () => {
    const { signal, reset } = createLocalStorageSignal<string>({
      key: 'k14',
      initialValue: 'init',
    });
    signal.value = 'changed';
    expect(window.localStorage.getItem('k14')).toBe(JSON.stringify('changed'));
    reset();
    expect(signal.value).toBe('init');
    expect(window.localStorage.getItem('k14')).toBe(JSON.stringify('init'));
  });

  it('reset removes key when removeOnNullish and initial is null', () => {
    const { signal, reset } = createLocalStorageSignal<string | null>({
      key: 'k15',
      initialValue: null,
      removeOnNullish: true,
    });
    signal.value = 'x';
    expect(window.localStorage.getItem('k15')).toBe(JSON.stringify('x'));
    reset();
    expect(window.localStorage.getItem('k15')).toBeNull();
    expect(signal.value).toBeNull();
  });

  it('removeOnNullish removes the key when value becomes undefined', () => {
    const { signal } = createLocalStorageSignal<string | undefined>({
      key: 'k15b',
      initialValue: 'a',
      removeOnNullish: true,
    });
    signal.value = undefined;
    expect(window.localStorage.getItem('k15b')).toBeNull();
  });

  it('onError is called on read errors and key is removed', () => {
    window.localStorage.setItem('k16', 'not-json');
    const onError = vi.fn();
    const { signal } = createLocalStorageSignal<{ a: number }>({
      key: 'k16',
      initialValue: { a: 0 },
      onError,
    });
    expect(onError).toHaveBeenCalledWith('read', expect.anything());
    expect(signal.value).toEqual({ a: 0 });
    expect(window.localStorage.getItem('k16')).toBeNull();
  });

  it('onError is called on write errors', () => {
    const storage = createMockStorage();
    const onError = vi.fn();
    // Make setItem throw
    const setSpy = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('boom');
    });
    const { signal } = createLocalStorageSignal<string>({
      key: 'k17',
      initialValue: 'a',
      storage,
      onError,
    });
    signal.value = 'b';
    expect(onError).toHaveBeenCalledWith('write', expect.anything());
    setSpy.mockRestore();
  });

  it('onError is called on storage event decode errors', () => {
    const onError = vi.fn();
    const { signal } = createLocalStorageSignal<string>({ key: 'k18', initialValue: 'a', onError });
    expect(signal.value).toBe('a');
    const ev = new StorageEvent('storage', {
      key: 'k18',
      newValue: 'not-json',
      storageArea: window.localStorage,
    });
    window.dispatchEvent(ev);
    expect(onError).toHaveBeenCalledWith('storage', expect.anything());
    // Value should remain unchanged
    expect(signal.value).toBe('a');
  });

  it('storage events are ignored when using custom storage injection', () => {
    const storage = createMockStorage();
    const { signal } = createLocalStorageSignal<string>({
      key: 'k18b',
      initialValue: 'a',
      storage,
    });
    const ev = new StorageEvent('storage', {
      key: 'k18b',
      newValue: JSON.stringify('other'),
      storageArea: window.localStorage,
    });
    window.dispatchEvent(ev);
    expect(signal.value).toBe('a');
  });

  it('localStorageSignal convenience returns a Signal and persists', () => {
    const sig = localStorageSignal<string>({ key: 'k19', initialValue: 'a' });
    sig.value = 'b';
    expect(window.localStorage.getItem('k19')).toBe(JSON.stringify('b'));
  });
});
