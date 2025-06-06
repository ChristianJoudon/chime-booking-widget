import PropTypes from 'prop-types'
import { useState } from 'react'

export default function BookingForm({ onSubmit }) {
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
      <button type="submit">Continue</button>
    </form>
  )
}

BookingForm.propTypes = {
  onSubmit: PropTypes.func.isRequired,
}
