import { ComponentProps } from 'react';
import { cn } from '@hotandcold/webview-common/utils';

export const PrimaryButton = ({
  children,
  className,
  disabled,
  ...rest
}: ComponentProps<'button'>) => {
  return (
    <button
      className={cn(
        'relative inline-flex h-12 overflow-hidden rounded-full p-[2px] focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50',
        className
      )}
      disabled={disabled}
      {...rest}
    >
      <span
        className={cn(
          'absolute inset-[-1000%] animate-[spin_2s_linear_infinite] bg-gray-800',
          !disabled &&
            'bg-[conic-gradient(from_135deg_at_50%_50%,#4CE1F2_0%,#FFFFFF_33%,#DE3232_66%,#4CE1F2_100%)]'
        )}
      />
      <span className="inline-flex h-full w-full cursor-pointer items-center justify-center rounded-full bg-gray-800 px-4 py-3 text-sm font-medium text-white backdrop-blur-3xl">
        {children}
      </span>
    </button>
  );
};

export const SecondaryButton = ({ children, className, ...rest }: ComponentProps<'button'>) => {
  return (
    <button
      className={cn(
        'rounded-md bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/[0.8] hover:shadow-lg',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
};
