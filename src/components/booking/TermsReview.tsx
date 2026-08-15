import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';

import { ContinueButton } from '@/components/ui/ContinueButton';
import { formatMoneyFromCents } from '@/lib/normalizers';
import type { Slot } from '@/types/calendar';
import type { Service } from '@/types/service';
import type { WidgetConfig } from '@/types/widget';

interface Props {
  config: WidgetConfig;
  service: Service;
  slot: Slot;
  date: Date;
  depositAmountCents: number;
  requiresPaymentStep: boolean;
  onBack?: () => void;
  onConfirm: () => void;
}

function buildTermsParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function TermsReview({
  config,
  service,
  slot,
  date,
  depositAmountCents,
  requiresPaymentStep,
  onBack,
  onConfirm,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [scrollPercent, setScrollPercent] = useState(0);
  const paragraphs = useMemo(() => buildTermsParagraphs(config.termsText), [config.termsText]);
  const canConfirm = hasScrolledToBottom && accepted;

  const updateScrollState = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;

    const maxScroll = Math.max(1, node.scrollHeight - node.clientHeight);
    const nextPercent = Math.min(100, Math.round((node.scrollTop / maxScroll) * 100));
    const reachedBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 12;

    setScrollPercent(reachedBottom ? 100 : nextPercent);
    if (reachedBottom) setHasScrolledToBottom(true);
  }, []);

  const runScrollFitCheck = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;

    if (node.scrollHeight <= node.clientHeight + 12) {
      setScrollPercent(100);
      setHasScrolledToBottom(true);
    } else {
      updateScrollState();
    }
  }, [updateScrollState]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    window.requestAnimationFrame(() => {
      runScrollFitCheck();
    });
  }, [config.termsText, runScrollFitCheck]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        runScrollFitCheck();
      });
    });
    observer.observe(node);

    return () => observer.disconnect();
  }, [runScrollFitCheck]);

  return (
    <div className="terms-review">
      <div className="terms-review__intro">
        <div>
          <p className="chime-kicker">Terms &amp; Conditions</p>
          <h3>Read the full terms document</h3>
          <p>
            The checkbox stays locked until you scroll to the bottom. After that, you can add your name and email.
          </p>
        </div>
        <div
          className="terms-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={scrollPercent}
          aria-label="Terms read progress"
        >
          <span style={{ width: `${scrollPercent}%` }} />
        </div>
      </div>

      <section className="terms-receipt" aria-label="Appointment receipt before terms acceptance">
        <div>
          <span>Service</span>
          <strong>{service.name}</strong>
        </div>
        <div>
          <span>Appointment</span>
          <strong>{format(date, 'MMM d, yyyy')} · {slot.timeLabel}</strong>
        </div>
        {depositAmountCents > 0 && (
          <div>
            <span>Refundable deposit</span>
            <strong>{formatMoneyFromCents(depositAmountCents, config.payment.currency)}</strong>
          </div>
        )}
        <div>
          <span>Next</span>
          <strong>{requiresPaymentStep ? 'Contact details, then deposit' : 'Contact details'}</strong>
        </div>
      </section>

      <div className="terms-document" ref={scrollRef} onScroll={updateScrollState} tabIndex={0}>
        <div className="terms-document__paper">
          <h4>{config.termsTitle ?? `${config.businessName} Terms & Conditions`}</h4>
          {paragraphs.map((paragraph, index) => (
            <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
          ))}
        </div>
      </div>

      <motion.label
        className="terms-acceptance"
        data-unlocked={hasScrolledToBottom ? 'true' : 'false'}
        animate={{ opacity: hasScrolledToBottom ? 1 : 0.68 }}
      >
        <input
          type="checkbox"
          checked={accepted}
          disabled={!hasScrolledToBottom}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setAccepted(event.target.checked)}
        />
        <span>
          {hasScrolledToBottom
            ? 'I have read and agree to the terms and conditions.'
            : 'Scroll to the bottom of the terms document to unlock acceptance.'}
        </span>
      </motion.label>

      <span id="terms-gate-status" className="sr-only" role="status" aria-live="polite">
        {hasScrolledToBottom
          ? 'You can now accept the terms.'
          : 'Scroll to the bottom to accept the terms.'}
      </span>

      <div className="terms-actions">
        {onBack && (
          <ContinueButton type="button" variant="secondary" onClick={onBack}>
            Back to calendar
          </ContinueButton>
        )}
        <ContinueButton type="button" disabled={!canConfirm} onClick={onConfirm} aria-describedby="terms-gate-status">
          Continue to contact details
        </ContinueButton>
      </div>
    </div>
  );
}
