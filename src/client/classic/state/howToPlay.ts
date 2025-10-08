import { signal } from '@preact/signals';

export const howToPlayOpen = signal<boolean>(false);

export function openHowToPlay(): void {
  howToPlayOpen.value = true;
}

export function closeHowToPlay(): void {
  howToPlayOpen.value = false;
}
