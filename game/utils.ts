import { WebviewToBlocksMessage } from "./shared";
import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function sendMessageToDevvit(event: WebviewToBlocksMessage) {
  window.parent?.postMessage(event, "*");
}
