export interface PaymentProps {
  onSuccess: (result: { paymentIntentId: string }) => void
  amount?: number
}

export default function Payment({ onSuccess, amount = 0 }: PaymentProps) {
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


