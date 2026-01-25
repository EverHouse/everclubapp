import { Router } from 'express';
import resourcesRouter from './resources';
import bookingsRouter from './bookings';
import approvalRouter from './approval';
import calendarRouter from './calendar';
import notificationsRouter from './notifications';

const router = Router();

router.use(resourcesRouter);
router.use(bookingsRouter);
router.use(approvalRouter);
router.use(calendarRouter);
router.use(notificationsRouter);

export default router;
