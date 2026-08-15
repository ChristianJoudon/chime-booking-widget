import { useEffect, useMemo, useState } from 'react';
import { loadStripe, type Appearance } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';

import CheckoutForm from '@/components/booking/CheckoutForm';
import DemoCheckoutForm from '@/components/booking/DemoCheckoutForm';
import { ContinueButton } from '@/components/ui/ContinueButton';
import { createPaymentIntent } from '@/lib/api';
import { formatMoneyFromCents } from '@/lib/normalizers';
import type { Slot } from '@/types/calendar';
import type { Service } from '@/types/service';
import type { CustomerDetails, WidgetConfig } from '@/types/widget';

export interface PaymentProps {
  config: WidgetConfig;
  amountCents: number;
  mode: 'stripe' | 'demo' | 'unconfigured';
  service: Service;
  slot: Slot;
  date: Date;
  customer: CustomerDetails;
  onBack?: () => void;
  onSuccess: (response: { paymentIntentId: string }) => void;
}

export default function Payment({
  config,
  amountCents,
  mode,
  service,
  slot,
  date,
  customer,
  onBack,
  onSuccess,
}: PaymentProps) {
  const publishableKey = config.payment.stripePublishableKey;
  const stripePromise = useMemo(
    () => (mode === 'stripe' && publishableKey ? loadStripe(publishableKey) : null),
    [mode, publishableKey],
  );

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const appearance: Appearance = {
    theme: 'stripe',
    variables: {
      colorPrimary: '#4DBD98',
      colorText: '#102A24',
      colorTextSecondary: '#52645F',
      colorBackground: '#FFFFFF',
      colorDanger: '#C84C50',
      borderRadius: '18px',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
    },
    rules: {
      '.Input': {
        border: '1px solid rgba(77, 189, 152, 0.22)',
        boxShadow: '0 10px 24px rgba(32, 90, 63, 0.08)',
      },
      '.Input:focus': {
        border: '1px solid rgba(77, 189, 152, 0.82)',
        boxShadow: '0 0 0 4px rgba(77, 189, 152, 0.18)',
      },
      '.Label': {
        color: '#2C7855',
        fontWeight: '600',
      },
    },
  };

  useEffect(() => {
    // The client secret is only needed for the real Stripe payment element.
    if (mode !== 'stripe') return;

    let cancelled = false;

    async function fetchClientSecret() {
      if (!publishableKey) {
        setErrorMessage('A Stripe publishable key is required to collect the refundable appointment deposit.');
        return;
      }

      try {
        const response = await createPaymentIntent(config, {
          amountCents,
          serviceId: service.id,
          serviceName: service.name,
          slotId: slot.id,
          date,
          customerEmail: customer.email,
        });

        if (!cancelled) {
          if (!response.clientSecret) {
            setErrorMessage('The payment endpoint did not return a Stripe client secret.');
            return;
          }

          setClientSecret(response.clientSecret);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Unable to start the payment step.');
        }
      }
    }

    void fetchClientSecret();
    return () => {
      cancelled = true;
    };
  }, [amountCents, config, customer.email, date, mode, publishableKey, service.id, service.name, slot.id]);

  return (
    <div className="payment-step-card">
      <div className="payment-step-card__header">
        <p className="chime-kicker">Refundable deposit</p>
        <h3>Place the refundable appointment deposit</h3>
        <p>
          Pay the refundable appointment deposit of {formatMoneyFromCents(amountCents, config.payment.currency)} to reserve this time.
        </p>
      </div>

      {mode === 'unconfigured' ? (
        <div className="chime-alert chime-alert--error" role="alert">
          Online deposits are required for booking but payments are not configured. Add a Stripe
          publishable key and payment-intent endpoint (see WIDGET_INTEGRATION.md).
        </div>
      ) : mode === 'demo' ? (
        <>
          <div className="chime-alert chime-alert--warning">
            Test mode — no real charge will be made. Use card 4242 4242 4242 4242 with any future
            expiry and any CVC.
          </div>
          <DemoCheckoutForm
            amountCents={amountCents}
            currency={config.payment.currency}
            onSuccess={onSuccess}
          />
        </>
      ) : errorMessage ? (
        <div className="chime-alert chime-alert--error" role="alert">{errorMessage}</div>
      ) : !clientSecret || !stripePromise ? (
        <div className="chime-loading-card">Loading secure deposit form…</div>
      ) : (
        <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
          <CheckoutForm amount={amountCents} currency={config.payment.currency} onSuccess={onSuccess} />
        </Elements>
      )}

      {onBack && (
        <ContinueButton type="button" variant="secondary" onClick={onBack}>
          Back to contact details
        </ContinueButton>
      )}
    </div>
  );
}
