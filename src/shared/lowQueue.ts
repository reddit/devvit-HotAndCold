export const LOW_QUEUE_THRESHOLD = 7;

export function queueHealth(size?: number | null): 'empty' | 'low' | null {
  if (size == null || !Number.isSafeInteger(size) || size < 0) return null;
  if (size === 0) return 'empty';
  return size <= LOW_QUEUE_THRESHOLD ? 'low' : null;
}
