import { render } from 'preact';
import '../../index.css';
import { ModeratorEntry } from './settings';
import { ErrorBoundary } from '../../shared/error';

render(
  <ErrorBoundary>
    <ModeratorEntry launcher />
  </ErrorBoundary>,
  document.getElementById('root')!
);
