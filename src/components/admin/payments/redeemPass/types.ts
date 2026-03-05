export interface SectionProps {
  onClose?: () => void;
  variant?: 'modal' | 'card';
  onBookGuest?: (guestInfo: { email: string; firstName: string; lastName: string }) => void;
  onRedemptionSuccess?: (redemption: { passHolder: PassHolder; remainingUses: number; productType: string; redeemedAt: string }) => void;
}

export interface PassHolder {
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  productType: string;
  totalUses: number;
}

export interface RedemptionSuccess {
  passHolder: PassHolder;
  remainingUses: number;
  redeemedAt: string;
}

export interface DayPass {
  id: string;
  productType: string;
  quantity: number;
  remainingUses: number;
  purchaserEmail: string;
  purchaserFirstName: string | null;
  purchaserLastName: string | null;
  purchasedAt: string;
}

export interface RedemptionLog {
  redeemedAt: string;
  redeemedBy: string;
  location: string | null;
}

export interface PassDetails {
  email: string;
  name: string;
  productType: string;
  totalUses?: number;
  usedCount?: number;
  remainingUses?: number;
  lastRedemption?: string;
  redeemedTodayAt?: string;
  history?: RedemptionLog[];
}

export interface ErrorState {
  message: string;
  errorCode: string;
  passDetails?: PassDetails;
}

export interface UnredeemedPass {
  id: string;
  productType: string;
  quantity: number;
  remainingUses: number;
  purchaserEmail: string;
  purchaserFirstName: string | null;
  purchaserLastName: string | null;
  purchasedAt: string;
}

export interface DayPassUpdateEvent {
  type: 'day_pass_update';
  action: 'day_pass_purchased' | 'day_pass_redeemed' | 'day_pass_refunded';
  passId: string;
  purchaserEmail?: string;
  purchaserName?: string;
  productType?: string;
  remainingUses?: number;
  quantity?: number;
  purchasedAt?: string;
}

export const formatPassType = (productType: string): string => {
  return productType
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace('Day Pass', 'Day Pass -');
};
