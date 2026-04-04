export interface WaiverSection {
  heading: string;
  paragraphs: string[];
}

export const WAIVER_PREAMBLE = 'Please read the Membership Agreement below carefully. You must agree to these terms as a condition of your membership at Ever Members Club. This Agreement is a binding legal contract \u2013 please review each section before signing.';

export const WAIVER_SECTIONS: WaiverSection[] = [
  {
    heading: 'Section 1. Recurring Billing Authorization',
    paragraphs: [
      'By signing this Agreement, you authorize Ever Members Club (\u201Cthe Club\u201D) to charge your designated payment method on a recurring basis for your membership dues at the rate associated with your selected membership tier. You acknowledge that your membership dues will be billed automatically each billing cycle (monthly or annually, as applicable) until your membership is cancelled in accordance with Section 2. You are responsible for keeping your payment information current. If a payment fails, the Club reserves the right to suspend your membership privileges until payment is received. The Club may update pricing with at least 30 days\u2019 written notice before your next billing cycle.',
    ],
  },
  {
    heading: 'Section 2. Cancellation Policy',
    paragraphs: [
      'You may cancel your membership at any time by submitting a cancellation request through the Ever Members Club app or by contacting Club staff in writing. Cancellation will take effect at the end of your current billing period \u2013 no partial-month refunds will be issued. If you cancel, you will retain access to Club facilities through the remainder of your paid billing cycle. Any promotional or discounted rates may not be available if you re-enroll after cancellation. The Club reserves the right to terminate your membership for cause (including but not limited to violation of Club rules, non-payment, or inappropriate behavior) with or without notice.',
    ],
  },
  {
    heading: 'Section 3. Guest Policy & Guest Fees',
    paragraphs: [
      'Members may bring guests to the Club subject to the guest policy applicable to their membership tier. Each membership tier includes a specified number of complimentary guest passes per year. Additional guest visits beyond the included passes will incur a guest fee, which will be charged to the member\u2019s payment method on file. Members are responsible for the conduct of their guests at all times. Guests must comply with all Club rules and policies. The Club reserves the right to refuse entry to any guest and to modify the guest policy or fees with reasonable notice.',
    ],
  },
  {
    heading: 'Section 4. Equipment & Facility Damage',
    paragraphs: [
      'Members and their guests are expected to treat all Club equipment, simulators, furnishings, and facilities with care. You agree to report any damage or malfunction immediately to Club staff. You will be held financially responsible for any damage to Club property caused by your intentional misconduct, gross negligence, or misuse of equipment. This includes but is not limited to damage to golf simulators, screens, projectors, clubs, furniture, and common areas. The Club will assess repair or replacement costs at its reasonable discretion, and such costs may be charged to your payment method on file.',
    ],
  },
  {
    heading: 'Section 6. Surveillance & Recording Consent',
    paragraphs: [
      'You acknowledge and consent to the use of video surveillance cameras and audio/video recording equipment throughout Club premises, including but not limited to common areas, simulator bays, and entry/exit points. These systems are used for security, safety, and operational purposes. By entering the Club, you consent to being recorded. The Club may use surveillance footage for security investigations, dispute resolution, and operational improvement. You agree not to tamper with, obstruct, or disable any surveillance equipment. Footage is retained in accordance with the Club\u2019s data retention policy.',
    ],
  },
  {
    heading: 'Section 7. SMS & Communication Consent',
    paragraphs: [
      'By providing your phone number, you consent to receive SMS text messages, push notifications, and other electronic communications from the Club related to your membership, bookings, billing, promotions, and Club operations. Message frequency varies. Message and data rates may apply. You may opt out of promotional messages at any time by replying STOP, but you acknowledge that transactional messages related to your membership (such as booking confirmations, payment receipts, and account alerts) are a necessary part of the membership service and cannot be individually opted out of while your membership is active.',
    ],
  },
  {
    heading: 'Section 8. Liability Waiver & Assumption of Risk',
    paragraphs: [
      'To the maximum extent allowed by law, you release Ever Members Club, its owners, partners, officers, employees, and agents from any and all liability, claims, demands, or causes of action for property damage, personal injury, illness, or death arising out of or relating to your membership, presence at the Club, or participation in Club activities. This waiver applies to injuries or damages occurring on Club premises or during Club-sponsored activities, whether caused by inherent risks (e.g., being struck by a golf ball, equipment malfunction) or by the negligence of the Club or its staff.',
      'You understand and voluntarily accept all risks inherent in using the Club\u2019s facilities and services, including but not limited to: athletic injuries, repetitive motion injuries, equipment malfunctions, interactions with other members or guests, and risks associated with food and beverage consumption. You agree to use all facilities and equipment safely and within your personal physical limits.',
      'You agree to indemnify, defend, and hold harmless Ever Members Club from any claims, damages, losses, or expenses (including reasonable legal fees) arising from your actions, omissions, or the actions of your guests at the Club.',
    ],
  },
  {
    heading: 'Section 9. Dispute Resolution & Arbitration',
    paragraphs: [
      'Any dispute, controversy, or claim arising out of or relating to this Agreement, your membership, or your use of Club facilities shall first be addressed through good-faith informal negotiation. If the dispute cannot be resolved informally within 30 days, it shall be resolved exclusively through binding arbitration administered in accordance with the rules of the American Arbitration Association (AAA). The arbitration shall take place in Dallas County, Texas. The arbitrator\u2019s decision shall be final and binding and may be entered as a judgment in any court of competent jurisdiction. You agree that any dispute resolution proceedings will be conducted on an individual basis and not as part of a class, consolidated, or representative action. Each party shall bear its own costs and attorney\u2019s fees unless the arbitrator determines otherwise.',
    ],
  },
];

export const WAIVER_CLOSING = 'By checking the box below, you confirm that you have read this Membership Agreement in its entirety, understand its terms, and agree to be bound by all provisions herein. This includes the recurring billing authorization, cancellation policy, liability waiver and assumption of risk, and binding arbitration clause, which you acknowledge as conditions of your membership.';

export function getWaiverPlainText(version: string): string {
  const lines: string[] = [];
  lines.push(`Ever Members Club \u2013 Membership Agreement v${version}`);
  lines.push('');
  lines.push(WAIVER_PREAMBLE);
  lines.push('');
  for (const section of WAIVER_SECTIONS) {
    lines.push(section.heading);
    for (const p of section.paragraphs) {
      lines.push(p);
    }
    lines.push('');
  }
  lines.push(WAIVER_CLOSING);
  return lines.join('\n');
}
