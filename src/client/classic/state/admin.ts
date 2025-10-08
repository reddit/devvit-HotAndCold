import { signal } from '@preact/signals';

export const isAdmin = signal<boolean | null>(null);

export function setIsAdmin(next: boolean): void {
  isAdmin.value = next;
}
