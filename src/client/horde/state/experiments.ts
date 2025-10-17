import { signal } from '@preact/signals';

export const experimentsOpen = signal<boolean>(false);

export function openExperiments(): void {
  experimentsOpen.value = true;
}

export function closeExperiments(): void {
  experimentsOpen.value = false;
}

// Changing experiments should force a full remount of AppContent.
export const remountKey = signal<number>(0);

export function bumpRemountKey(): void {
  remountKey.value = (remountKey.value + 1) | 0;
}
