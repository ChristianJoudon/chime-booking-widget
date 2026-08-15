import { motion } from 'framer-motion';

export interface ProgressStep {
  id: string;
  label: string;
  eyebrow: string;
}

interface Props {
  steps: ProgressStep[];
  currentStep: string;
}

export default function ProgressSteps({ steps, currentStep }: Props) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === currentStep),
  );

  return (
    <nav aria-label="Booking progress" className="chime-progress" data-count={steps.length} role="list">
      {steps.map((step, index) => {
        const state = index < currentIndex ? 'complete' : index === currentIndex ? 'active' : 'upcoming';

        return (
          <div
            key={step.id}
            className="chime-progress__item"
            data-state={state}
            role="listitem"
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span className="sr-only">
              {state === 'complete' ? 'Completed ' : state === 'active' ? 'Current step ' : 'Upcoming '}
            </span>
            <motion.div
              className="chime-progress__marker"
              initial={false}
              animate={{ scale: state === 'active' ? 1.08 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20 }}
              aria-hidden="true"
            >
              {state === 'complete' ? '✓' : index + 1}
            </motion.div>
            <div className="min-w-0">
              <p className="chime-progress__eyebrow">{step.eyebrow}</p>
              <p className="chime-progress__label">{step.label}</p>
            </div>
            {index < steps.length - 1 && <span className="chime-progress__line" aria-hidden="true" />}
          </div>
        );
      })}
    </nav>
  );
}
