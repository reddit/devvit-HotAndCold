export function getPrettyDuration(start: Date, end: Date): string {
  // Calculate the difference in milliseconds
  const diffMs = end.getTime() - start.getTime();

  // Convert to seconds
  let seconds = Math.floor(diffMs / 1000);

  // Calculate hours, minutes, and remaining seconds
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  // Build the duration string
  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 || (hours === 0 && minutes === 0)) {
    parts.push(`${seconds}s`);
  }

  return parts.join(" ");
}
