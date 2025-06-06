// ContinueButton.jsx
import { motion } from "framer-motion";
import type { ReactNode } from 'react'

export interface ContinueButtonProps {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
}

export function ContinueButton({ children, disabled = false, onClick }: ContinueButtonProps) {
    return (
        <motion.button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={
                `w-full py-3 px-6 rounded-lg font-semibold text-white 
         bg-mint hover:bg-mint-dark transition-colors duration-300 ` +
                (disabled ? "opacity-50 cursor-not-allowed" : "shadow-md hover:shadow-lg")
            }
            whileTap={{ scale: disabled ? 1 : 0.98 }}
        >
            {children}
        </motion.button>
    );
}

