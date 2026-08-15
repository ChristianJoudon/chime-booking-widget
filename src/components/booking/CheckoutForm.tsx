import { type FormEvent, useState } from 'react';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

import { ContinueButton } from '@/components/ui/ContinueButton';
import { formatMoneyFromCents } from '@/lib/normalizers';

interface Props {
  amount: number;
  currency?: string;
  onSuccess: (response: { paymentIntentId: string }) => void;
}

export default function CheckoutForm({ amount, currency, onSuccess }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setPaying(true);
    setErrorMsg(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    setPaying(false);

    if (error) {
      setErrorMsg(error.message ?? 'Payment failed.');
      return;
    }

    if (!paymentIntent?.id) {
      setErrorMsg('Payment was processed but no payment intent was returned.');
      return;
    }

    onSuccess({ paymentIntentId: paymentIntent.id });
  }

  return (
    <form onSubmit={handleSubmit} className="checkout-form">
      <PaymentElement />
      <ContinueButton disabled={!stripe || paying}>
        {paying ? 'Processing…' : `Pay refundable ${formatMoneyFromCents(amount, currency ?? 'USD')} deposit`}
      </ContinueButton>
      {errorMsg && <p className="checkout-form__error" role="alert">{errorMsg}</p>}
    </form>
  );
}
