import { useState } from 'react'

export interface BookingFormProps {
  onSubmit: (details: { name: string; email: string }) => void
  deposit?: number
}

export default function BookingForm({ onSubmit, deposit = 0 }: BookingFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    onSubmit({ name, email })
  }

  return (
    <form onSubmit={handleSubmit} className="booking-form">
      <div>
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} required /></label>
      </div>
      <div>
        <label>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      </div>
      {deposit > 0 && <p>Deposit due: ${deposit}</p>}
      <button type="submit" disabled={!name || !email}>Continue</button>
    </form>
  )
}


