// src/components/chime/TimeModal.tsx
import React, { FC } from "react";
import { DailyAvailability, TimeSlot } from "../../types/calendar";
import { motion } from "framer-motion";
import { XMarkIcon } from "@heroicons/react/24/solid";
import { format } from "date-fns";

interface TimeModalProps {
    availability: DailyAvailability;
    onClose: () => void;
}

const TimeModal: FC<TimeModalProps> = ({ availability, onClose }) => {
    const { date, slots } = availability;
    const formattedDate = format(date, "EEEE, MMMM d, yyyy"); // e.g. "Friday, June 6, 2025"

    return (
        <>
            {/* Backdrop */}
            <motion.div
                className="fixed inset-0 bg-black/30"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
            />

            {/* Modal Card */}
            <motion.div
                className="fixed inset-0 flex items-center justify-center p-4"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
            >
                <div className="glass-panel max-w-sm w-full p-6 space-y-4 relative">
                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-3 right-3 text-gray-600 hover:text-gray-900"
                    >
                        <XMarkIcon className="h-6 w-6" />
                    </button>

                    {/* Date Header */}
                    <h3 className="text-xl font-semibold text-gray-900">
                        {formattedDate}
                    </h3>

                    {/* Times List */}
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                        {slots.map((slot: TimeSlot) => (
                            <div
                                key={slot.time}
                                className={
                                    `flex justify-between items-center p-3 rounded-lg border ` +
                                    (slot.available
                                        ? "border-green-300 bg-green-50 hover:bg-green-100 cursor-pointer"
                                        : "border-gray-300 bg-gray-100 text-gray-500 cursor-not-allowed")
                                }
                            >
                                <div className="flex items-center space-x-2">
                                    {slot.available ? (
                                        <span className="w-3 h-3 rounded-full bg-green-400" />
                                    ) : (
                                        <span className="w-3 h-3 rounded-full bg-gray-400" />
                                    )}
                                    <span className="font-medium">
                    {slot.time}
                  </span>
                                </div>
                                {!slot.available && slot.label && (
                                    <span className="text-sm text-gray-500">{slot.label}</span>
                                )}
                                {/* If slot is available, you could render an arrow or “Select” text */}
                                {slot.available && (
                                    <span className="text-sm text-green-700">Book Now</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </motion.div>
        </>
    );
};

export default TimeModal;