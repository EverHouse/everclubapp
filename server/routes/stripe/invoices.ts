import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../../core/middleware';
import { pool } from '../../core/db';
import { getSessionUser } from '../../types/session';
import {
  createInvoice,
  previewInvoice,
  finalizeAndSendInvoice,
  listCustomerInvoices,
  getInvoice,
  voidInvoice
} from '../../core/stripe';

const router = Router();

router.get('/api/stripe/invoices/preview', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId, priceId } = req.query;
    
    if (!customerId || !priceId) {
      return res.status(400).json({ error: 'Missing required query params: customerId, priceId' });
    }
    
    const result = await previewInvoice({
      customerId: customerId as string,
      priceId: priceId as string,
    });
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to preview invoice' });
    }
    
    res.json({ preview: result.preview });
  } catch (error: any) {
    console.error('[Stripe] Error previewing invoice:', error);
    res.status(500).json({ error: 'Failed to preview invoice' });
  }
});

router.get('/api/stripe/invoices/:customerId', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    
    const result = await listCustomerInvoices(customerId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to list invoices' });
    }
    
    res.json({
      invoices: result.invoices,
      count: result.invoices?.length || 0
    });
  } catch (error: any) {
    console.error('[Stripe] Error listing invoices:', error);
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

router.post('/api/stripe/invoices', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId, items, description } = req.body;
    
    if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: customerId, items (array)' });
    }
    
    const result = await createInvoice({
      customerId,
      items,
      description,
    });
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to create invoice' });
    }
    
    res.json({
      success: true,
      invoice: result.invoice
    });
  } catch (error: any) {
    console.error('[Stripe] Error creating invoice:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

router.post('/api/stripe/invoices/:invoiceId/finalize', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    
    const result = await finalizeAndSendInvoice(invoiceId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to finalize invoice' });
    }
    
    res.json({
      success: true,
      invoice: result.invoice
    });
  } catch (error: any) {
    console.error('[Stripe] Error finalizing invoice:', error);
    res.status(500).json({ error: 'Failed to finalize invoice' });
  }
});

router.get('/api/stripe/invoice/:invoiceId', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    
    const result = await getInvoice(invoiceId);
    
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Invoice not found' });
    }
    
    res.json({ invoice: result.invoice });
  } catch (error: any) {
    console.error('[Stripe] Error getting invoice:', error);
    res.status(500).json({ error: 'Failed to get invoice' });
  }
});

router.post('/api/stripe/invoices/:invoiceId/void', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    
    const result = await voidInvoice(invoiceId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to void invoice' });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Stripe] Error voiding invoice:', error);
    res.status(500).json({ error: 'Failed to void invoice' });
  }
});

router.get('/api/my-invoices', async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    const sessionEmail = sessionUser?.email;
    if (!sessionEmail) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    const requestedEmail = req.query.user_email as string | undefined;
    let targetEmail = sessionEmail;
    
    if (requestedEmail && requestedEmail.toLowerCase() !== sessionEmail.toLowerCase()) {
      const userRole = sessionUser?.role;
      if (userRole === 'admin' || userRole === 'staff') {
        targetEmail = decodeURIComponent(requestedEmail);
      }
    }
    
    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE LOWER(email) = $1',
      [targetEmail.toLowerCase()]
    );
    
    const stripeCustomerId = userResult.rows[0]?.stripe_customer_id;
    
    if (!stripeCustomerId) {
      return res.json({ invoices: [], count: 0 });
    }
    
    const result = await listCustomerInvoices(stripeCustomerId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to list invoices' });
    }
    
    console.log(`[Stripe] my-invoices for ${targetEmail}: found ${result.invoices?.length || 0} invoices`);
    
    res.json({
      invoices: result.invoices,
      count: result.invoices?.length || 0
    });
  } catch (error: any) {
    console.error('[Stripe] Error listing member invoices:', error);
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

export default router;
