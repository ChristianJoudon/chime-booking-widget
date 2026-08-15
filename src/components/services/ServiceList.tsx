import { motion } from 'framer-motion';

import type { Service } from '@/types/service';
import {
  formatMoneyFromCents,
  getAppointmentDepositAmountCents,
  getServiceDurationLabel,
} from '@/lib/normalizers';

export interface ServiceListProps {
  services: Service[];
  selectedId?: string;
  currency?: string;
  onSelect: (service: Service) => void;
}

function getServiceInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export default function ServiceList({ services, selectedId, currency, onSelect }: ServiceListProps) {
  if (services.length === 0) {
    return (
      <div className="chime-empty-state">
        <p className="chime-empty-state__title">No services are configured yet.</p>
        <p className="chime-empty-state__copy">
          Add services through the widget config or connect the services API endpoint.
        </p>
      </div>
    );
  }

  return (
    <div className="service-grid" aria-label="Available services">
      {services.map((service, index) => {
        const depositAmount = getAppointmentDepositAmountCents(service);
        const durationLabel = getServiceDurationLabel(service);
        const isSelected = service.id === selectedId;

        return (
          <motion.button
            key={service.id}
            type="button"
            className="service-card"
            data-selected={isSelected ? 'true' : 'false'}
            onClick={() => onSelect(service)}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.045, type: 'spring', stiffness: 260, damping: 24 }}
            whileHover={{ y: -7, scale: 1.012 }}
            whileTap={{ scale: 0.985 }}
            aria-pressed={isSelected}
          >
            <span className="service-card__shine" aria-hidden="true" />
            <div className="service-card__topline">
              <div className="service-card__icon" aria-hidden="true">
                {getServiceInitials(service.name)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="service-card__name">{service.name}</h3>
                <div className="service-card__meta">
                  {durationLabel && <span>{durationLabel}</span>}
                  {depositAmount > 0 && (
                    <>
                      <span aria-hidden="true">•</span>
                      <span>Refundable deposit</span>
                    </>
                  )}
                </div>
              </div>
              <span className="service-card__check" aria-hidden="true">
                {isSelected ? '✓' : '→'}
              </span>
            </div>

            {service.description && <p className="service-card__description">{service.description}</p>}

            <div className="service-card__footer">
              <span className="service-card__pill">
                {depositAmount > 0 ? `Deposit ${formatMoneyFromCents(depositAmount, currency)}` : 'No deposit required'}
              </span>
              <span className="service-card__select-text">
                {isSelected ? 'Selected' : 'Tap to choose'}
              </span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}
