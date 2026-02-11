import { pool } from '../server/core/db';
import { getHubSpotClient } from '../server/core/integrations';

async function batchDeleteDeals() {
  const hubspot = await getHubSpotClient();
  const pipelineId = process.env.HUBSPOT_MEMBERSHIP_PIPELINE_ID || 'default';
  
  console.log(`Listing all deals in pipeline: ${pipelineId}`);
  
  let allDealIds: string[] = [];
  let after: string | undefined = undefined;
  
  while (true) {
    const searchReq: any = {
      filterGroups: [{
        filters: [{
          propertyName: 'pipeline',
          operator: 'EQ',
          value: pipelineId
        }]
      }],
      limit: 100,
      properties: ['dealname']
    };
    if (after) searchReq.after = after;
    
    try {
      const response = await hubspot.crm.deals.searchApi.doSearch(searchReq);
      const ids = response.results.map((d: any) => d.id);
      allDealIds.push(...ids);
      console.log(`Found ${allDealIds.length} deals so far...`);
      
      if (response.paging?.next?.after) {
        after = response.paging.next.after;
      } else {
        break;
      }
    } catch (err: any) {
      console.error('Search error:', err?.message || err);
      break;
    }
  }
  
  console.log(`Total deals to delete: ${allDealIds.length}`);
  
  let deleted = 0;
  let failed = 0;
  
  for (let i = 0; i < allDealIds.length; i++) {
    try {
      await hubspot.crm.deals.basicApi.archive(allDealIds[i]);
      deleted++;
    } catch (err: any) {
      const msg = String(err?.body || err?.message || '');
      if (msg.includes('429') || msg.includes('RATE_LIMIT') || msg.includes('rate limit')) {
        console.log(`Rate limited at ${i}, waiting 10s...`);
        await new Promise(r => setTimeout(r, 10000));
        i--;
        continue;
      }
      failed++;
    }
    
    if ((deleted + failed) % 50 === 0) {
      console.log(`Progress: ${deleted + failed}/${allDealIds.length} (deleted: ${deleted}, failed: ${failed})`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  console.log(`\nDone: ${deleted} deleted, ${failed} failed out of ${allDealIds.length}`);
  
  await pool.end();
  process.exit(0);
}

batchDeleteDeals().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
