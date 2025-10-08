const T2_USER_ID_REGEX = /\bt2_[a-z0-9]+\b/g;

export function maskUserIds(text: string): string {
  return text.replace(T2_USER_ID_REGEX, "t2_xxx");
}

export function sanitizeUrlLikeString(input: string): string {
  try {
    const url = new URL(input);

    if (url.search.includes("context")) {
      url.searchParams.set("context", "xxx");
    }

    if (url.search.includes("webbit_token")) {
      url.searchParams.delete("webbit_token");
    }

    if (url.hash) {
      url.hash = "";
    }

    return url.toString();
  } catch {
    return input;
  }
}

// For general string values in events: try URL sanitize, then always mask IDs
export function sanitizeValueForEvent(value: unknown): unknown {
  if (typeof value === "string") {
    const normalized = sanitizeUrlLikeString(value);
    return maskUserIds(normalized);
  }

  return value;
}

// For object keys: only modify if key is URL-like; then optionally mask IDs
export function sanitizeKeyForEvent(key: string): string {
  const normalized = sanitizeUrlLikeString(key);
  if (normalized === key) return key;
  return maskUserIds(normalized);
}
