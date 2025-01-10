import { WebviewToBlocksMessage } from '@hotandcold/classic-shared';

export function sendMessageToDevvit(event: WebviewToBlocksMessage) {
  window.parent?.postMessage(event, '*');
}
