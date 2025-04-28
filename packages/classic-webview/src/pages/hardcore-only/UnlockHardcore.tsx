import { PageContentContainer } from '../../components/pageContentContainer';
import { PurchaseButton } from '../../components/PurchaseButton';

export const UnlockHardcorePage = () => {
  return (
    <PageContentContainer showContainer={true} className="bg-[rgba(0,0,0,0.5)]">
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6 sm:gap-6 sm:p-8 md:max-w-2xl md:p-10">
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
        <p className="text-neutral-content-gray text-center text-[12px] font-normal">
          Looking for today's puzzle?{' '}
          <span className="underline decoration-solid underline-offset-auto">Click here</span>
        </p>
      </div>
    </PageContentContainer>
  );
};
