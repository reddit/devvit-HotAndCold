import { PostMessageEvent } from "./shared";

export function postMessage(event: PostMessageEvent) {
  window.parent?.postMessage(event, "*");
}
