import { Router } from 'express';
import {
  listBookingRequests,
  createBookingRequest,
  getBookingRequestById,
  memberCancelBooking,
  getFeeEstimate,
  getBookingFeeEstimate,
} from '../../controllers/bookings';

const router = Router();

router.get('/api/booking-requests', listBookingRequests);

router.post('/api/booking-requests', createBookingRequest);

router.get('/api/booking-requests/:id', getBookingRequestById);

router.put('/api/booking-requests/:id/member-cancel', memberCancelBooking);

router.get('/api/fee-estimate', getFeeEstimate);

router.get('/api/booking-requests/:id/fee-estimate', getBookingFeeEstimate);

export default router;
