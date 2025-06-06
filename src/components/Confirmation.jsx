import PropTypes from 'prop-types'

export default function Confirmation({ booking }) {
  return (
    <div className="confirmation">
      <h2>Booking Confirmed!</h2>
      <p>{booking.service.name} on {booking.date} at {booking.time}</p>
      <p>Booking ID: {booking.id}</p>
      <p>Thanks, {booking.customer.name}! A confirmation email will be sent to {booking.customer.email}.</p>
      {booking.payment && <p>Deposit paid: ${booking.service.deposit}</p>}
    </div>
  )
}

Confirmation.propTypes = {
  booking: PropTypes.object.isRequired,
}
