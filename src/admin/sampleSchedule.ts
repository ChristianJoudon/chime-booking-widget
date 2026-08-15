import type {
  AppointmentStatus,
  StaffId,
} from '../../packages/contracts/src';

export type AppointmentTone = 'mint' | 'sky' | 'peach' | 'lemon';

export interface ScheduleDay {
  dayIndex: number;
  shortName: string;
  fullName: string;
  date: number;
  month: string;
  isToday?: boolean;
}

export interface ScheduleStaffMember {
  id: StaffId;
  name: string;
  shortName: string;
  initials: string;
  color: string;
}

export interface PendingOrigin {
  dayIndex: number;
  startMinutes: number;
  durationMinutes: number;
  staffId: StaffId;
}

export interface ScheduleAppointment {
  id: string;
  customer: string;
  customerEmail: string;
  customerPhone?: string;
  service: string;
  dayIndex: number;
  startMinutes: number;
  durationMinutes: number;
  staffId: StaffId;
  location: string;
  tone: AppointmentTone;
  status: AppointmentStatus;
  source: 'widget' | 'admin' | 'customer_portal';
  notes?: string;
  changeRequestedBy?: 'admin' | 'customer';
  pendingOrigin?: PendingOrigin;
}

export const SCHEDULE_DAYS: readonly ScheduleDay[] = [
  { dayIndex: 0, shortName: 'Mon', fullName: 'Monday', date: 10, month: 'Aug' },
  { dayIndex: 1, shortName: 'Tue', fullName: 'Tuesday', date: 11, month: 'Aug' },
  { dayIndex: 2, shortName: 'Wed', fullName: 'Wednesday', date: 12, month: 'Aug' },
  { dayIndex: 3, shortName: 'Thu', fullName: 'Thursday', date: 13, month: 'Aug' },
  { dayIndex: 4, shortName: 'Fri', fullName: 'Friday', date: 14, month: 'Aug', isToday: true },
];

export const SCHEDULE_STAFF: readonly ScheduleStaffMember[] = [
  {
    id: 'staff-mara',
    name: 'Mara Kealoha',
    shortName: 'Mara',
    initials: 'MK',
    color: '#3d9b7c',
  },
  {
    id: 'staff-noah',
    name: 'Noah Reyes',
    shortName: 'Noah',
    initials: 'NR',
    color: '#5689b9',
  },
  {
    id: 'staff-lei',
    name: 'Lei Nakamura',
    shortName: 'Lei',
    initials: 'LN',
    color: '#d47e61',
  },
];

export const INITIAL_APPOINTMENTS: readonly ScheduleAppointment[] = [
  {
    id: 'apt-101',
    customer: 'Elena Cruz',
    customerEmail: 'elena@example.com',
    customerPhone: '(808) 555-0182',
    service: 'First-time consultation',
    dayIndex: 0,
    startMinutes: 8 * 60 + 30,
    durationMinutes: 60,
    staffId: 'staff-mara',
    location: 'Studio A',
    tone: 'mint',
    status: 'confirmed',
    source: 'widget',
    notes: 'Interested in a recurring monthly appointment.',
  },
  {
    id: 'apt-102',
    customer: 'Kai Thompson',
    customerEmail: 'kai@example.com',
    service: 'Follow-up session',
    dayIndex: 0,
    startMinutes: 10 * 60 + 15,
    durationMinutes: 45,
    staffId: 'staff-noah',
    location: 'Studio B',
    tone: 'sky',
    status: 'confirmed',
    source: 'widget',
  },
  {
    id: 'apt-103',
    customer: 'Malia Stone',
    customerEmail: 'malia@example.com',
    service: 'Extended service',
    dayIndex: 0,
    startMinutes: 13 * 60,
    durationMinutes: 90,
    staffId: 'staff-lei',
    location: 'Studio A',
    tone: 'peach',
    status: 'confirmed',
    source: 'admin',
  },
  {
    id: 'apt-104',
    customer: 'Nico Bennett',
    customerEmail: 'nico@example.com',
    service: 'First-time consultation',
    dayIndex: 1,
    startMinutes: 9 * 60,
    durationMinutes: 60,
    staffId: 'staff-noah',
    location: 'Studio B',
    tone: 'sky',
    status: 'confirmed',
    source: 'widget',
  },
  {
    id: 'apt-105',
    customer: 'Amara Lewis',
    customerEmail: 'amara@example.com',
    customerPhone: '(808) 555-0147',
    service: 'Follow-up session',
    dayIndex: 1,
    startMinutes: 11 * 60 + 30,
    durationMinutes: 60,
    staffId: 'staff-mara',
    location: 'Studio A',
    tone: 'mint',
    status: 'pending_approval',
    source: 'customer_portal',
    notes: 'Requested Mara specifically.',
  },
  {
    id: 'apt-106',
    customer: 'Jon Bell',
    customerEmail: 'jon@example.com',
    service: 'Quick check-in',
    dayIndex: 1,
    startMinutes: 15 * 60,
    durationMinutes: 30,
    staffId: 'staff-lei',
    location: 'Studio A',
    tone: 'lemon',
    status: 'confirmed',
    source: 'admin',
  },
  {
    id: 'apt-107',
    customer: 'Avery Kim',
    customerEmail: 'avery@example.com',
    service: 'Extended service',
    dayIndex: 2,
    startMinutes: 8 * 60 + 45,
    durationMinutes: 90,
    staffId: 'staff-lei',
    location: 'Studio A',
    tone: 'peach',
    status: 'confirmed',
    source: 'widget',
  },
  {
    id: 'apt-108',
    customer: 'Jordan Silva',
    customerEmail: 'jordan@example.com',
    customerPhone: '(808) 555-0120',
    service: 'Follow-up session',
    dayIndex: 2,
    startMinutes: 13 * 60 + 30,
    durationMinutes: 60,
    staffId: 'staff-mara',
    location: 'Studio A',
    tone: 'mint',
    status: 'change_pending',
    source: 'customer_portal',
    changeRequestedBy: 'customer',
    pendingOrigin: {
      dayIndex: 2,
      startMinutes: 15 * 60,
      durationMinutes: 60,
      staffId: 'staff-mara',
    },
    notes: 'Customer asked to move earlier for school pickup.',
  },
  {
    id: 'apt-109',
    customer: 'Tessa Wong',
    customerEmail: 'tessa@example.com',
    service: 'First-time consultation',
    dayIndex: 3,
    startMinutes: 9 * 60 + 30,
    durationMinutes: 60,
    staffId: 'staff-noah',
    location: 'Studio B',
    tone: 'sky',
    status: 'confirmed',
    source: 'widget',
  },
  {
    id: 'apt-110',
    customer: 'Owen Park',
    customerEmail: 'owen@example.com',
    service: 'Quick check-in',
    dayIndex: 3,
    startMinutes: 12 * 60,
    durationMinutes: 45,
    staffId: 'staff-mara',
    location: 'Studio A',
    tone: 'lemon',
    status: 'change_pending',
    source: 'admin',
    changeRequestedBy: 'admin',
    pendingOrigin: {
      dayIndex: 3,
      startMinutes: 10 * 60 + 30,
      durationMinutes: 45,
      staffId: 'staff-mara',
    },
    notes: 'Waiting for Owen to approve the later start.',
  },
  {
    id: 'apt-111',
    customer: 'Sofia Martin',
    customerEmail: 'sofia@example.com',
    service: 'Extended service',
    dayIndex: 3,
    startMinutes: 14 * 60 + 30,
    durationMinutes: 90,
    staffId: 'staff-lei',
    location: 'Studio A',
    tone: 'peach',
    status: 'confirmed',
    source: 'widget',
  },
  {
    id: 'apt-112',
    customer: 'Mika Torres',
    customerEmail: 'mika@example.com',
    service: 'Follow-up session',
    dayIndex: 4,
    startMinutes: 8 * 60 + 30,
    durationMinutes: 60,
    staffId: 'staff-mara',
    location: 'Studio A',
    tone: 'mint',
    status: 'confirmed',
    source: 'widget',
  },
  {
    id: 'apt-113',
    customer: 'Ravi Patel',
    customerEmail: 'ravi@example.com',
    service: 'First-time consultation',
    dayIndex: 4,
    startMinutes: 10 * 60 + 30,
    durationMinutes: 60,
    staffId: 'staff-noah',
    location: 'Studio B',
    tone: 'sky',
    status: 'confirmed',
    source: 'widget',
  },
  {
    id: 'apt-114',
    customer: 'Lena Brooks',
    customerEmail: 'lena@example.com',
    service: 'Quick check-in',
    dayIndex: 4,
    startMinutes: 13 * 60,
    durationMinutes: 30,
    staffId: 'staff-lei',
    location: 'Studio A',
    tone: 'lemon',
    status: 'held',
    source: 'admin',
  },
  {
    id: 'apt-115',
    customer: 'Theo Grant',
    customerEmail: 'theo@example.com',
    service: 'Extended service',
    dayIndex: 4,
    startMinutes: 14 * 60 + 15,
    durationMinutes: 90,
    staffId: 'staff-mara',
    location: 'Studio A',
    tone: 'mint',
    status: 'confirmed',
    source: 'widget',
  },
];
