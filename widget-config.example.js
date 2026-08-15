window.CHIME_WIDGET_CONFIG = {
  businessName: 'Your Business Name',
  headerTitle: 'Book an Appointment',
  description: 'Choose a service, pick a date and time, read the terms, enter contact details, then pay the refundable $20 appointment deposit.',
  payment: {
    enabled: true,
    stripePublishableKey: 'pk_live_replace_me',
    currency: 'USD',
  },
  api: {
    baseUrl: 'https://yourwebsite.com',
    servicesUrl: '/api/chime/services',
    availabilityUrl: '/api/chime/availability',
    bookingUrl: '/api/chime/bookings',
    paymentIntentUrl: '/api/chime/create-payment-intent',
  },
  customerFields: [
    { key: 'name', label: 'Full name', required: true, type: 'text' },
    { key: 'email', label: 'Email', required: true, type: 'email' },
    { key: 'phone', label: 'Phone', required: false, type: 'tel' },
    { key: 'notes', label: 'Notes', required: false, type: 'textarea' },
  ],
  termsTitle: 'Appointment Terms & Conditions',
  termsText: `Appointment Terms & Conditions

Replace this with the full terms document shown during booking.

Customers must scroll to the bottom before the agreement checkbox unlocks. Name and email are required before the refundable deposit payment step.`,
};
