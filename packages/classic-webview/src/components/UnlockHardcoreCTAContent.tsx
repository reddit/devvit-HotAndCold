import { PurchaseButton } from './PurchaseButton';
import { HardcoreLogo } from '@hotandcold/webview-common/components/logo';
import { sendMessageToDevvit } from '../utils';

type UnlockHardcoreCTAContentProps = {
  withLogo?: boolean;
  withLinkToTodaysPuzzle?: boolean;
};
export const UnlockHardcoreCTAContent = ({
  withLogo,
  withLinkToTodaysPuzzle,
}: UnlockHardcoreCTAContentProps) => {
  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6 sm:gap-6 sm:p-8 md:max-w-2xl md:p-10">
      {withLogo && <HardcoreLogo />}
      <p className="text-xl font-bold text-white sm:text-2xl">100 guesses. No hints. No mercy.</p>
      <p className="text-sm font-normal text-gray-300">
        Unlocking Hardcore grants access to today and all previous hardcore puzzles.
      </p>
      <hr className="h-px w-1/2 max-w-xs bg-white/20"></hr>
      <div className="flex w-full flex-col items-center gap-4 py-2 sm:w-auto sm:flex-row sm:items-start">
        <PurchaseButton price={50} style="secondary" productSku="hardcore-mode-seven-day-access">
          Unlock for 7 days
        </PurchaseButton>
        <PurchaseButton price={250} style="primary" productSku="hardcore-mode-lifetime-access">
          Unlock FOREVER
        </PurchaseButton>
      </div>
      {withLinkToTodaysPuzzle && (
        <p className="text-center text-xs font-normal text-slate-400">
          Looking for today's puzzle?{' '}
          <a
            href="#"
            className="underline decoration-solid underline-offset-auto"
            onClick={(e) => {
              e.preventDefault();
              sendMessageToDevvit({ type: 'NAVIGATE_TO_DAILY_CHALLENGE' });
            }}
          >
            Click here
          </a>
        </p>
      )}
    </div>
  );
};
