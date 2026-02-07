import { Router } from 'express';
import { PRICING } from '../core/billing/pricingConfig';

const router = Router();

router.get('/api/pricing', (req, res) => {
  res.json({
    guestFeeDollars: PRICING.GUEST_FEE_DOLLARS,
    overageRatePerBlockDollars: PRICING.OVERAGE_RATE_DOLLARS,
    overageBlockMinutes: PRICING.OVERAGE_BLOCK_MINUTES,
  });
});

export default router;
