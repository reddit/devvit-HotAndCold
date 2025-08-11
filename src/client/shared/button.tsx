import { ComponentProps, JSX } from 'preact';
import { GradientBorder } from './gradientBorder';
import { cn } from '../utils/cn';

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
        'cursor-pointer rounded-full font-[inherit] text-sm font-medium text-black focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-50 dark:text-white',
        // Visible neutral surface in light/dark modes
        'bg-zinc-100 dark:bg-zinc-800',
        className
      )}
      disabled={disabled}
      {...rest}
    >
      <GradientBorder isHidden={!!disabled}>
        <span className="inline-block px-4 py-3">{children}</span>
      </GradientBorder>
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
  icon: JSX.Element;
  'aria-label': string; // Require label for accessibility since the text is often hidden.
}) => (
  <button
    className={cn(
      'flex items-center gap-2 rounded-full bg-gray-50 p-3 text-current md:px-3 md:py-2 dark:bg-black',
      className
    )}
    {...rest}
  >
    {icon}
    <span className="hidden md:inline">{children}</span>
  </button>
);
