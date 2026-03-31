// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { emailLayout, CLUB_COLORS, formatCurrency, formatDate } from '../server/emails/emailLayout';
import { getBookingConfirmationHtml } from '../server/emails/bookingEmails';
import { getPaymentReceiptHtml, getPaymentFailedHtml, getOutstandingBalanceHtml, getFeeWaivedHtml, getPurchaseReceiptHtml } from '../server/emails/paymentEmails';
import { getOtpEmailHtml, getOtpEmailText } from '../server/emails/otpEmail';
import { getWelcomeEmailHtml } from '../server/emails/welcomeEmail';
import { getTrialWelcomeHtml } from '../server/emails/trialWelcomeEmail';
import { getMembershipRenewalHtml, getMembershipFailedHtml, getCardExpiringHtml, getGracePeriodReminderHtml, getMembershipActivationHtml } from '../server/emails/membershipEmails';
import { getMembershipInviteHtml, getWinBackHtml, getAccountDeletionHtml } from '../server/emails/memberInviteEmail';
import { getNudge24hHtml, getNudge72hHtml, getNudge7dHtml } from '../server/emails/onboardingNudgeEmails';
import { getFirstVisitHtml } from '../server/emails/firstVisitEmail';
import { getIntegrityAlertEmailHtml } from '../server/emails/integrityAlertEmail';
import { getPassWithQrHtml, getRedemptionConfirmationHtml } from '../server/emails/passEmails';
import { getTourConfirmationHtml } from '../server/emails/tourEmails';

describe('emailLayout', () => {
  it('wraps content in a valid HTML document', () => {
    const html = emailLayout('<tr><td>Test</td></tr>');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
    expect(html).toContain('</html>');
    expect(html).toContain('Test');
  });

  it('includes the Ever Club logo', () => {
    const html = emailLayout('<tr><td>Body</td></tr>');
    expect(html).toContain('everclub-logo-dark.png');
    expect(html).toContain('alt="Ever Club"');
  });

  it('includes footer with contact info and link', () => {
    const html = emailLayout('<tr><td>Body</td></tr>');
    expect(html).toContain('Reply to this email');
    expect(html).toContain('everclub.app');
  });

  it('uses consistent background color from CLUB_COLORS', () => {
    const html = emailLayout('<tr><td>Body</td></tr>');
    expect(html).toContain(CLUB_COLORS.bone);
  });

  it('sets max-width for responsive layout', () => {
    const html = emailLayout('<tr><td>Body</td></tr>');
    expect(html).toContain('max-width: 600px');
  });
});

describe('formatCurrency', () => {
  it('formats whole dollar amounts', () => {
    expect(formatCurrency(100)).toBe('$100.00');
  });

  it('formats amounts with cents', () => {
    expect(formatCurrency(49.99)).toBe('$49.99');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats large amounts with commas', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });
});

describe('formatDate', () => {
  it('formats a date with weekday, month, day, and year', () => {
    const date = new Date('2025-06-15T12:00:00Z');
    const result = formatDate(date);
    expect(result).toContain('June');
    expect(result).toContain('15');
    expect(result).toContain('2025');
  });
});

describe('Booking Emails', () => {
  const baseData = {
    date: '2025-06-15',
    time: '14:00',
    bayName: 'Bay 3',
    memberName: 'John Doe',
  };

  it('renders booking confirmation with member name', () => {
    const html = getBookingConfirmationHtml(baseData);
    expect(html).toContain('John Doe');
    expect(html).toContain('Booking Confirmed');
  });

  it('includes bay name in booking details', () => {
    const html = getBookingConfirmationHtml(baseData);
    expect(html).toContain('Bay 3');
  });

  it('formats the date correctly', () => {
    const html = getBookingConfirmationHtml(baseData);
    expect(html).toContain('June');
    expect(html).toContain('2025');
  });

  it('formats time as 12-hour format', () => {
    const html = getBookingConfirmationHtml(baseData);
    expect(html).toMatch(/2:00\s*PM/i);
  });

  it('includes View My Bookings link', () => {
    const html = getBookingConfirmationHtml(baseData);
    expect(html).toContain('View My Bookings');
    expect(html).toContain('everclub.app/bookings');
  });

  it('includes default address when not provided', () => {
    const html = getBookingConfirmationHtml(baseData);
    expect(html).toContain('15771 Red Hill Ave, Ste 500');
    expect(html).toContain('Tustin, CA 92780');
  });

  it('uses custom address when provided', () => {
    const html = getBookingConfirmationHtml({
      ...baseData,
      addressLine1: '123 Custom St',
      cityStateZip: 'Irvine, CA 92602',
    });
    expect(html).toContain('123 Custom St');
    expect(html).toContain('Irvine, CA 92602');
  });

  it('shows Apple Wallet button when walletPassEnabled and bookingId set', () => {
    const html = getBookingConfirmationHtml({
      ...baseData,
      bookingId: 42,
      walletPassEnabled: true,
    });
    expect(html).toContain('Add to Apple Wallet');
    expect(html).toContain('/api/member/booking-wallet-pass/42');
  });

  it('hides Apple Wallet button when walletPassEnabled is false', () => {
    const html = getBookingConfirmationHtml({
      ...baseData,
      bookingId: 42,
      walletPassEnabled: false,
    });
    expect(html).not.toContain('Add to Apple Wallet');
  });

  it('wraps content in email layout', () => {
    const html = getBookingConfirmationHtml(baseData);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('everclub-logo-dark.png');
  });

  it('handles special characters in member name', () => {
    const html = getBookingConfirmationHtml({
      ...baseData,
      memberName: "O'Brien & Sons <test>",
    });
    expect(html).toContain("O'Brien & Sons <test>");
  });
});

describe('Payment Emails', () => {
  describe('getPaymentReceiptHtml', () => {
    const params = {
      memberName: 'Jane Smith',
      amount: 250,
      description: 'Monthly Membership',
      date: new Date('2025-03-15T12:00:00Z'),
    };

    it('renders payment receipt with member name', () => {
      const html = getPaymentReceiptHtml(params);
      expect(html).toContain('Jane Smith');
      expect(html).toContain('Payment Received');
    });

    it('includes formatted amount', () => {
      const html = getPaymentReceiptHtml(params);
      expect(html).toContain('$250.00');
    });

    it('includes description', () => {
      const html = getPaymentReceiptHtml(params);
      expect(html).toContain('Monthly Membership');
    });

    it('includes date', () => {
      const html = getPaymentReceiptHtml(params);
      expect(html).toContain('March');
    });

    it('includes transaction ID when provided', () => {
      const html = getPaymentReceiptHtml({ ...params, transactionId: 'txn_abc123' });
      expect(html).toContain('txn_abc123');
      expect(html).toContain('Transaction ID');
    });

    it('omits transaction ID when not provided', () => {
      const html = getPaymentReceiptHtml(params);
      expect(html).not.toContain('Transaction ID');
    });

    it('includes View Payment History link', () => {
      const html = getPaymentReceiptHtml(params);
      expect(html).toContain('View Payment History');
      expect(html).toContain('everclub.app/history');
    });
  });

  describe('getPaymentFailedHtml', () => {
    const params = {
      memberName: 'Bob Wilson',
      amount: 150,
      reason: 'Card declined',
    };

    it('renders payment failed with member info', () => {
      const html = getPaymentFailedHtml(params);
      expect(html).toContain('Bob Wilson');
      expect(html).toContain('Payment Issue');
    });

    it('includes amount and reason', () => {
      const html = getPaymentFailedHtml(params);
      expect(html).toContain('$150.00');
      expect(html).toContain('Card declined');
    });

    it('uses default profile URL when updateCardUrl not provided', () => {
      const html = getPaymentFailedHtml(params);
      expect(html).toContain('everclub.app/profile');
    });

    it('uses custom updateCardUrl when provided', () => {
      const html = getPaymentFailedHtml({ ...params, updateCardUrl: 'https://custom.url/pay' });
      expect(html).toContain('https://custom.url/pay');
    });

    it('includes Update Payment Method CTA', () => {
      const html = getPaymentFailedHtml(params);
      expect(html).toContain('Update Payment Method');
    });
  });

  describe('getOutstandingBalanceHtml', () => {
    const params = {
      memberName: 'Alice Green',
      amount: 75,
      description: 'Guest fee',
    };

    it('renders outstanding balance with member info', () => {
      const html = getOutstandingBalanceHtml(params);
      expect(html).toContain('Alice Green');
      expect(html).toContain('Outstanding Balance');
    });

    it('includes amount and description', () => {
      const html = getOutstandingBalanceHtml(params);
      expect(html).toContain('$75.00');
      expect(html).toContain('Guest fee');
    });

    it('includes due date when provided', () => {
      const html = getOutstandingBalanceHtml({ ...params, dueDate: 'June 30, 2025' });
      expect(html).toContain('June 30, 2025');
    });

    it('omits due date section when not provided', () => {
      const html = getOutstandingBalanceHtml(params);
      expect(html).not.toContain('Due Date');
    });
  });

  describe('getFeeWaivedHtml', () => {
    const params = {
      memberName: 'Charlie Brown',
      originalAmount: 50,
      reason: 'Courtesy waiver',
    };

    it('renders fee waived with member info', () => {
      const html = getFeeWaivedHtml(params);
      expect(html).toContain('Charlie Brown');
      expect(html).toContain('Fee Waived');
    });

    it('includes original amount and reason', () => {
      const html = getFeeWaivedHtml(params);
      expect(html).toContain('$50.00');
      expect(html).toContain('Courtesy waiver');
    });

    it('includes booking description when provided', () => {
      const html = getFeeWaivedHtml({ ...params, bookingDescription: 'Bay 2 on June 15' });
      expect(html).toContain('Bay 2 on June 15');
      expect(html).toContain('Related Booking');
    });

    it('omits booking description when not provided', () => {
      const html = getFeeWaivedHtml(params);
      expect(html).not.toContain('Related Booking');
    });
  });

  describe('getPurchaseReceiptHtml', () => {
    const params = {
      memberName: 'Dave Miller',
      items: [
        { name: 'Coffee', quantity: 2, unitPrice: 500, total: 1000 },
        { name: 'Sandwich', quantity: 1, unitPrice: 1200, total: 1200 },
      ],
      totalAmount: 2200,
      paymentMethod: 'card',
      date: new Date('2025-04-01T12:00:00Z'),
    };

    it('renders purchase receipt with member name', () => {
      const html = getPurchaseReceiptHtml(params);
      expect(html).toContain('Dave Miller');
      expect(html).toContain('Purchase Receipt');
    });

    it('lists line items', () => {
      const html = getPurchaseReceiptHtml(params);
      expect(html).toContain('Coffee');
      expect(html).toContain('x2');
      expect(html).toContain('Sandwich');
    });

    it('formats total amount (cents to dollars)', () => {
      const html = getPurchaseReceiptHtml(params);
      expect(html).toContain('$22.00');
    });

    it('maps card payment method to Credit Card label', () => {
      const html = getPurchaseReceiptHtml(params);
      expect(html).toContain('Credit Card');
    });

    it('maps terminal payment method to Card Reader label', () => {
      const html = getPurchaseReceiptHtml({ ...params, paymentMethod: 'terminal' });
      expect(html).toContain('Card Reader');
    });

    it('includes transaction ID when provided', () => {
      const html = getPurchaseReceiptHtml({ ...params, paymentIntentId: 'pi_xyz' });
      expect(html).toContain('pi_xyz');
    });
  });
});

describe('OTP Email', () => {
  const params = { firstName: 'Emily', code: '483291', logoUrl: 'https://example.com/logo.png' };

  it('renders HTML with the OTP code', () => {
    const html = getOtpEmailHtml(params);
    expect(html).toContain('483291');
  });

  it('includes the member first name', () => {
    const html = getOtpEmailHtml(params);
    expect(html).toContain('Hi Emily');
  });

  it('includes the logo', () => {
    const html = getOtpEmailHtml(params);
    expect(html).toContain('https://example.com/logo.png');
  });

  it('mentions expiry time', () => {
    const html = getOtpEmailHtml(params);
    expect(html).toContain('15 minutes');
  });

  it('includes sign-in instructions', () => {
    const html = getOtpEmailHtml(params);
    expect(html).toContain('Enter this code');
  });

  it('produces valid HTML document', () => {
    const html = getOtpEmailHtml(params);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('generates plain text version with code', () => {
    const text = getOtpEmailText({ firstName: 'Emily', code: '483291' });
    expect(text).toContain('483291');
    expect(text).toContain('Emily');
    expect(text).toContain('15 minutes');
  });

  it('handles special characters in first name', () => {
    const html = getOtpEmailHtml({ ...params, firstName: "O'Malley" });
    expect(html).toContain("O'Malley");
  });
});

describe('Welcome Email', () => {
  it('renders with first name', () => {
    const html = getWelcomeEmailHtml('Sarah');
    expect(html).toContain('Welcome, Sarah!');
  });

  it('renders without first name', () => {
    const html = getWelcomeEmailHtml();
    expect(html).toContain('Welcome to Ever Club!');
  });

  it('renders with undefined first name', () => {
    const html = getWelcomeEmailHtml(undefined);
    expect(html).toContain('Welcome to Ever Club!');
  });

  it('includes feature sections', () => {
    const html = getWelcomeEmailHtml('Sarah');
    expect(html).toContain('Book Golf Simulators');
    expect(html).toContain('Explore Wellness');
    expect(html).toContain('Join Events');
  });

  it('includes action links', () => {
    const html = getWelcomeEmailHtml('Sarah');
    expect(html).toContain('everclub.app/book-golf');
    expect(html).toContain('everclub.app/wellness');
    expect(html).toContain('everclub.app/events');
  });

  it('includes Open Ever Club App CTA', () => {
    const html = getWelcomeEmailHtml('Sarah');
    expect(html).toContain('Open Ever Club App');
  });

  it('wraps in email layout', () => {
    const html = getWelcomeEmailHtml('Sarah');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('everclub-logo-dark.png');
  });
});

describe('Trial Welcome Email', () => {
  const params = {
    firstName: 'Tom',
    userId: 42,
    trialEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    couponCode: 'TRIAL50',
  };

  it('renders with first name', async () => {
    const html = await getTrialWelcomeHtml(params);
    expect(html).toContain('Welcome, Tom!');
  });

  it('renders without first name', async () => {
    const html = await getTrialWelcomeHtml({ ...params, firstName: undefined });
    expect(html).toContain('Welcome to Ever Club!');
  });

  it('includes trial duration info', async () => {
    const html = await getTrialWelcomeHtml(params);
    expect(html).toMatch(/\d+ day/);
  });

  it('includes QR code for member check-in', async () => {
    const html = await getTrialWelcomeHtml(params);
    expect(html).toContain('data:image/png');
    expect(html).toContain('Member QR Code');
  });

  it('includes coupon code', async () => {
    const html = await getTrialWelcomeHtml(params);
    expect(html).toContain('TRIAL50');
  });

  it('includes feature sections', async () => {
    const html = await getTrialWelcomeHtml(params);
    expect(html).toContain('Book Golf Simulators');
    expect(html).toContain('Explore Wellness');
    expect(html).toContain('Join Events');
  });

  it('wraps in email layout', async () => {
    const html = await getTrialWelcomeHtml(params);
    expect(html).toContain('<!DOCTYPE html>');
  });
});

describe('Membership Emails', () => {
  describe('getMembershipRenewalHtml', () => {
    const params = {
      memberName: 'Lisa Park',
      amount: 299,
      planName: 'Gold Membership',
      nextBillingDate: new Date('2025-07-01T12:00:00Z'),
    };

    it('renders renewal with member name', () => {
      const html = getMembershipRenewalHtml(params);
      expect(html).toContain('Lisa Park');
      expect(html).toContain('Membership Renewed');
    });

    it('includes amount, plan name, and next billing date', () => {
      const html = getMembershipRenewalHtml(params);
      expect(html).toContain('$299.00');
      expect(html).toContain('Gold Membership');
      expect(html).toContain('July');
    });
  });

  describe('getMembershipFailedHtml', () => {
    const params = {
      memberName: 'Mike Ross',
      amount: 199,
      planName: 'Silver Plan',
      reason: 'Insufficient funds',
    };

    it('renders membership failed with details', () => {
      const html = getMembershipFailedHtml(params);
      expect(html).toContain('Mike Ross');
      expect(html).toContain('Membership Payment Failed');
      expect(html).toContain('$199.00');
      expect(html).toContain('Silver Plan');
      expect(html).toContain('Insufficient funds');
    });

    it('includes Update Payment Method CTA', () => {
      const html = getMembershipFailedHtml(params);
      expect(html).toContain('Update Payment Method');
      expect(html).toContain('everclub.app/profile');
    });
  });

  describe('getCardExpiringHtml', () => {
    const params = {
      memberName: 'Anna Lee',
      cardLast4: '4242',
      expiryMonth: 3,
      expiryYear: 2026,
    };

    it('renders card expiring with details', () => {
      const html = getCardExpiringHtml(params);
      expect(html).toContain('Anna Lee');
      expect(html).toContain('Card Expiring Soon');
      expect(html).toContain('4242');
      expect(html).toContain('03/2026');
    });

    it('pads single-digit months', () => {
      const html = getCardExpiringHtml({ ...params, expiryMonth: 1 });
      expect(html).toContain('01/2026');
    });
  });

  describe('getGracePeriodReminderHtml', () => {
    const baseParams = {
      memberName: 'Chris Hall',
      currentDay: 3,
      totalDays: 7,
      reactivationLink: 'https://everclub.app/reactivate',
    };

    it('renders non-urgent grace period reminder', () => {
      const html = getGracePeriodReminderHtml(baseParams);
      expect(html).toContain('Chris Hall');
      expect(html).toContain('Day 3 of 7');
      expect(html).toContain('Action Required: Payment Failed');
      expect(html).toContain('Update Payment Method');
    });

    it('renders urgent final notice when currentDay >= totalDays', () => {
      const html = getGracePeriodReminderHtml({ ...baseParams, currentDay: 7, totalDays: 7 });
      expect(html).toContain('Final Notice: Membership At Risk');
      expect(html).toContain('Reactivate Now');
      expect(html).toContain('Day 7 of 7');
    });

    it('uses red styling for urgent state', () => {
      const html = getGracePeriodReminderHtml({ ...baseParams, currentDay: 7, totalDays: 7 });
      expect(html).toContain('#dc2626');
    });

    it('includes the reactivation link', () => {
      const html = getGracePeriodReminderHtml(baseParams);
      expect(html).toContain('https://everclub.app/reactivate');
    });
  });

  describe('getMembershipActivationHtml', () => {
    const params = {
      memberName: 'Dana White',
      tierName: 'Platinum',
      monthlyPrice: 499,
      checkoutUrl: 'https://everclub.app/checkout/abc',
      expiresAt: new Date('2025-12-31T23:59:59Z'),
    };

    it('renders activation email with details', () => {
      const html = getMembershipActivationHtml(params);
      expect(html).toContain('Dana White');
      expect(html).toContain('Platinum');
      expect(html).toContain('$499.00/mo');
    });

    it('includes checkout URL', () => {
      const html = getMembershipActivationHtml(params);
      expect(html).toContain('https://everclub.app/checkout/abc');
      expect(html).toContain('Complete Membership Setup');
    });

    it('includes expiration date', () => {
      const html = getMembershipActivationHtml(params);
      expect(html).toContain('December');
    });
  });
});

describe('Member Invite Emails', () => {
  describe('getMembershipInviteHtml', () => {
    const params = {
      firstName: 'Kevin',
      tierName: 'Gold',
      priceFormatted: '$299/mo',
      checkoutUrl: 'https://everclub.app/join/xyz',
    };

    it('renders invite with name and tier', () => {
      const html = getMembershipInviteHtml(params);
      expect(html).toContain('Welcome to Ever Club, Kevin!');
      expect(html).toContain('Gold');
      expect(html).toContain('$299/mo');
    });

    it('includes checkout URL', () => {
      const html = getMembershipInviteHtml(params);
      expect(html).toContain('https://everclub.app/join/xyz');
      expect(html).toContain('Complete Membership');
    });

    it('mentions 24-hour expiry', () => {
      const html = getMembershipInviteHtml(params);
      expect(html).toContain('24 hours');
    });
  });

  describe('getWinBackHtml', () => {
    const params = {
      firstName: 'Rachel',
      reactivationLink: 'https://everclub.app/rejoin/abc',
    };

    it('renders win-back with name', () => {
      const html = getWinBackHtml(params);
      expect(html).toContain('We Miss You, Rachel!');
    });

    it('includes reactivation link', () => {
      const html = getWinBackHtml(params);
      expect(html).toContain('https://everclub.app/rejoin/abc');
      expect(html).toContain('Rejoin Ever Club');
    });
  });

  describe('getAccountDeletionHtml', () => {
    it('renders deletion confirmation with name', () => {
      const html = getAccountDeletionHtml({ firstName: 'Mark' });
      expect(html).toContain('Hello Mark');
      expect(html).toContain('delete your Ever Club account');
      expect(html).toContain('7 business days');
    });

    it('includes contact email', () => {
      const html = getAccountDeletionHtml({ firstName: 'Mark' });
      expect(html).toContain('info@everclub.app');
    });
  });
});

describe('Onboarding Nudge Emails', () => {
  describe('getNudge24hHtml', () => {
    it('renders with first name', () => {
      const html = getNudge24hHtml('Sam');
      expect(html).toContain('Hi Sam,');
      expect(html).toContain('Your membership is waiting');
    });

    it('renders without first name', () => {
      const html = getNudge24hHtml();
      expect(html).toContain('Hi there,');
    });

    it('includes sign-in CTA', () => {
      const html = getNudge24hHtml('Sam');
      expect(html).toContain('Sign In & Book a Session');
      expect(html).toContain('everclub.app/login');
    });
  });

  describe('getNudge72hHtml', () => {
    it('renders with first name and tips', () => {
      const html = getNudge72hHtml('Sam');
      expect(html).toContain('Hi Sam,');
      expect(html).toContain('3 things to try');
      expect(html).toContain('Book a Golf Simulator');
      expect(html).toContain('Check Upcoming Club Events');
      expect(html).toContain('Explore Wellness Services');
    });

    it('renders without first name', () => {
      const html = getNudge72hHtml();
      expect(html).toContain('Hi there,');
    });
  });

  describe('getNudge7dHtml', () => {
    it('renders with first name', () => {
      const html = getNudge7dHtml('Sam');
      expect(html).toContain('Hi Sam,');
      expect(html).toContain('Need help getting started?');
    });

    it('renders without first name', () => {
      const html = getNudge7dHtml();
      expect(html).toContain('Hi there,');
    });

    it('includes contact CTA', () => {
      const html = getNudge7dHtml('Sam');
      expect(html).toContain('Contact Us');
      expect(html).toContain('hello@everclub.app');
    });

    it('mentions tour and session help', () => {
      const html = getNudge7dHtml('Sam');
      expect(html).toContain('personal tour');
      expect(html).toContain('first simulator session');
    });
  });
});

describe('First Visit Email', () => {
  it('renders with first name', () => {
    const html = getFirstVisitHtml({ firstName: 'Alex' });
    expect(html).toContain('Welcome, Alex!');
  });

  it('renders without first name', () => {
    const html = getFirstVisitHtml({});
    expect(html).toContain('Welcome to Ever Club!');
  });

  it('includes checked-in message', () => {
    const html = getFirstVisitHtml({ firstName: 'Alex' });
    expect(html).toContain('checked in');
  });

  it('includes feature sections', () => {
    const html = getFirstVisitHtml({ firstName: 'Alex' });
    expect(html).toContain('Book Golf Simulators');
    expect(html).toContain('Browse Events');
    expect(html).toContain('Explore Wellness');
  });

  it('includes Open Ever Club App CTA', () => {
    const html = getFirstVisitHtml({ firstName: 'Alex' });
    expect(html).toContain('Open Ever Club App');
  });
});

describe('Integrity Alert Email', () => {
  const mockResults = [
    {
      checkName: 'Orphan Bookings',
      status: 'fail' as const,
      issueCount: 2,
      issues: [
        {
          category: 'orphan_record' as const,
          severity: 'error' as const,
          table: 'bookings',
          recordId: 101,
          description: 'Booking has no associated member',
          suggestion: 'Delete or reassign this booking',
          context: { memberName: 'John Doe', bookingDate: '2025-06-15' },
        },
        {
          category: 'orphan_record' as const,
          severity: 'warning' as const,
          table: 'bookings',
          recordId: 102,
          description: 'Booking missing session link',
          context: { resourceName: 'Bay 3' },
        },
      ],
      lastRun: new Date(),
    },
    {
      checkName: 'Sync Mismatches',
      status: 'warning' as const,
      issueCount: 1,
      issues: [
        {
          category: 'sync_mismatch' as const,
          severity: 'warning' as const,
          table: 'members',
          recordId: 201,
          description: 'HubSpot contact out of sync',
        },
      ],
      lastRun: new Date(),
    },
  ];

  const criticalIssues = mockResults.flatMap(r => r.issues).filter(i => i.severity === 'error' || i.severity === 'warning');

  it('renders alert with issue counts', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('Data Integrity Alert');
    expect(html).toContain('Critical Issue');
  });

  it('displays error and warning counts', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('Errors');
    expect(html).toContain('Warnings');
  });

  it('lists failed check names', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('Orphan Bookings');
    expect(html).toContain('Failed Checks');
  });

  it('lists warning check names', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('Sync Mismatches');
    expect(html).toContain('Warning Checks');
  });

  it('renders issue details with table and record ID', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('bookings');
    expect(html).toContain('#101');
    expect(html).toContain('Booking has no associated member');
  });

  it('renders issue suggestions', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('Delete or reassign this booking');
  });

  it('renders issue context', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('Member: John Doe');
    expect(html).toContain('Date: 2025-06-15');
  });

  it('includes admin panel link', () => {
    const html = getIntegrityAlertEmailHtml(mockResults, criticalIssues);
    expect(html).toContain('View in Admin Panel');
    expect(html).toContain('everclub.app/admin/data-integrity');
  });

  it('shows truncation note when more than 20 issues', () => {
    const manyIssues = Array.from({ length: 25 }, (_, i) => ({
      category: 'data_quality' as const,
      severity: 'error' as const,
      table: 'members',
      recordId: i,
      description: `Issue ${i}`,
    }));
    const bigResult = [{
      checkName: 'Big Check',
      status: 'fail' as const,
      issueCount: 25,
      issues: manyIssues,
      lastRun: new Date(),
    }];
    const html = getIntegrityAlertEmailHtml(bigResult, manyIssues);
    expect(html).toContain('and 5 more issues');
  });
});

describe('Pass Emails', () => {
  describe('getPassWithQrHtml', () => {
    const passDetails = {
      passId: 100,
      type: 'golf-day_pass',
      quantity: 3,
      purchaseDate: new Date('2025-05-01T12:00:00Z'),
    };

    it('renders pass email with QR code', async () => {
      const html = await getPassWithQrHtml(passDetails);
      expect(html).toContain('Your Pass is Ready');
      expect(html).toContain('data:image/png');
      expect(html).toContain('Pass QR Code');
    });

    it('includes formatted pass type', async () => {
      const html = await getPassWithQrHtml(passDetails);
      expect(html).toContain('Golf');
      expect(html).toContain('Day Pass');
    });

    it('includes pass ID', async () => {
      const html = await getPassWithQrHtml(passDetails);
      expect(html).toContain('#100');
    });

    it('includes quantity and purchase date', async () => {
      const html = await getPassWithQrHtml(passDetails);
      expect(html).toContain('3');
      expect(html).toContain('May');
    });

    it('includes usage instructions', async () => {
      const html = await getPassWithQrHtml(passDetails);
      expect(html).toContain('How to Use Your Pass');
      expect(html).toContain('Show this QR code');
    });
  });

  describe('getRedemptionConfirmationHtml', () => {
    it('renders golf pass redemption with Trackman info', () => {
      const html = getRedemptionConfirmationHtml({
        guestName: 'Fred',
        passType: 'golf-simulator',
        remainingUses: 2,
        redeemedAt: new Date('2025-06-15T14:30:00Z'),
      });
      expect(html).toContain('Fred');
      expect(html).toContain('Welcome to Ever Club');
      expect(html).toContain('2 uses remaining');
      expect(html).toContain('Trackman');
      expect(html).toContain('WiFi Access');
    });

    it('renders workspace pass redemption with cafe menu', () => {
      const html = getRedemptionConfirmationHtml({
        guestName: 'Grace',
        passType: 'workspace-day',
        remainingUses: 0,
        redeemedAt: new Date('2025-06-15T09:00:00Z'),
      });
      expect(html).toContain('Grace');
      expect(html).toContain('Cafe Menu');
      expect(html).not.toContain('Trackman');
    });

    it('shows singular "use" for 1 remaining', () => {
      const html = getRedemptionConfirmationHtml({
        guestName: 'Hank',
        passType: 'golf-bay',
        remainingUses: 1,
        redeemedAt: new Date(),
      });
      expect(html).toContain('1 use remaining');
    });

    it('omits remaining uses message when zero', () => {
      const html = getRedemptionConfirmationHtml({
        guestName: 'Ivy',
        passType: 'golf-simulator',
        remainingUses: 0,
        redeemedAt: new Date(),
      });
      expect(html).not.toContain('uses remaining');
      expect(html).not.toContain('use remaining');
    });
  });
});

describe('Tour Emails', () => {
  const tourData = {
    guestName: 'Nancy Drew',
    date: '2025-08-20',
    time: '10:00',
    addressLine1: '123 Club Lane',
    cityStateZip: 'Austin, TX 78739',
  };

  it('renders tour confirmation with guest name', () => {
    const html = getTourConfirmationHtml(tourData);
    expect(html).toContain('Nancy Drew');
    expect(html).toContain('Tour Confirmed');
  });

  it('formats date correctly', () => {
    const html = getTourConfirmationHtml(tourData);
    expect(html).toContain('August');
    expect(html).toContain('2025');
  });

  it('formats time as 12-hour', () => {
    const html = getTourConfirmationHtml(tourData);
    expect(html).toMatch(/10:00\s*AM/i);
  });

  it('includes address', () => {
    const html = getTourConfirmationHtml(tourData);
    expect(html).toContain('123 Club Lane');
    expect(html).toContain('Austin, TX 78739');
  });

  it('includes Ever Club location label', () => {
    const html = getTourConfirmationHtml(tourData);
    expect(html).toContain('Ever Club');
  });

  it('wraps in email layout', () => {
    const html = getTourConfirmationHtml(tourData);
    expect(html).toContain('<!DOCTYPE html>');
  });
});

describe('Layout Contract — all layout-wrapped templates share consistent structure', () => {
  function expectLayoutContract(html: string) {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html>');
    expect(html).toContain('</html>');
    expect(html).toContain('everclub-logo-dark.png');
    expect(html).toContain('alt="Ever Club"');
    expect(html).toContain('Reply to this email');
    expect(html).toContain('everclub.app');
    expect(html).toContain('max-width: 600px');
    expect(html).toContain(CLUB_COLORS.bone);
  }

  it('bookingConfirmation uses shared layout', () => {
    expectLayoutContract(getBookingConfirmationHtml({ date: '2025-01-01', time: '09:00', bayName: 'B', memberName: 'M' }));
  });

  it('paymentReceipt uses shared layout', () => {
    expectLayoutContract(getPaymentReceiptHtml({ memberName: 'M', amount: 1, description: 'D', date: new Date() }));
  });

  it('paymentFailed uses shared layout', () => {
    expectLayoutContract(getPaymentFailedHtml({ memberName: 'M', amount: 1, reason: 'R' }));
  });

  it('outstandingBalance uses shared layout', () => {
    expectLayoutContract(getOutstandingBalanceHtml({ memberName: 'M', amount: 1, description: 'D' }));
  });

  it('feeWaived uses shared layout', () => {
    expectLayoutContract(getFeeWaivedHtml({ memberName: 'M', originalAmount: 1, reason: 'R' }));
  });

  it('purchaseReceipt uses shared layout', () => {
    expectLayoutContract(getPurchaseReceiptHtml({ memberName: 'M', items: [{ name: 'I', quantity: 1, unitPrice: 100, total: 100 }], totalAmount: 100, paymentMethod: 'card', date: new Date() }));
  });

  it('welcomeEmail uses shared layout', () => {
    expectLayoutContract(getWelcomeEmailHtml('M'));
  });

  it('trialWelcome uses shared layout', async () => {
    expectLayoutContract(await getTrialWelcomeHtml({ firstName: 'M', userId: 1, trialEndDate: new Date(Date.now() + 86400000) }));
  });

  it('membershipRenewal uses shared layout', () => {
    expectLayoutContract(getMembershipRenewalHtml({ memberName: 'M', amount: 1, planName: 'P', nextBillingDate: new Date() }));
  });

  it('membershipFailed uses shared layout', () => {
    expectLayoutContract(getMembershipFailedHtml({ memberName: 'M', amount: 1, planName: 'P', reason: 'R' }));
  });

  it('cardExpiring uses shared layout', () => {
    expectLayoutContract(getCardExpiringHtml({ memberName: 'M', cardLast4: '0000', expiryMonth: 1, expiryYear: 2030 }));
  });

  it('gracePeriodReminder uses shared layout', () => {
    expectLayoutContract(getGracePeriodReminderHtml({ memberName: 'M', currentDay: 1, totalDays: 7, reactivationLink: 'u' }));
  });

  it('membershipActivation uses shared layout', () => {
    expectLayoutContract(getMembershipActivationHtml({ memberName: 'M', tierName: 'T', monthlyPrice: 1, checkoutUrl: 'u', expiresAt: new Date() }));
  });

  it('membershipInvite uses shared layout', () => {
    expectLayoutContract(getMembershipInviteHtml({ firstName: 'M', tierName: 'T', priceFormatted: '$1', checkoutUrl: 'u' }));
  });

  it('winBack uses shared layout', () => {
    expectLayoutContract(getWinBackHtml({ firstName: 'M', reactivationLink: 'u' }));
  });

  it('accountDeletion uses shared layout', () => {
    expectLayoutContract(getAccountDeletionHtml({ firstName: 'M' }));
  });

  it('nudge24h uses shared layout', () => {
    expectLayoutContract(getNudge24hHtml('M'));
  });

  it('nudge72h uses shared layout', () => {
    expectLayoutContract(getNudge72hHtml('M'));
  });

  it('nudge7d uses shared layout', () => {
    expectLayoutContract(getNudge7dHtml('M'));
  });

  it('firstVisit uses shared layout', () => {
    expectLayoutContract(getFirstVisitHtml({ firstName: 'M' }));
  });

  it('integrityAlert uses shared layout', () => {
    const result = [{ checkName: 'C', status: 'fail' as const, issueCount: 1, issues: [{ category: 'data_quality' as const, severity: 'error' as const, table: 't', recordId: 1, description: 'd' }], lastRun: new Date() }];
    expectLayoutContract(getIntegrityAlertEmailHtml(result, result[0].issues));
  });

  it('passWithQr uses shared layout', async () => {
    expectLayoutContract(await getPassWithQrHtml({ passId: 1, type: 'day', quantity: 1, purchaseDate: new Date() }));
  });

  it('redemptionConfirmation uses shared layout', () => {
    expectLayoutContract(getRedemptionConfirmationHtml({ guestName: 'G', passType: 'workspace', remainingUses: 0, redeemedAt: new Date() }));
  });

  it('tourConfirmation uses shared layout', () => {
    expectLayoutContract(getTourConfirmationHtml({ guestName: 'G', date: '2025-01-01', time: '09:00', addressLine1: 'A', cityStateZip: 'C' }));
  });
});

describe('Edge Cases', () => {
  it('handles long member names', () => {
    const longName = 'A'.repeat(200);
    const html = getBookingConfirmationHtml({
      date: '2025-01-01',
      time: '09:00',
      bayName: 'Bay 1',
      memberName: longName,
    });
    expect(html).toContain(longName);
  });

  it('handles special characters in descriptions', () => {
    const html = getPaymentReceiptHtml({
      memberName: 'Test <User>',
      amount: 100,
      description: 'Fee for "special" session & extras',
      date: new Date(),
    });
    expect(html).toContain('Test <User>');
    expect(html).toContain('Fee for "special" session & extras');
  });

  it('handles zero amount in payment receipt', () => {
    const html = getPaymentReceiptHtml({
      memberName: 'Zero User',
      amount: 0,
      description: 'Complimentary',
      date: new Date(),
    });
    expect(html).toContain('$0.00');
  });

  it('handles empty first name in OTP', () => {
    const html = getOtpEmailHtml({ firstName: '', code: '123456', logoUrl: 'https://example.com/logo.png' });
    expect(html).toContain('Hi ,');
    expect(html).toContain('123456');
  });

  it('all templates produce non-empty HTML strings', async () => {
    const templates = [
      getBookingConfirmationHtml({ date: '2025-01-01', time: '09:00', bayName: 'B1', memberName: 'X' }),
      getPaymentReceiptHtml({ memberName: 'X', amount: 1, description: 'D', date: new Date() }),
      getPaymentFailedHtml({ memberName: 'X', amount: 1, reason: 'R' }),
      getOutstandingBalanceHtml({ memberName: 'X', amount: 1, description: 'D' }),
      getFeeWaivedHtml({ memberName: 'X', originalAmount: 1, reason: 'R' }),
      getOtpEmailHtml({ firstName: 'X', code: '000000', logoUrl: 'u' }),
      getWelcomeEmailHtml('X'),
      getMembershipRenewalHtml({ memberName: 'X', amount: 1, planName: 'P', nextBillingDate: new Date() }),
      getMembershipFailedHtml({ memberName: 'X', amount: 1, planName: 'P', reason: 'R' }),
      getCardExpiringHtml({ memberName: 'X', cardLast4: '0000', expiryMonth: 1, expiryYear: 2030 }),
      getGracePeriodReminderHtml({ memberName: 'X', currentDay: 1, totalDays: 7, reactivationLink: 'u' }),
      getMembershipActivationHtml({ memberName: 'X', tierName: 'T', monthlyPrice: 1, checkoutUrl: 'u', expiresAt: new Date() }),
      getMembershipInviteHtml({ firstName: 'X', tierName: 'T', priceFormatted: '$1', checkoutUrl: 'u' }),
      getWinBackHtml({ firstName: 'X', reactivationLink: 'u' }),
      getAccountDeletionHtml({ firstName: 'X' }),
      getNudge24hHtml('X'),
      getNudge72hHtml('X'),
      getNudge7dHtml('X'),
      getFirstVisitHtml({ firstName: 'X' }),
      getTourConfirmationHtml({ guestName: 'X', date: '2025-01-01', time: '09:00', addressLine1: 'A', cityStateZip: 'C' }),
    ];

    for (const html of templates) {
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(100);
    }

    const asyncTemplates = [
      await getTrialWelcomeHtml({ firstName: 'X', userId: 1, trialEndDate: new Date(Date.now() + 86400000) }),
      await getPassWithQrHtml({ passId: 1, type: 'day-pass', quantity: 1, purchaseDate: new Date() }),
    ];

    for (const html of asyncTemplates) {
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(100);
    }
  });
});
