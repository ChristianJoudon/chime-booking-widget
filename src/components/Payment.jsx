import PropTypes from 'prop-types'

export default function Payment({ onSuccess }) {
  function handlePay() {
    // pretend payment succeeded
    onSuccess({ paymentIntentId: 'test' })
  }

  return (
    <div className="payment-step">
      <p>Payment step (placeholder)</p>
      <button onClick={handlePay}>Pay Deposit</button>
    </div>
  )
}

Payment.propTypes = {
  onSuccess: PropTypes.func.isRequired,
}
