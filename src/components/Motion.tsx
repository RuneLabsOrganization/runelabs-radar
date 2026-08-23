'use client';

import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type MotionProps,
} from 'motion/react';
import { forwardRef, type ReactNode } from 'react';

/** Motion div that skips enter/transition animations when the user prefers reduced motion. */
export const Motion = forwardRef<HTMLDivElement, HTMLMotionProps<'div'>>(function Motion(
  { initial, transition, ...props },
  ref,
) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={reduced ? false : initial}
      transition={reduced ? { duration: 0 } : transition}
      {...props}
    />
  );
});

export function FadeIn({
  children,
  className,
  delay = 0,
  ...props
}: Omit<HTMLMotionProps<'div'>, 'children'> & { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  const enter: MotionProps['initial'] = reduced ? false : { opacity: 0, y: 4 };
  const animate: MotionProps['animate'] = { opacity: 1, y: 0 };
  const transition: MotionProps['transition'] = reduced
    ? { duration: 0 }
    : { duration: 0.36, ease: 'easeOut', delay };

  return (
    <motion.div className={className} initial={enter} animate={animate} transition={transition} {...props}>
      {children}
    </motion.div>
  );
}

export { motion, useReducedMotion };
