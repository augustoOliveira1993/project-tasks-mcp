import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        outline: 'border border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]',
        secondary: 'border border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline'
      },
      size: {
        default: 'px-3 py-2.5 has-[>svg]:px-2.5',
        sm: 'px-2.5 py-[7px] text-[10px] has-[>svg]:px-2',
        lg: 'px-5 py-3 text-xs',
        icon: 'size-[29px]'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  // Botões com fundo próprio (chips, cartões) não herdam o hover da variante, que sobrescreveria as cores deles.
  const variantClass = typeof className === 'string' && /(^|\s)bg-/.test(className)
    ? buttonVariants({ variant, size }).split(' ').filter(token => !token.startsWith('hover:')).join(' ')
    : buttonVariants({ variant, size });
  return <Comp data-slot="button" className={cn(variantClass, className)} type={asChild ? undefined : type ?? 'button'} {...props} />;
}

export { Button, buttonVariants };
export type { ButtonProps };
