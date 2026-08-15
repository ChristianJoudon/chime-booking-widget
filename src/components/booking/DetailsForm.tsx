import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';

import { ContinueButton } from '@/components/ui/ContinueButton';
import type { CustomerDetails, CustomerFieldConfig } from '@/types/widget';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmailField(field: CustomerFieldConfig): boolean {
  return field.type === 'email' || field.key === 'email';
}

interface Props {
  fields: CustomerFieldConfig[];
  initialValues?: Partial<CustomerDetails>;
  onBack?: () => void;
  backLabel?: string;
  submitLabel?: string;
  onNext: (details: CustomerDetails) => void;
}

function buildInitialValues(fields: CustomerFieldConfig[], initialValues?: Partial<CustomerDetails>) {
  return fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = initialValues?.[field.key] ?? '';
    return acc;
  }, {});
}

function getAutoComplete(field: CustomerFieldConfig): string | undefined {
  if (field.key === 'name') return 'name';
  if (field.key === 'email') return 'email';
  if (field.key === 'phone') return 'tel';
  return undefined;
}

export default function DetailsForm({
  fields,
  initialValues,
  onBack,
  backLabel = 'Back',
  submitLabel = 'Continue',
  onNext,
}: Props) {
  const [values, setValues] = useState<Record<string, string>>(buildInitialValues(fields, initialValues));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const firstFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const missingRequiredField = useMemo(
    () => fields.find((field) => field.required && !values[field.key]?.trim()),
    [fields, values],
  );

  const hasInvalidEmail = useMemo(
    () =>
      fields.some((field) => {
        if (!isEmailField(field)) return false;
        const trimmed = values[field.key]?.trim() ?? '';
        return trimmed.length > 0 && !EMAIL_PATTERN.test(trimmed);
      }),
    [fields, values],
  );

  const isInvalid = Boolean(missingRequiredField) || hasInvalidEmail;

  function updateValue(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(fields.reduce<Record<string, boolean>>((acc, field) => ({ ...acc, [field.key]: true }), {}));
    if (isInvalid) return;

    const cleanedValues = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim() || undefined]),
    ) as Record<string, string | undefined>;

    onNext({
      ...cleanedValues,
      name: cleanedValues.name ?? '',
      email: cleanedValues.email ?? '',
      phone: cleanedValues.phone,
      notes: cleanedValues.notes,
    });
  }

  return (
    <form className="details-form" onSubmit={handleSubmit}>
      <div className="details-form__header">
        <p className="chime-kicker">Contact details</p>
        <h3>Where should we send the confirmation?</h3>
        <p>Name and email are required. Your phone number is optional but helpful.</p>
      </div>

      <div className="details-form__grid">
        {fields.map((field, index) => {
          const trimmedValue = values[field.key]?.trim() ?? '';
          const isRequiredEmpty = Boolean(field.required && !trimmedValue);
          const isInvalidEmailField = isEmailField(field) && trimmedValue.length > 0 && !EMAIL_PATTERN.test(trimmedValue);
          const hasError = Boolean(touched[field.key]) && (isRequiredEmpty || isInvalidEmailField);
          const errorMessage = isInvalidEmailField ? 'Enter a valid email address.' : `${field.label} is required.`;
          const errorId = `${field.key}-error`;
          const isFirstField = index === 0;

          return (
            <motion.label
              key={field.key}
              className="chime-field"
              data-error={hasError ? 'true' : 'false'}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.035 }}
            >
              <span>
                {field.label}
                {field.required && <em aria-hidden="true">*</em>}
              </span>
              {field.type === 'textarea' ? (
                <textarea
                  ref={isFirstField ? (node) => { firstFieldRef.current = node; } : undefined}
                  required={field.required}
                  aria-invalid={hasError}
                  aria-required={field.required}
                  aria-describedby={hasError ? errorId : undefined}
                  value={values[field.key] ?? ''}
                  onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateValue(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  className="chime-input chime-input--textarea"
                />
              ) : (
                <input
                  ref={isFirstField ? (node) => { firstFieldRef.current = node; } : undefined}
                  required={field.required}
                  type={field.type ?? 'text'}
                  aria-invalid={hasError}
                  aria-required={field.required}
                  aria-describedby={hasError ? errorId : undefined}
                  value={values[field.key] ?? ''}
                  onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => updateValue(field.key, event.target.value)}
                  placeholder={field.placeholder}
                  autoComplete={getAutoComplete(field)}
                  className="chime-input"
                />
              )}
              {hasError && (
                <small id={errorId} role="alert">
                  {errorMessage}
                </small>
              )}
            </motion.label>
          );
        })}
      </div>

      <div className="details-form__actions">
        {onBack && (
          <ContinueButton type="button" variant="secondary" onClick={onBack}>
            {backLabel}
          </ContinueButton>
        )}
        <ContinueButton disabled={isInvalid}>{submitLabel}</ContinueButton>
      </div>
    </form>
  );
}
