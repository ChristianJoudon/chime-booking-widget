import PropTypes from 'prop-types'

export default function Payment({ onSuccess, amount }) {
  function handlePay() {
    // pretend payment succeeded
    setTimeout(() => onSuccess({ paymentIntentId: 'test' }), 500)
  }

  return (
    <div className="payment-step">
      <p>Deposit amount: ${amount}</p>
      <button onClick={handlePay}>Pay Deposit</button>
    </div>
  )
}

Payment.propTypes = {
  onSuccess: PropTypes.func.isRequired,
  amount: PropTypes.number,
}
