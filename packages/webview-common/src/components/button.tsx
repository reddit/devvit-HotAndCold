import { ComponentProps } from 'react';
import { cn } from '@hotandcold/webview-common/utils';

export const PrimaryButton = ({
  children,
  className,
  disabled,
  isHighContrast,
  ...rest
}: ComponentProps<'button'> & {
  isHighContrast?: boolean;
}) => {
  return (
    <button
      className={cn(
        'relative inline-flex overflow-hidden rounded-full p-[2px] font-[inherit] text-sm font-medium text-black focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 dark:text-white',
        isHighContrast ? 'bg-white dark:bg-black' : 'bg-gray-50 dark:bg-gray-800',
        className
      )}
      disabled={disabled}
      {...rest}
    >
      <span
        className={cn(
          'absolute inset-[-1000%] animate-[spin_2s_linear_infinite] bg-[conic-gradient(from_135deg_at_50%_50%,#4CE1F2_0%,#FFBF0B_33%,#DE3232_66%,#4CE1F2_100%)] transition-opacity duration-300',
          disabled ? 'opacity-0' : 'opacity-100'
        )}
      />
      <span className="z-10 rounded-full bg-inherit px-4 py-3">{children}</span>
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

export const IconButton = ({
  children,
  className,
  icon,
  ...rest
}: ComponentProps<'button'> & {
  icon: React.ReactNode;
  'aria-label': string; // Require label for accessibility since the text is often hidden.
}) => (
  <button
    className={cn(
      'flex items-center gap-2 rounded-full bg-gray-50 p-3 text-current sm:px-3 sm:py-2 dark:bg-black',
      className
    )}
    {...rest}
  >
    {icon}
    <span className="hidden sm:inline">{children}</span>
  </button>
);
