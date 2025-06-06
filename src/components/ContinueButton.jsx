// ContinueButton.jsx
import { motion } from "framer-motion";

export function ContinueButton({ children, disabled, onClick }) {
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