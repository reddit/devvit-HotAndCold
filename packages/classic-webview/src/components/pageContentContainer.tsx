import { cn } from '@hotandcold/webview-common/utils';

interface PageContentContainerProps {
  children: React.ReactNode;
  showContainer?: boolean;
  className?: string;
}

export const PageContentContainer = ({
  children,
  showContainer = false, // Whether to show the container wrapper
  className,
}: PageContentContainerProps) => {
  return (
    <div
      className={cn(
        'h-full p-6',
        showContainer && 'rounded-3xl border bg-black/50 bg-cover bg-center bg-no-repeat',
        className
      )}
    >
      {children}
    </div>
  );
};
