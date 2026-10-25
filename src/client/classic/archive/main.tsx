import { render } from 'preact';
import '../../index.css';
import { ArchiveModal } from '../archiveModal';
import { archiveOpen } from '../state/archive';
import { ErrorBoundary } from '../../shared/error';
import { configurePosthog } from '../../posthog';

configurePosthog({ mode: 'classic' });
archiveOpen.value = true;
render(
  <ErrorBoundary>
    <ArchiveModal />
  </ErrorBoundary>,
  document.getElementById('root')!
);
