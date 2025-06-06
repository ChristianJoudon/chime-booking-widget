// src/components/chime/BookingWidget.tsx
import React, { FC, useState } from "react";
import CalendarView from "./CalendarView";
import { DailyAvailability } from "../../types/calendar";

// Example “hard‐coded” availability (for June 2025)
const sampleAvailability: DailyAvailability[] = [
    {
        date: new Date(2025, 5, 6), // June 6, 2025
        slots: [
            { time: "08:30 AM", available: false, label: "SOLD OUT!" },
            { time: "09:45 AM", available: false, label: "SOLD OUT!" },
            { time: "11:00 AM", available: false, label: "Waitlist" },
            { time: "12:45 PM", available: false, label: "Waitlist" },
            { time: "02:00 PM", available: true, label: "4 left!" },
            { time: "03:15 PM", available: true, label: "SPECIAL OFFER" },
        ],
    },
    {
        date: new Date(2025, 5, 7),
        slots: [
            { time: "08:30 AM", available: true, label: "5 left!" },
            { time: "10:00 AM", available: true, label: "3 left!" },
            // …etc…
        ],
    },
    // Add more dates here as needed
];

const BookingWidget: FC = () => {
    return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-white/30 backdrop-blur-sm">
            <div className="w-full max-w-lg space-y-6">
                {/* Hero or Title */}
                <div className="text-center">
                    <h1 className="text-3xl font-semibold text-gray-900">
                        Book Your Appointment
                    </h1>
                    <p className="mt-2 text-gray-600">
                        Click a green date to view available times.
                    </p>
                </div>

                {/* Calendar */}
                <CalendarView availability={sampleAvailability} />
            </div>
        </div>
    );
};

export default BookingWidget;