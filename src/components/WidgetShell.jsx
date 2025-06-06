import { useState } from 'react'
import ServiceList from './ServiceList.jsx'
import Calendar from './Calendar.jsx'
import TimeSlots from './TimeSlots.jsx'
import BookingForm from './BookingForm.jsx'
import Payment from './Payment.jsx'
import Confirmation from './Confirmation.jsx'

const dummyServices = [
  { id: 'svc1', name: 'Consultation', duration: 30 },
  { id: 'svc2', name: 'Repair', duration: 60 },
]

const dummyTimes = ['09:00', '10:00', '11:00', '14:00']

export default function WidgetShell() {
  const [step, setStep] = useState('services')
  const [service, setService] = useState(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [customer, setCustomer] = useState(null)
  const [booking, setBooking] = useState(null)

  function handleServiceSelect(svc) {
    setService(svc)
    setStep('date')
  }

  function handleDateSelect(d) {
    setDate(d)
    setStep('time')
  }

  function handleTimeSelect(t) {
    setTime(t)
    setStep('form')
  }

  function handleFormSubmit(data) {
    setCustomer(data)
    setStep('payment')
  }

  function handlePaymentSuccess(pay) {
    const b = {
      service,
      date,
      time,
      customer,
      payment: pay,
    }
    setBooking(b)
    setStep('confirm')
  }

  if (step === 'services') {
    return <ServiceList services={dummyServices} onSelect={handleServiceSelect} />
  }
  if (step === 'date') {
    return <Calendar value={date} onChange={handleDateSelect} />
  }
  if (step === 'time') {
    return <TimeSlots slots={dummyTimes} onSelect={handleTimeSelect} />
  }
  if (step === 'form') {
    return <BookingForm onSubmit={handleFormSubmit} />
  }
  if (step === 'payment') {
    return <Payment onSuccess={handlePaymentSuccess} />
  }
  if (step === 'confirm') {
    return <Confirmation booking={booking} />
  }
  return null
}
