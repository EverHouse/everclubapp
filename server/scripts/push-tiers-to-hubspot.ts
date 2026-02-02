/**
 * One-time script to push app tier data to HubSpot contacts
 * Run with: npx tsx server/scripts/push-tiers-to-hubspot.ts
 */
import { getHubSpotClient } from '../core/integrations';
import { retryableHubSpotRequest } from '../core/hubspot/request';

const membersToUpdate = [
  { hubspotId: '313656617710', tier: 'Core Membership Founding Members', name: 'Gabriel Kim' },
  { hubspotId: '313824127678', tier: 'Approved Pre Sale Clients', name: 'Shelby Miller' },
  { hubspotId: '330082144981', tier: '', name: 'Brian Kim' },
  { hubspotId: '313846430426', tier: 'Approved Pre Sale Clients', name: 'Kenneth Kauffman' },
  { hubspotId: '313572824812', tier: 'Approved Pre Sale Clients', name: 'Alexis Gomez' },
];

async function pushTiersToHubSpot() {
  console.log('Starting tier push to HubSpot...');
  const hubspot = await getHubSpotClient();
  
  for (const member of membersToUpdate) {
    try {
      await retryableHubSpotRequest(() =>
        hubspot.crm.contacts.basicApi.update(member.hubspotId, {
          properties: {
            membership_tier: member.tier
          }
        })
      );
      console.log('Updated ' + member.name + ': membership_tier = "' + member.tier + '"');
    } catch (error: any) {
      console.error('Failed to update ' + member.name + ':', error.message);
    }
  }
  
  console.log('Done!');
  process.exit(0);
}

pushTiersToHubSpot();
