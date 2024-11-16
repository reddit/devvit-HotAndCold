import { WebviewToBlockMessage } from "./shared";
import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sendMessageToDevvit(event: WebviewToBlockMessage) {
  window.parent?.postMessage(event, "*");
}
