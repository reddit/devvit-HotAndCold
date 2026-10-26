import { context } from '@devvit/web/client';
import { render } from 'preact';
import '../../index.css';
import { ExpandedPage } from '../../shared/expandedPage';
import { ErrorBoundary } from '../../shared/error';
import { popupTitles, type PopupEntry } from './launch';
import { trpc } from '../../trpc';
import { setActiveTestRun } from '../../playtest/run';
import { ResultsIcon } from '../icons';

async function start() {
  const entry = window.location.pathname
    .split('/')
    .pop()
    ?.replace(/\.html$/, '') as PopupEntry;
  if (!Object.hasOwn(popupTitles, entry)) throw new Error('Unknown expanded view');
  try {
    // Resolve disposable run IDs before importing navigation or challenge-specific panels.
    if (context.postData?.kind === 'playtest-game') {
      setActiveTestRun(await trpc.moderation.testRun.query());
    }
    const content =
      entry === 'player-settings'
        ? (await import('../playerSettings')).PlayerSettings
        : entry === 'results'
          ? (await import('./results')).ExpandedResults
          : entry === 'playtest-controls'
            ? (await import('../../playtest/controls')).TestRunPanel
            : (await import('./panels'))[
                entry === 'give-up'
                  ? 'GiveUpPanel'
                  : entry === 'score-breakdown'
                    ? 'ScorePanel'
                    : 'CommentPanel'
              ];
    const Content = content;
    render(
      <ErrorBoundary>
        <ExpandedPage
          title={popupTitles[entry]}
          icon={entry === 'results' ? <ResultsIcon /> : undefined}
        >
          <Content />
        </ExpandedPage>
      </ErrorBoundary>,
      document.getElementById('root')!
    );
  } catch {
    render(
      <ExpandedPage title={popupTitles[entry]}>
        <p role="alert">Could not load this view. Close it and try again.</p>
      </ExpandedPage>,
      document.getElementById('root')!
    );
  }
}

void start();
