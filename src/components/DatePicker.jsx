// DatePicker.jsx
import { motion } from "framer-motion";

export function DatePicker({ selectedDate, onChange }) {
    return (
        <motion.div
            className="space-y-2"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.5 }}
        >
            <label htmlFor="date" className="text-lg font-medium text-gray-900">
                Choose a Date
            </label>
            <input
                id="date"
                type="date"
                value={selectedDate || ""}
                onChange={e => onChange(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-md border border-gray-300
                   text-gray-900 placeholder-gray-400
                   focus:outline-none focus:ring-2 focus:ring-mint focus:border-mint"
            />
        </motion.div>
    );
}