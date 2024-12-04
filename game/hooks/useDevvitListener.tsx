import { useEffect, useState } from 'react';
import { DevvitMessage, BlocksToWebviewMessage } from '../shared';
import { logger } from '../utils/logger';
import { useMocks } from './useMocks';

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
 *      logger.log(data.error, data.similarity);
 *    }
 *   }, [data]);
 *
 *   return <div>Similarity: {data?.similarity}</div>
 * }
 * ```
 */
export const useDevvitListener = <T extends BlocksToWebviewMessage['type']>(eventType: T) => {
  type Event = Extract<BlocksToWebviewMessage, { type: T }>;
  const mocks = useMocks();
  const [data, setData] = useState<Event['payload'] | undefined>(undefined);

  useEffect(() => {
    const allMocks = mocks.getMock('mocks');
    if (eventType === 'PLAYER_PROGRESS_UPDATE') {
      // @ts-expect-error
      setData({ challengeProgress: allMocks?.generateMockProgressData });
    } else if (eventType === 'CHALLENGE_LEADERBOARD_RESPONSE') {
      setData(allMocks?.challengeLeaderboardResponse);
    }
  }, [eventType, mocks]);

  useEffect(() => {
    const messageHandler = (ev: MessageEvent<DevvitMessage>) => {
      if (ev.data.type !== 'devvit-message') {
        logger.warn(`Received message with type ${ev.data.type} but expected 'devvit-message'`);
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
