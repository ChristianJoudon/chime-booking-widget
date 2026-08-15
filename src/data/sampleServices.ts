import type { Service } from '../types/service';

export const sampleServices: Service[] = [
  {
    id: 'consultation',
    name: 'Consultation',
    description: 'A quick consultation to review your needs and next steps.',
    durationMinutes: 30,
    depositAmountCents: 2000,
  },
  {
    id: 'repair',
    name: 'Repair Session',
    description: 'Hands-on troubleshooting and repair support.',
    durationMinutes: 60,
    depositAmountCents: 2000,
  },
  {
    id: 'installation',
    name: 'Installation',
    description: 'Setup and installation for your hardware or software.',
    durationMinutes: 90,
    depositAmountCents: 2000,
  },
];
