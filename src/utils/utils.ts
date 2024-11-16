import { Devvit } from "@devvit/public-api";
import { BlocksToWebviewMessage } from "../../game/shared.js";

export const sendMessageToWebview = (
  context: Devvit.Context,
  message: BlocksToWebviewMessage,
) => {
  context.ui.webView.postMessage("webview", message);
};

export const stringifyValues = <T extends Record<string, any>>(
  obj: T,
): Record<keyof T, string> => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, String(value)]),
  ) as Record<keyof T, string>;
};

export const coerceValues = <T extends Record<string, any>>(obj: T) => {
  // Common boolean string values
  const TRUE_VALUES = new Set([
    "true",
    "yes",
    "y",
    "on",
    "1",
    "enabled",
    "enable",
    "t",
  ]);
  const FALSE_VALUES = new Set([
    "false",
    "no",
    "n",
    "off",
    "0",
    "disabled",
    "disable",
    "f",
  ]);

  return Object.entries(obj).reduce((acc, [key, value]) => {
    // Skip if value is not a string
    if (typeof value !== "string") {
      return { ...acc, [key]: value };
    }

    // Attempt to coerce the string value
    const coercedValue = (() => {
      const normalizedValue = value.trim().toLowerCase();

      // Enhanced boolean checking
      if (TRUE_VALUES.has(normalizedValue)) return true;
      if (FALSE_VALUES.has(normalizedValue)) return false;

      // Handle null/undefined
      if (normalizedValue === "null") return null;
      if (normalizedValue === "undefined") return undefined;

      // Handle numbers
      if (/^-?\d+$/.test(value)) return parseInt(value, 10);
      if (/^-?\d*\.\d+$/.test(value)) return parseFloat(value);

      // Try parsing JSON for objects/arrays
      try {
        if (
          (value.startsWith("{") && value.endsWith("}")) ||
          (value.startsWith("[") && value.endsWith("]"))
        ) {
          return JSON.parse(value);
        }
      } catch {
        // If JSON parsing fails, return original string
      }

      // Return original string if no coercion applies
      return value;
    })();

    return { ...acc, [key]: coercedValue };
  }, {} as Record<string, any>);
};

export const isEmptyObject = <T extends object>(obj: T): boolean => {
  return Object.keys(obj).length === 0;
};
