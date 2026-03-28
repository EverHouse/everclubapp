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

# Add manually extracted from mapping objects
defined_mappings = {
    'checkroom', 'watch', 'sports_golf', 'local_cafe', 'category', 'lock', 'waving_hand', 
    'event_note', 'confirmation_number', 'payments', 'card_membership', 'school', 'settings',
    'golf_course', 'badge', 'shopping_bag', 'account_balance_wallet', 'autorenew', 'receipt_long',
    'receipt', 'workspace_premium', 'person_add', 'breakfast_dining', 'lunch_dining', 'cake',
    'child_care', 'restaurant', 'set_meal', 'grid_view', 'sell', 'coffee', 'storefront', 'folder'
}

all_defined = defined.union(defined_mappings)

# We already know comm -13 was empty for literal name="..."
# Let's check common dynamic ones from the previous grep output
dynamic_to_check = [
    'wifi_off', 'error', 'campaign', 'notifications', 'sports_golf', 'work', 'confirmation_number',
    'sync', 'progress_activity', 'mark_email_unread', 'reply', 'mail', 'database', 'event_note',
    'upload', 'storefront', 'folder', 'refresh', 'fact_check', 'cloud_sync', 'check_circle', 
    'cancel', 'credit_card_off', 'check', 'content_copy', 'expand_less', 'history', 'person_add',
    'person', 'meeting_room', 'restaurant', 'shopping_bag', 'autorenew', 'receipt_long', 'receipt',
    'checkroom', 'watch', 'local_cafe', 'category', 'waving_hand', 'school', 'settings',
    'golf_course', 'badge', 'workspace_premium', 'breakfast_dining', 'lunch_dining', 'cake',
    'child_care', 'set_meal', 'grid_view', 'sell', 'coffee'
]

missing = [icon for icon in dynamic_to_check if icon not in all_defined]
print(f"Missing dynamic icons: {missing}")

