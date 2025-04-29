import React, { ComponentProps, useEffect } from 'react';
import { HardcoreLogo } from '@hotandcold/webview-common/components/logo';
import { GoldIcon } from '@hotandcold/webview-common/components/icon';
import { cn } from '@hotandcold/webview-common/utils';
import { Modal } from '@hotandcold/webview-common/components/modal';
import { sendMessageToDevvit } from '../utils';
import { useHardcoreAccess } from '../hooks/useHardcoreAccess';

interface PurchaseButtonProps {
  children: React.ReactNode;
  style: 'primary' | 'secondary';
  price: number;
  productSku: 'hardcore-mode-lifetime-access' | 'hardcore-mode-seven-day-access';
}

const PurchaseButton: React.FC<PurchaseButtonProps> = (props) => {
  const { children, price, productSku, style } = props;

  const onClick = () => {
    sendMessageToDevvit({
      type: 'PURCHASE_PRODUCT',
      payload: {
        sku: productSku,
      },
    });
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full flex-row items-center justify-between gap-4 whitespace-nowrap rounded-full border-2 border-current px-6 py-3 text-center font-sans font-semibold sm:w-auto',
        style === 'primary' ? 'text-mustard-gold' : 'text-slate-gray'
      )}
    >
      <span className="text-left text-base">{children}</span>
      <span
        className={cn(
          'flex w-fit flex-row items-center gap-[6px] rounded-full px-3 py-2 text-xs',
          style === 'primary' ? 'bg-mustard-gold text-black' : 'bg-charcoal text-white'
        )}
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <GoldIcon />
        </span>
        Use {price}
      </span>
    </button>
  );
};

type UnlockHardcoreModalProps = Omit<ComponentProps<typeof Modal>, 'children'>;

export const UnlockHardcoreModal = (props: UnlockHardcoreModalProps) => {
  const { access } = useHardcoreAccess();

  useEffect(() => {
    if (access.status === 'active') {
      props.onClose?.();
    }
  }, [access]);

  return (
    <Modal {...props}>
      <div className="flex w-full max-w-md flex-col items-center justify-center gap-4 p-6 sm:gap-6 sm:p-8 md:max-w-2xl md:p-10">
        <HardcoreLogo />
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
      </div>
    </Modal>
  );
};
