import React from 'react';
import { HardcoreLogo } from '@hotandcold/webview-common/components/logo';
import { GoldIcon, CloseIcon } from '@hotandcold/webview-common/components/icon';
import { cn } from '@hotandcold/webview-common/utils';
import { useModal } from '../hooks/useModal';

interface PurchaseButtonProps {
  children: React.ReactNode;
  style: 'primary' | 'secondary';
  price: number;
  onClick?: () => void;
}

const PurchaseButton: React.FC<PurchaseButtonProps> = (props) => {
  const { children, price, onClick, style } = props;

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full flex-row items-center justify-between gap-4 whitespace-nowrap rounded-full border-2 border-current px-6 py-3 text-center font-sans sm:w-auto',
        style === 'primary'
          ? 'border-mustard-gold text-mustard-gold'
          : 'border-slate-gray text-slate-gray'
      )}
    >
      <span className="text-left text-base font-semibold">{children}</span>
      <span
        className={cn(
          'flex w-fit flex-row items-center gap-[6px] rounded-full px-3 py-2 text-xs font-semibold',
          style === 'primary' ? 'bg-mustard-gold text-black' : 'bg-charcoal text-white'
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <GoldIcon />
        </span>
        <span className="flex items-center">Use {price}</span>
      </span>
    </button>
  );
};

export const UnlockHardcoreModal: React.FC = () => {
  const { setModal } = useModal();

  return (
    <div className="bg-night flex min-h-screen items-center justify-center p-4 text-center font-sans">
      <button
        className="absolute right-4 top-4 text-white hover:text-gray-300"
        onClick={() => setModal(undefined)}
        aria-label="Close modal"
      >
        <CloseIcon />
      </button>
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6 sm:gap-6 sm:p-8 md:max-w-2xl md:p-10">
        <HardcoreLogo />
        <p className="text-xl font-bold text-white sm:text-2xl">100 guesses. No hints. No mercy.</p>
        <p className="text-sm font-normal text-gray-300">
          Unlocking Hardcore grants access to today and all previous hardcore puzzles.
        </p>
        <hr className="h-px w-1/2 max-w-xs bg-white/20"></hr>
        <div className="flex w-full flex-col items-center gap-4 py-2 sm:w-auto sm:flex-row sm:items-start">
          <PurchaseButton price={50} style="secondary">
            Unlock for 7 days
          </PurchaseButton>
          <PurchaseButton price={250} style="primary">
            Unlock FOREVER
          </PurchaseButton>
        </div>
      </div>
    </div>
  );
};
