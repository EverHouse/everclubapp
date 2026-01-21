import { Router, Request, Response } from 'express';
import { pool } from '../core/db';
import { notifyAllStaff } from '../core/notificationService';

const router = Router();

interface HubSpotFormConfig {
  portalId: string;
  formId: string;
  region: string;
}

const HUBSPOT_PORTAL_ID = '244200670';

const FORM_CONFIGS: Record<string, HubSpotFormConfig> = {
  'contact': {
    portalId: HUBSPOT_PORTAL_ID,
    formId: 'contact-form', // Generic contact - will create in HubSpot or use default
    region: 'na2'
  },
  'tour-request': {
    portalId: HUBSPOT_PORTAL_ID,
    formId: 'tour-request-form',
    region: 'na2'
  },
  'membership': {
    portalId: HUBSPOT_PORTAL_ID,
    formId: 'membership-form',
    region: 'na2'
  },
  'private-hire': {
    portalId: HUBSPOT_PORTAL_ID,
    formId: 'b69f9fe4-9b3b-4d1e-a689-ba3127e5f8f2',
    region: 'na2'
  },
  'event-inquiry': {
    portalId: HUBSPOT_PORTAL_ID,
    formId: 'b69f9fe4-9b3b-4d1e-a689-ba3127e5f8f2',
    region: 'na2'
  },
  'guest-checkin': {
    portalId: HUBSPOT_PORTAL_ID,
    formId: 'guest-checkin-form',
    region: 'na2'
  }
};

router.post('/api/hubspot/forms/:formType', async (req: Request, res: Response) => {
  const { formType } = req.params;
  const { fields, context } = req.body;

  const config = FORM_CONFIGS[formType];
  
  if (!config) {
    console.warn(`[HubSpot Forms] Unknown form type: ${formType}`);
    return res.status(400).json({ error: 'Unknown form type' });
  }

  try {
    const submittedAt = Date.now();
    
    const hubspotPayload = {
      submittedAt,
      fields: fields.map((f: { name: string; value: string }) => ({
        objectTypeId: '0-1',
        name: f.name,
        value: f.value
      })),
      context: {
        hutk: context?.hutk || undefined,
        pageUri: context?.pageUri || '',
        pageName: context?.pageName || ''
      }
    };

    const hubspotUrl = `https://api.hsforms.com/submissions/v3/integration/submit/${config.portalId}/${config.formId}`;
    
    const response = await fetch(hubspotUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(hubspotPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[HubSpot Forms] Submission failed for ${formType}:`, response.status, errorText);
      
      if (formType === 'contact' || formType === 'private-hire' || formType === 'event-inquiry') {
        await saveFormSubmissionLocally(formType, fields, context);
        await notifyStaffOfFormSubmission(formType, fields);
        return res.json({ success: true, fallback: true });
      }
      
      return res.status(500).json({ error: 'Failed to submit form to HubSpot' });
    }

    console.log(`[HubSpot Forms] Successfully submitted ${formType} form`);

    if (formType === 'private-hire' || formType === 'event-inquiry') {
      await notifyStaffOfFormSubmission(formType, fields);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error(`[HubSpot Forms] Error submitting ${formType}:`, error);
    
    if (formType === 'contact' || formType === 'private-hire' || formType === 'event-inquiry') {
      try {
        await saveFormSubmissionLocally(formType, fields, context);
        await notifyStaffOfFormSubmission(formType, fields);
        return res.json({ success: true, fallback: true });
      } catch (fallbackError) {
        console.error('[HubSpot Forms] Fallback save also failed:', fallbackError);
      }
    }
    
    return res.status(500).json({ error: 'Failed to submit form' });
  }
});

async function saveFormSubmissionLocally(
  formType: string, 
  fields: Array<{ name: string; value: string }>,
  context: any
) {
  const fieldMap = Object.fromEntries(fields.map(f => [f.name, f.value]));
  
  await pool.query(
    `INSERT INTO form_submissions (form_type, email, first_name, last_name, phone, company, message, raw_data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    [
      formType,
      fieldMap.email || null,
      fieldMap.firstname || null,
      fieldMap.lastname || null,
      fieldMap.phone || null,
      fieldMap.company || null,
      fieldMap.message || fieldMap.additional_details || null,
      JSON.stringify({ fields, context })
    ]
  );
}

async function notifyStaffOfFormSubmission(
  formType: string,
  fields: Array<{ name: string; value: string }>
) {
  const fieldMap = Object.fromEntries(fields.map(f => [f.name, f.value]));
  const name = `${fieldMap.firstname || ''} ${fieldMap.lastname || ''}`.trim() || 'Unknown';
  const email = fieldMap.email || 'No email provided';
  
  let title = 'New Form Submission';
  let message = `${name} (${email}) submitted a form`;
  
  if (formType === 'private-hire' || formType === 'event-inquiry') {
    const eventDate = fieldMap.event_date || 'Not specified';
    const guestCount = fieldMap.guest_count || 'Not specified';
    title = 'New Event Inquiry';
    message = `${name} submitted an event inquiry for ${eventDate} (${guestCount} guests)`;
  } else if (formType === 'contact') {
    const topic = fieldMap.topic || 'General';
    title = 'New Contact Form Submission';
    message = `${name} sent a message about: ${topic}`;
  }

  await notifyAllStaff(
    title,
    message,
    'form_submission'
  );
}

export default router;
