import { type ChangeEvent, type FormEvent, useMemo, useState } from 'react';

import { ContinueButton } from '@/components/ui/ContinueButton';
import { formatMoneyFromCents } from '@/lib/normalizers';

type FieldKey = 'cardNumber' | 'expiry' | 'cvc' | 'cardholderName';

interface Props {
  amountCents: number;
  currency?: string;
  onSuccess: (response: { paymentIntentId: string }) => void;
}

function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function getExpiryError(value: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})$/.exec(value);
  if (!match) return 'Enter the expiry as MM/YY.';

  const month = Number(match[1]);
  if (month < 1 || month > 12) return 'Enter a month between 01 and 12.';

  const year = 2000 + Number(match[2]);
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return 'This card has expired. Use a future expiry date.';
  }

  return undefined;
}

export default function DemoCheckoutForm({ amountCents, currency, onSuccess }: Props) {
  const [values, setValues] = useState<Record<FieldKey, string>>({
    cardNumber: '',
    expiry: '',
    cvc: '',
    cardholderName: '',
  });
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [processing, setProcessing] = useState(false);

  const errors = useMemo<Partial<Record<FieldKey, string>>>(() => {
    const next: Partial<Record<FieldKey, string>> = {};
    if (values.cardNumber.replace(/\s/g, '').length !== 16) {
      next.cardNumber = 'Enter the 16-digit card number.';
    }
    const expiryError = getExpiryError(values.expiry);
    if (expiryError) next.expiry = expiryError;
    if (!/^\d{3,4}$/.test(values.cvc)) next.cvc = 'Enter the 3 or 4 digit CVC.';
    if (!values.cardholderName.trim()) next.cardholderName = 'Name on card is required.';
    return next;
  }, [values]);

  const isInvalid = Object.keys(errors).length > 0;

  function updateValue(key: FieldKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function markTouched(key: FieldKey) {
    setTouched((current) => ({ ...current, [key]: true }));
  }

  async function processPayment() {
    setProcessing(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    onSuccess({ paymentIntentId: `demo_pi_${crypto.randomUUID()}` });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched({ cardNumber: true, expiry: true, cvc: true, cardholderName: true });
    if (isInvalid || processing) return;
    void processPayment();
  }

  function showError(key: FieldKey): boolean {
    return Boolean(touched[key] && errors[key]);
  }

  function renderError(key: FieldKey, errorId: string) {
    if (!showError(key)) return null;
    return (
      <small id={errorId} role="alert">
        {errors[key]}
      </small>
    );
  }

  function fieldProps(key: FieldKey, errorId: string) {
    const hasError = showError(key);
    return {
      'aria-invalid': hasError,
      'aria-describedby': hasError ? errorId : undefined,
      onBlur: () => markTouched(key),
    };
  }

  return (
    <form className="details-form" onSubmit={handleSubmit}>
      <div className="details-form__grid">
        <label className="chime-field" data-error={showError('cardNumber') ? 'true' : 'false'}>
          <span>
            Card number
            <em aria-hidden="true">*</em>
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            aria-required
            value={values.cardNumber}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateValue('cardNumber', formatCardNumber(event.target.value))
            }
            className="chime-input"
            {...fieldProps('cardNumber', 'demo-card-number-error')}
          />
          {renderError('cardNumber', 'demo-card-number-error')}
        </label>

        <label className="chime-field" data-error={showError('expiry') ? 'true' : 'false'}>
          <span>
            Expiry (MM/YY)
            <em aria-hidden="true">*</em>
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="12/34"
            aria-required
            value={values.expiry}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateValue('expiry', formatExpiry(event.target.value))
            }
            className="chime-input"
            {...fieldProps('expiry', 'demo-expiry-error')}
          />
          {renderError('expiry', 'demo-expiry-error')}
        </label>

        <label className="chime-field" data-error={showError('cvc') ? 'true' : 'false'}>
          <span>
            CVC
            <em aria-hidden="true">*</em>
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            aria-required
            value={values.cvc}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateValue('cvc', event.target.value.replace(/\D/g, '').slice(0, 4))
            }
            className="chime-input"
            {...fieldProps('cvc', 'demo-cvc-error')}
          />
          {renderError('cvc', 'demo-cvc-error')}
        </label>

        <label
          className="chime-field"
          data-error={showError('cardholderName') ? 'true' : 'false'}
        >
          <span>
            Name on card
            <em aria-hidden="true">*</em>
          </span>
          <input
            type="text"
            autoComplete="cc-name"
            placeholder="Jane Doe"
            aria-required
            value={values.cardholderName}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateValue('cardholderName', event.target.value)
            }
            className="chime-input"
            {...fieldProps('cardholderName', 'demo-cardholder-name-error')}
          />
          {renderError('cardholderName', 'demo-cardholder-name-error')}
        </label>
      </div>

      <div className="details-form__actions">
        <ContinueButton disabled={isInvalid || processing}>
          {processing
            ? 'Processing…'
            : `Pay refundable ${formatMoneyFromCents(amountCents, currency)} deposit`}
        </ContinueButton>
      </div>
      <p className="chime-payment-note">
        Deposits are fully refundable when you attend your appointment.
      </p>
    </form>
  );
}
