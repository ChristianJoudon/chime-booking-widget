// ServiceCard.jsx
import { motion } from "framer-motion";

export function ServiceCard({ service, selected, onSelect }) {
    return (
        <motion.button
            className={
                "w-full p-4 rounded-xl shadow-md bg-white/70 backdrop-blur text-left " +
                "transition transform hover:-translate-y-1 hover:shadow-lg focus:outline-none " +
                (selected ? "ring-2 ring-mint shadow-lg" : "")
            }
            onClick={() => onSelect(service)}
            whileHover={{ scale: 1.02 }}
        >
            <h3 className="text-lg font-semibold text-gray-900">
                {service.name}
            </h3>
            {service.duration && (
                <p className="text-sm text-gray-500">{service.duration}</p>
            )}
            {service.description && (
                <p className="mt-1 text-sm text-gray-600">{service.description}</p>
            )}
        </motion.button>
    );
}