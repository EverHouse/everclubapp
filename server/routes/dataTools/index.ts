import { Router } from 'express';
import memberSyncRouter from './member-sync';
import bookingToolsRouter from './booking-tools';
import auditRouter from './audit';
import stripeToolsRouter from './stripe-tools';
import maintenanceRouter from './maintenance';

const router = Router();

router.use(memberSyncRouter);
router.use(bookingToolsRouter);
router.use(auditRouter);
router.use(stripeToolsRouter);
router.use(maintenanceRouter);

export default router;
