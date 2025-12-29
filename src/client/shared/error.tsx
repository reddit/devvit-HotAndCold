import { Component } from 'preact';
import { GradientBorder } from './gradientBorder';
import { posthog } from '../posthog';
import { Logo } from './logo';

const isIOS = (ua: string): boolean => /iPhone|iPad|iPod/i.test(ua || '');

export class ErrorBoundary extends Component {
  override state: { error: string | null } = { error: null };

  static override getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  override componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught error', error);
    this.setState({ error: error.message });
    try {
      posthog.captureException(error, {
        source: 'errorBoundary',
        $exception_fingerprint: error.message.slice(0, 250),
      });
    } catch {
      // ignore
    }
  }

  render() {
    // console.log('ErrorBoundary render', this.state.error);
    if (this.state.error) {
      const onIOS = typeof navigator !== 'undefined' ? isIOS(navigator.userAgent) : false;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-8">
          <div className="h-10 sm:h-14">
            <Logo />
          </div>
          <h1 className="text-center text-2xl font-bold text-gray-900 dark:text-white">
            Sorry, we hit a snag
          </h1>
          <p className="max-w-xl text-center text-sm text-gray-600 dark:text-gray-300">
            {onIOS
              ? 'If you’re using the Reddit app on iOS, updating to the latest version may help.'
              : 'A quick refresh usually fixes this. Thanks for your patience!'}
          </p>
          <button
            type="button"
            onClick={() => {
              posthog.capture('ErrorBoundary CTA Clicked', {
                cta: 'try_again',
                platform: onIOS ? 'iOS' : 'Web',
                source: 'errorBoundary',
              });

              window.location.reload();
            }}
            className="cursor-pointer rounded-full bg-zinc-100 text-black focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 dark:bg-zinc-800 dark:text-white"
          >
            <GradientBorder>
              <span className="inline-block px-5 py-2.5">Try again</span>
            </GradientBorder>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
