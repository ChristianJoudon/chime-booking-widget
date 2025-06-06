// WhatYouNeed.jsx
import { motion } from "framer-motion";
import { CheckCircleIcon } from "@heroicons/react/24/solid";  // for example, using Heroicons

export function WhatYouNeed() {
    const items = [
        "A computer or smartphone with internet access",
        "Working microphone and camera",
        "Any relevant documents or notes"
    ];

    return (
        <motion.div
            className="bg-gray-100/50 p-4 rounded-lg text-gray-800"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.5 }}
        >
            <h2 className="text-lg font-medium mb-2">What You’ll Need:</h2>
            <ul className="list-none space-y-1 pl-0">
                {items.map((item, idx) => (
                    <li key={idx} className="flex items-start">
                        {/* Icon or bullet */}
                        <CheckCircleIcon className="h-5 w-5 text-mint flex-shrink-0 mr-2 mt-[2px]" />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </motion.div>
    );
}