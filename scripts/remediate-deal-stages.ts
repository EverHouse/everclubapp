import { pool } from '../server/core/db';
import { syncDealStageFromMindbodyStatus } from '../server/core/hubspotDeals';

async function remediateExpiredDeals() {
  console.log('[Remediation] Starting expired deals remediation to HubSpot...');
  
  const result = await pool.query(`
    SELECT u.email, u.membership_status
    FROM users u
    JOIN hubspot_deals hd ON LOWER(u.email) = LOWER(hd.member_email)
    WHERE u.membership_status = 'expired'
  `);
  
  console.log(`[Remediation] Found ${result.rows.length} expired members to sync to HubSpot`);
  
  let updated = 0;
  let errors = 0;
  const BATCH_SIZE = 5;
  const BATCH_DELAY_MS = 2000;
  
  for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
    const batch = result.rows.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.allSettled(
      batch.map(async (member: any) => {
        const syncResult = await syncDealStageFromMindbodyStatus(
          member.email,
          member.membership_status,
          'system',
          'Remediation Script'
        );
        return { email: member.email, ...syncResult };
      })
    );
    
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value.success) {
        updated++;
      } else {
        errors++;
        console.error(`[Remediation] Error:`, res.status === 'rejected' ? res.reason : res.value);
      }
    }
    
    if (i + BATCH_SIZE < result.rows.length) {
      console.log(`[Remediation] Progress: ${Math.min(i + BATCH_SIZE, result.rows.length)}/${result.rows.length}`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }
  
  console.log(`[Remediation] Complete - Updated: ${updated}, Errors: ${errors}`);
  process.exit(0);
}

remediateExpiredDeals().catch(err => {
  console.error('[Remediation] Fatal error:', err);
  process.exit(1);
});
