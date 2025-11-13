import { signal } from '@preact/signals';
import type { ArchiveChallengeSummary } from '../../../shared/archive';

export const archiveOpen = signal<boolean>(false);
export const archiveEntries = signal<ArchiveChallengeSummary[]>([]);
export const archiveNextCursor = signal<number | null>(null);
export const archiveInitialized = signal<boolean>(false);
export const archiveLoading = signal<boolean>(false);
export const archiveError = signal<string | null>(null);
export const archiveShowUnsolvedOnly = signal<boolean>(false);

export function openArchive(): void {
  archiveOpen.value = true;
}

export function closeArchive(): void {
  archiveOpen.value = false;
}

export function resetArchiveState(): void {
  archiveEntries.value = [];
  archiveNextCursor.value = null;
  archiveInitialized.value = false;
  archiveError.value = null;
  archiveLoading.value = false;
  archiveShowUnsolvedOnly.value = false;
}

export function toggleArchiveShowUnsolved(): void {
  archiveShowUnsolvedOnly.value = !archiveShowUnsolvedOnly.value;
}
