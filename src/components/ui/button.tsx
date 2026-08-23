import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-phosphor-dim text-phosphor hover:bg-[color-mix(in_srgb,var(--phosphor)_22%,transparent)] font-semibold border border-transparent',
        outline: 'border border-grat bg-transparent text-ink-2 hover:border-grat-strong hover:text-ink',
        ghost: 'text-ink-3 hover:text-ink-2 hover:bg-scope-2',
        destructive: 'border border-grat text-ink-2 hover:border-alert hover:text-alert',
        link: 'text-phosphor underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 py-1',
        sm: 'h-7 rounded-md px-2.5 text-[11.5px]',
        lg: 'h-10 rounded-lg px-5 text-[13px]',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
