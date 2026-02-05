# Training Guide Audit: Tours & Notices (Facility)

## TOURS SECTION - Discrepancies

### Issue 1: Tour Source Integration
- **Section:** Tours
- **Step:** Tour Sources
- **Issue:** Training says "Tours come from two places: the booking widget on the website, or directly synced from the HubSpot meeting scheduler" but the app syncs from Google Calendar, not HubSpot
- **Correction:** "Tours are synced from Google Calendar. These include facility tours created through the tour booking system on the website."

### Issue 2: Missing Tour Statuses
- **Section:** Tours
- **Step:** Tour Status
- **Issue:** Training lists status options as "Scheduled (upcoming), Completed (attended), Cancelled, or No Show" but the app includes two additional statuses: "Checked In" and "Pending"
- **Correction:** "Update the tour status as needed: Scheduled (upcoming), Checked In (guest has arrived), Completed (attended), No Show (didn't arrive), Cancelled, or Pending (awaiting confirmation)."

### Issue 3: Needs Review Section Missing
- **Section:** Tours
- **Step:** Needs Review
- **Issue:** Training describes a "Needs Review" section for HubSpot meetings that didn't auto-match, but this section does not appear in the actual Tours tab interface
- **Correction:** Remove this step entirely or clarify with backend team if this feature is planned for future implementation

### Issue 4: Past Tours Section Not Documented
- **Section:** Tours
- **Step:** (Add new step)
- **Issue:** Training does not mention the "Past Tours" section that displays completed and historical tours
- **Correction:** Add new step: "Past Tours - Below the Upcoming Tours section, you can view historical tours that have already occurred, organized by date."

### Issue 5: Check-In Functionality Not Explained
- **Section:** Tours
- **Step:** (Add new step or enhance Today's Tours)
- **Issue:** Training doesn't explain the blue "Check In" button that appears for today's scheduled tours
- **Correction:** Add to Today's Tours step or create new step: "For today's scheduled tours, use the blue 'Check In' button to mark the guest as having arrived. Once checked in, the tour status changes to 'Checked In'."

---

## NOTICES (FACILITY) SECTION - Discrepancies

### Issue 1: Missing Visibility Field Documentation
- **Section:** Notices (Facility)
- **Step:** (Add new step)
- **Issue:** Training does not mention the required "Visibility" field, which controls who can see the notice. This is a critical field with options: Public, Staff Only, Private, or Draft
- **Correction:** Add new step: "Visibility Setting - After selecting affected areas, set who can view this notice: Public (visible to members), Staff Only (internal use), Private (not visible), or Draft (incomplete notices marked for review)."

### Issue 2: Member Visibility Checkbox Not Explained
- **Section:** Notices (Facility)
- **Step:** (Add new step)
- **Issue:** Training doesn't mention the "Show to Members" checkbox that controls whether members see the notice on their dashboard
- **Correction:** Add new step: "Member Dashboard Display - For informational notices (no booking restrictions), toggle 'Show to Members' to display the notice on member dashboards and in the Updates section. For blocking notices, this is always shown when the restriction applies."

### Issue 3: Needs Review Section Visual Indicator Missing
- **Section:** Notices (Facility)
- **Step:** Needs Review Section
- **Issue:** Training describes the "Needs Review" section but doesn't mention that draft items are clearly marked with a cyan color and labeled "Draft"
- **Correction:** "Notices synced from Google Calendar without proper configuration show in the 'Needs Review' section at the top, marked with a cyan indicator and labeled 'Draft'. These drafts show missing required fields (Notice type, Affected areas, and Visibility). Tap the 'Edit' button to configure them."

### Issue 4: Missing Subtabs Documentation
- **Section:** Notices (Facility)
- **Step:** Access Notices
- **Issue:** Training doesn't mention that the Facility section has two subtabs: Notices and Blocks
- **Correction:** Update Access Notices step: "Go to Facility/Notices from the sidebar or bottom navigation. The Facility section has two tabs: Notices (for closures and informational announcements) and Blocks (for availability blocks and maintenance holds)."

### Issue 5: Affected Areas Terminology Inconsistency
- **Section:** Notices (Facility)
- **Step:** None = Informational
- **Issue:** Training says "Setting affected areas to 'None'" but the form UI and filter both use the terminology "Informational Only" to be more user-friendly
- **Correction:** "Select 'Informational Only' (or 'None' in the system) for the affected areas to make the notice amber and informational. This shows up in the calendar but doesn't block any member bookings."

### Issue 6: Color Legend Incomplete
- **Section:** Notices (Facility)
- **Step:** Card Colors Explained
- **Issue:** Training describes RED (blocking) and AMBER (informational) but doesn't mention the CYAN color used for Draft notices
- **Correction:** "Card Colors - RED cards block bookings for the selected areas. AMBER cards are informational announcements and don't affect booking availability. CYAN cards indicate Draft notices that are incomplete and need configuration before members can see them."

### Issue 7: Past Notices Display Terminology
- **Section:** Notices (Facility)
- **Step:** Filter & Search
- **Issue:** Training says "Show past" toggle but the actual implementation uses a "Past Notices" collapsible accordion section
- **Correction:** "Use the 'Past Notices' accordion at the bottom of the page to view and manage historical notices. Click the accordion header to expand and see past facility closures and announcements."

### Issue 8: Notice Type Field Purpose Not Explained
- **Section:** Notices (Facility)
- **Step:** (Add new step or enhance Create a Notice)
- **Issue:** Training doesn't explain the "Reason Category" (notice_type) field and how it syncs with Google Calendar
- **Correction:** Add detail: "Reason Category - Select a category for the closure (e.g., Holiday, Maintenance, Private Event). This category syncs with Google Calendar and helps organize notices. You can manage custom categories in the 'Notice Types' section."

### Issue 9: Missing Closure Reasons Section
- **Section:** Notices (Facility)
- **Step:** (Add new step)
- **Issue:** Training doesn't mention the "Closure Reasons" configuration section where staff can manage the dropdown options shown to members
- **Correction:** Add new step: "Closure Reasons - In the Notices tab, you'll see a 'Closure Reasons' section where you can add, edit, and manage closure reasons. These appear as badges shown to members (e.g., 'Holiday', 'Maintenance'). Manage the available options and sort order here."

---

## Summary of Discrepancies by Category

### Missing Documentation (New Steps Needed):
1. Past Tours section in Tours guide
2. Check In button functionality
3. Visibility field for Notices
4. Member Visibility checkbox
5. Closure Reasons management section
6. Notice Type field explanation

### Incorrect Information (Needs Correction):
1. Tour sources (HubSpot vs Google Calendar)
2. Incomplete status list for tours
3. Past Notices display method (toggle vs accordion)
4. Needs Review section doesn't exist in Tours

### Incomplete Documentation (Needs Enhancement):
1. Needs Review styling (cyan color, Draft label)
2. Color legend (missing cyan)
3. Subtabs not mentioned
4. Affected areas terminology clarity
