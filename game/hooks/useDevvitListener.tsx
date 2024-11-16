import { useEffect, useState } from 'react';
import { DevvitMessage, BlocksToWebviewMessage } from '../shared';

/**
 * Triggers re-renders when a message is received from the Devvit webview.
 *
 *
 * @usage
 *
 * ```ts
 * // somewhere in blocks land
 * context.ui.webView.postMessage('webview', {
 *   type: 'WORD_SUBMITTED_RESPONSE',
 *   payload: { error: 'foo', similarity: 0.5 },
 * });
 * ```
 *
 * ```tsx
 * // somewhere in React land
 * const App = () => {
 *  const [loading, setLoading] = useState(false);
 *  const data = useDevvitListener('WORD_SUBMITTED_RESPONSE');
 *
 *  useEffect(() => {
 *    if (data) {
 *      // great place to set loading to false!
 *      console.log(data.error, data.similarity);
 *    }
 *   }, [data]);
 *
 *   return <div>Similarity: {data?.similarity}</div>
 * }
 * ```
 */
export const useDevvitListener = <T extends BlocksToWebviewMessage['type']>(eventType: T) => {
  type Event = Extract<BlocksToWebviewMessage, { type: T }>;
  const [data, setData] = useState<Event['payload'] | undefined>();

  useEffect(() => {
    const messageHandler = (ev: MessageEvent<DevvitMessage>) => {
      if (ev.data.type !== 'devvit-message') {
        console.warn(`Received message with type ${ev.data.type} but expected 'devvit-message'`);
        return;
      }

      const message = ev.data.data.message;
      if (message.type === eventType) {
        setData(message.payload as any);
      }
    };

    window.addEventListener('message', messageHandler);
    return () => window.removeEventListener('message', messageHandler);
  }, [eventType]);

  return data;
};
