import { Router } from 'express';
import resourcesRouter from './resources';
import bookingsRouter from './bookings';
import approvalRouter from './approval';
import calendarRouter from './calendar';
import notificationsRouter from './notifications';
import staffConferenceBookingRouter from './staff-conference-booking';
import rescheduleRouter from './reschedule';

const router = Router();

router.use(resourcesRouter);
router.use(bookingsRouter);
router.use(approvalRouter);
router.use(calendarRouter);
router.use(notificationsRouter);
router.use(staffConferenceBookingRouter);
router.use(rescheduleRouter);

export default router;
