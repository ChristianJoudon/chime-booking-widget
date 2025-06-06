// App.jsx or BookingWidget.jsx
import { HeroTitle, ServiceGrid, WhatYouNeed, DatePicker, ContinueButton } from "./components";
import { useState } from "react";

function App() {
    // State for selected service and date (to be used for form logic, not fully implemented here)
    const [selectedService, setSelectedService] = useState(null);
    const [selectedDate, setSelectedDate] = useState(null);

    // Example placeholder service data
    const services = [
        { id: 1, name: "Consultation", duration: "30 min", description: "General consultation session" },
        { id: 2, name: "Therapy Session", duration: "1 hr", description: "One-hour therapy appointment" },
        { id: 3, name: "Follow-up", duration: "30 min", description: "Follow-up meeting" }
    ];

    return (
        <div className="min-h-screen flex items-center justify-center bg-white/30 backdrop-blur-sm px-4">
            {/* Content Panel */}
            <div className="relative w-full max-w-md bg-white/80 backdrop-blur shadow-xl rounded-2xl p-6 space-y-6">
                <HeroTitle title="Book Your Appointment" />
                <ServiceGrid
                    services={services}
                    selectedId={selectedService?.id}
                    onSelect={(service) => setSelectedService(service)}
                />
                <WhatYouNeed />
                <DatePicker
                    selectedDate={selectedDate}
                    onChange={(date) => setSelectedDate(date)}
                />
                <ContinueButton
                    disabled={!selectedService || !selectedDate}
                    onClick={() => {/* integrate Stripe/Resend/Twilio on continue */}}
                >
                    Continue
                </ContinueButton>
            </div>
        </div>
    );
}

export default App;
