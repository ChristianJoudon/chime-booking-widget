// HeroTitle.jsx
import { motion } from "framer-motion";

export interface HeroTitleProps {
  title: string
  subtitle?: string
}

export function HeroTitle({ title, subtitle }: HeroTitleProps) {
    return (
        <motion.div
            className="text-center py-2"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
        >
            <h1 className="text-3xl md:text-5xl font-semibold text-gray-900">
                {title}
            </h1>
            {subtitle && (
                <p className="mt-2 text-lg text-gray-600">
                    {subtitle}
                </p>
            )}
        </motion.div>
    );
}
