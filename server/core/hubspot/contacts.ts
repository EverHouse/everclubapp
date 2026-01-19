import { getHubSpotClient } from '../integrations';
import { isProduction } from '../db';
import { retryableHubSpotRequest } from './request';

export interface SyncDayPassPurchaseInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  productName: string;
  amountCents: number;
  purchaseDate: Date;
}

export interface SyncDayPassPurchaseResult {
  success: boolean;
  contactId?: string;
  error?: string;
}

/**
 * Sync a day pass purchase to HubSpot for a non-member (visitor)
 * Creates or finds a contact with lifecyclestage 'lead' and adds a note about the purchase
 */
export async function syncDayPassPurchaseToHubSpot(
  data: SyncDayPassPurchaseInput
): Promise<SyncDayPassPurchaseResult> {
  const { email, firstName, lastName, phone, productName, amountCents, purchaseDate } = data;
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const hubspot = await getHubSpotClient();

    // Step 1: Check if contact exists by email
    let contactId: string | undefined;
    let isNewContact = false;

    try {
      const searchResponse = await retryableHubSpotRequest(() =>
        hubspot.crm.contacts.searchApi.doSearch({
          filterGroups: [{
            filters: [{
              propertyName: 'email',
              operator: 'EQ',
              value: normalizedEmail
            }]
          }],
          properties: ['email', 'firstname', 'lastname', 'lifecyclestage', 'hs_lead_status'],
          limit: 1
        })
      );

      if (searchResponse.results && searchResponse.results.length > 0) {
        contactId = searchResponse.results[0].id;
        if (!isProduction) {
          console.log(`[DayPassHubSpot] Found existing contact ${contactId} for ${normalizedEmail}`);
        }
      }
    } catch (error: any) {
      const statusCode = error?.response?.statusCode || error?.status || error?.statusCode;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Only treat 404 as "not found", other errors should be thrown
      const isNotFoundError = statusCode === 404 || errorMsg.includes('not found');

      if (!isNotFoundError) {
        // Network or auth error - rethrow
        const isNetworkOrAuthError = 
          statusCode === 401 || 
          statusCode === 403 || 
          (statusCode && statusCode >= 500) ||
          errorMsg.includes('ECONNREFUSED') ||
          errorMsg.includes('ETIMEDOUT') ||
          errorMsg.includes('unauthorized') ||
          errorMsg.includes('forbidden');

        if (isNetworkOrAuthError) {
          throw error;
        }
      }

      if (!isProduction) {
        console.warn('[DayPassHubSpot] Error searching for contact, will create new one:', error);
      }
    }

    // Step 2: Create new contact if not found
    if (!contactId) {
      try {
        const createResponse = await retryableHubSpotRequest(() =>
          hubspot.crm.contacts.basicApi.create({
            properties: {
              email: normalizedEmail,
              firstname: firstName || '',
              lastname: lastName || '',
              phone: phone || '',
              lifecyclestage: 'lead',
              hs_lead_status: 'NEW'
            }
          })
        );

        contactId = createResponse.id;
        isNewContact = true;

        if (!isProduction) {
          console.log(`[DayPassHubSpot] Created new contact ${contactId} for ${normalizedEmail}`);
        }
      } catch (createError: any) {
        const statusCode = createError?.code || createError?.response?.statusCode || createError?.status;
        const errorBody = createError?.response?.body;

        // Handle duplicate contact (409 Conflict)
        if (statusCode === 409 && errorBody?.message) {
          const match = errorBody.message.match(/Existing ID:\s*(\d+)/);
          if (match && match[1]) {
            contactId = match[1];
            if (!isProduction) {
              console.log(`[DayPassHubSpot] Contact ${normalizedEmail} already exists (ID: ${contactId}), using existing`);
            }
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      }
    }

    // Step 3: Add a note about the day pass purchase
    if (contactId) {
      try {
        const amountDollars = (amountCents / 100).toFixed(2);
        const purchaseDateStr = purchaseDate.toLocaleDateString('en-US');
        const noteContent = `Day Pass Purchase: ${productName}\nAmount: $${amountDollars}\nPurchase Date: ${purchaseDateStr}`;

        await retryableHubSpotRequest(() =>
          hubspot.crm.contacts.basicApi.update(contactId!, {
            properties: {
              notes: noteContent
            }
          })
        );

        if (!isProduction) {
          console.log(`[DayPassHubSpot] Added purchase note to contact ${contactId}`);
        }
      } catch (noteError: any) {
        // Log error but don't fail the entire operation - contact was created successfully
        console.warn('[DayPassHubSpot] Failed to add purchase note to contact:', noteError);
      }
    }

    return {
      success: true,
      contactId
    };

  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[DayPassHubSpot] Error syncing day pass purchase:', error);
    return {
      success: false,
      error: errorMsg || 'Failed to sync day pass purchase to HubSpot'
    };
  }
}
