import { Router } from 'express';
import searchRouter from './search';
import profileRouter from './profile';
import adminActionsRouter from './admin-actions';
import communicationsRouter from './communications';
import notesRouter from './notes';
import visitorsRouter from './visitors';

const router = Router();

router.use(searchRouter);
router.use(profileRouter);
router.use(adminActionsRouter);
router.use(communicationsRouter);
router.use(notesRouter);
router.use(visitorsRouter);

export default router;
