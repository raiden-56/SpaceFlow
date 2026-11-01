import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';

/** Page wrapper with a short fade/slide transition (respects reduced motion through MotionConfig). */
export function PageTransition({ children, ...rest }: { children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: 'easeOut' }} {...rest}>
      {children}
    </motion.div>
  );
}

/** Staggered list container + item for card entrance animations. */
export const staggerContainer = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
export const staggerItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.22 } } };

export function StaggerList({ children, style, className }: { children: ReactNode; style?: React.CSSProperties; className?: string }) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" style={style} className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <motion.div variants={staggerItem} style={style}>
      {children}
    </motion.div>
  );
}
