import PropTypes from 'prop-types'
import { useState } from 'react'

export default function BookingForm({ onSubmit, deposit }) {
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

BookingForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  deposit: PropTypes.number,
}
