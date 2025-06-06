// src/components/chime/CalendarView.tsx
import React, { FC, useState, useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css"; // default styles we’ll override
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { DailyAvailability, TimeSlot } from "../../types/calendar";
import TimeModal from "./TimeModal";

interface CalendarViewProps {
    availability: DailyAvailability[];
    // e.g. [ { date: new Date(2025,5,6), slots: [...] }, ... ]
}

const CalendarView: FC<CalendarViewProps> = ({ availability }) => {
    // Track which day the user clicked (or null if none)
    const [selectedDay, setSelectedDay] = useState<Date | null>(null);

    // Find the availability entry for the selectedDay (if any)
    const selectedAvailability = useMemo<DailyAvailability | undefined>(() => {
        if (!selectedDay) return undefined;
        return availability.find((d) =>
            d.date.toDateString() === selectedDay.toDateString()
        );
    }, [selectedDay, availability]);

    // Helper: return array of JS Dates that have ANY available slots
    const availableDates = useMemo<Date[]>(() => {
        return availability
            .filter((d) => d.slots.some((slot) => slot.available))
            .map((d) => d.date);
    }, [availability]);

    return (
        <div className="w-full max-w-md mx-auto">
            {/* Calendar Header */}
            <h2 className="text-2xl font-semibold text-gray-900 mb-4 text-center">
                Select a Date
            </h2>

            {/* DayPicker Calendar */}
            <DayPicker
                mode="single"
                selected={selectedDay!}
                onSelect={(date) => {
                    if (!date) return;
                    // Only open if we have data for that day
                    const found = availability.find(
                        (d) => d.date.toDateString() === date.toDateString()
                    );
                    if (found) {
                        setSelectedDay(date);
                    }
                }}
                footer={
                    <p className="mt-2 text-center text-sm text-gray-600">
                        Days in <span className="font-medium">mint</span> have availability.
                    </p>
                }
                modifiers={{
                    // “available” days: highlight them
                    available: availableDates,
                }}
                modifiersClassNames={{
                    available: "bg-mint/20 hover:bg-mint/40 text-mint", // pastel mint highlight
                }}
                disabled={[
                    (date) =>
                        // disable any date not in our availability list
                        !availability.some(
                            (d) => d.date.toDateString() === date.toDateString()
                        ),
                ]}
                className="rounded-xl border border-gray-200 shadow-md p-4 glass-panel"
            />

            {/* AnimatePresence ensures the modal animates in/out */}
            <AnimatePresence>
                {selectedAvailability && (
                    <TimeModal
                        availability={selectedAvailability}
                        onClose={() => setSelectedDay(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
};

export default CalendarView;