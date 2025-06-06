import { useState } from 'react'
import ServiceList from './ServiceList.jsx'
import Calendar from './Calendar.jsx'
import TimeSlots from './TimeSlots.jsx'
import BookingForm from './BookingForm.jsx'
import Payment from './Payment.jsx'
import Confirmation from './Confirmation.jsx'

const dummyServices = [
  { id: 'svc1', name: 'Consultation', duration: 30, deposit: 20 },
  { id: 'svc2', name: 'Repair', duration: 60, deposit: 50 },
]

function generateTimes(duration) {
  const start = 9
  const end = 17
  const times = []
  for (let h = start; h < end; h++) {
    times.push(`${h.toString().padStart(2, '0')}:00`)
    if (duration <= 30) {
      times.push(`${h.toString().padStart(2, '0')}:30`)
    }
  }
  return times
}

export default function WidgetShell() {
  const [step, setStep] = useState('services')
  const [service, setService] = useState(null)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [customer, setCustomer] = useState(null)
  const [booking, setBooking] = useState(null)
  const [times, setTimes] = useState([])

  function handleServiceSelect(svc) {
    setService(svc)
    setDate('')
    setTime('')
    setTimes(generateTimes(svc.duration))
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
      id: crypto.randomUUID(),
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
    return <TimeSlots slots={times} onSelect={handleTimeSelect} />
  }
  if (step === 'form') {
    return <BookingForm onSubmit={handleFormSubmit} deposit={service.deposit} />
  }
  if (step === 'payment') {
    return <Payment amount={service.deposit} onSuccess={handlePaymentSuccess} />
  }
  if (step === 'confirm') {
    return <Confirmation booking={booking} />
  }
  return null
}
