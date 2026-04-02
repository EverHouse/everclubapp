import sys

content = open('server/core/integrity/bookingChecks.ts').read()

# 1. Imports
marker1 = '  StuckUnpaidBookingRow,\n<<<<<<< HEAD\n  OvercapacitySessionRow,\n=======\n  SessionOverlapRow,\n  WellnessBlockGapRow,\n>>>>>>> 264e0190 (Task #374: Integrity check for session overlaps across all resource types)'
resolved1 = '  StuckUnpaidBookingRow,\n  OvercapacitySessionRow,\n  SessionOverlapRow,\n  WellnessBlockGapRow,'
if marker1 in content:
    content = content.replace(marker1, resolved1)
    print("Resolved imports")
else:
    print("Failed to find marker1")

# 2. Main functions block
# We'll use a more flexible approach for the large block since string matching is failing.
# Actually, I will try to just find the markers and remove them while keeping the content.

import re

# Resolve:
# <<<<<<< HEAD
# capacity function
# =======
# overlaps function
# >>>>>>> task374
# description: `Failed to check ... ${getErrorMessage(error)}`,
# suggestion: ...

# This is complex because of the multiple nested markers.
# Let's do it step by step with regex or simple replaces.

content = content.replace('<<<<<<< HEAD\nexport async function checkSessionsExceedingResourceCapacity()', 'export async function checkSessionsExceedingResourceCapacity()')
content = content.replace('      checkName: \'Sessions Exceeding Resource Capacity\',\n=======', '      checkName: \'Sessions Exceeding Resource Capacity\',')
content = content.replace('>>>>>>> 264e0190 (Task #374: Integrity check for session overlaps across all resource types)\n      status: \'warning\'', '      status: \'warning\'')
content = content.replace('<<<<<<< HEAD\n        description: `Failed to check sessions exceeding resource capacity: ${getErrorMessage(error)}`,', '        description: `Failed to check sessions exceeding resource capacity: ${getErrorMessage(error)}`,')
content = content.replace('=======\n        description: `Failed to check session overlaps: ${getErrorMessage(error)}`,', '        description: `Failed to check session overlaps: ${getErrorMessage(error)}`,')
content = content.replace('>>>>>>> 264e0190 (Task #374: Integrity check for session overlaps across all resource types)\n        suggestion:', '        suggestion:')
content = content.replace('<<<<<<< HEAD\n=======\n\n  return {', '  return {')
content = content.replace('  }\n>>>>>>> 264e0190 (Task #374: Integrity check for session overlaps across all resource types)\n}', '  }\n}')

open('server/core/integrity/bookingChecks.ts', 'w').write(content)
