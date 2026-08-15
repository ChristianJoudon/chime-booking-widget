import { motion } from 'framer-motion';
import { type ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

export const ContinueButton = ({
  children,
  disabled = false,
  type = 'submit',
  variant = 'primary',
  className = '',
  ...rest
}: Props) => (
  <motion.button
    type={type}
    className={`chime-button chime-button--${variant} ${className}`}
    data-disabled={disabled ? 'true' : 'false'}
    whileHover={disabled ? undefined : { y: -2 }}
    whileTap={disabled ? undefined : { scale: 0.975 }}
    disabled={disabled}
    {...rest}
  >
    {children}
  </motion.button>
);
