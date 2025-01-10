import { WebviewToBlocksMessage } from '@hotandcold/raid-shared';

export function sendMessageToDevvit(event: WebviewToBlocksMessage) {
  window.parent?.postMessage(event, '*');
}
