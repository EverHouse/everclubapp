import re

def get_defined_icons():
    icons = set()
    with open('src/components/icons/iconPaths.ts', 'r') as f:
        for line in f:
            match = re.search(r'^\s*([a-zA-Z0-9_-]+):', line)
            if match:
                icons.add(match.group(1))
    return icons

defined = get_defined_icons()

# Manually add from mapping objects we found
defined_mappings = {
    'checkroom', 'watch', 'sports_golf', 'local_cafe', 'category', 'lock', 'waving_hand', 
    'event_note', 'confirmation_number', 'payments', 'card_membership', 'school', 'settings',
    'golf_course', 'badge', 'shopping_bag', 'autorenew', 'receipt_long',
    'receipt', 'workspace_premium', 'person_add', 'breakfast_dining', 'lunch_dining', 'cake',
    'child_care', 'restaurant', 'set_meal', 'grid_view', 'sell', 'coffee', 'storefront', 'folder'
}
all_defined = defined.union(defined_mappings)

# Extra ones from code grep
extra_dynamic = {
    'wifi_off', 'error', 'campaign', 'notifications', 'work', 'sync', 'progress_activity',
    'mark_email_unread', 'reply', 'mail', 'database', 'upload', 'refresh', 'fact_check',
    'cloud_sync', 'check_circle', 'cancel', 'credit_card_off', 'check', 'content_copy',
    'expand_less', 'history', 'person', 'meeting_room', 'qr_code_scanner', 'spa', 'location_on',
    'music_note', 'volunteer_activism', 'celebration', 'emoji_events', 'handshake', 'family_restroom'
}
all_defined = all_defined.union(extra_dynamic)

to_check = [
    'wifi_off', 'error', 'campaign', 'notifications', 'sports_golf', 'work', 'confirmation_number',
    'sync', 'progress_activity', 'mark_email_unread', 'reply', 'mail', 'database', 'event_note',
    'upload', 'storefront', 'folder', 'refresh', 'fact_check', 'cloud_sync', 'check_circle', 
    'cancel', 'credit_card_off', 'check', 'content_copy', 'expand_less', 'history', 'person_add',
    'person', 'meeting_room', 'qr_code_scanner', 'spa', 'location_on', 'golf_course', 'emoji_events',
    'restaurant', 'handshake', 'school', 'family_restroom', 'music_note', 'volunteer_activism', 'celebration'
]

missing = [icon for icon in to_check if icon not in defined]
print(f"Icons used dynamically but not in iconPaths.ts: {missing}")
