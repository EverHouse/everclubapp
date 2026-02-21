#!/usr/bin/env bash
#
# Ghost Column Guard
# ------------------
# Prevents queries from referencing columns that do NOT exist on
# booking_sessions or booking_participants tables.
#
# Known ghost columns:
#   - booking_sessions.booking_id        (does NOT exist)
#   - booking_sessions.booking_request_id (does NOT exist)
#   - booking_participants.booking_id     (does NOT exist)
#
# Correct join path:
#   booking_sessions.trackman_booking_id → booking_requests.trackman_booking_id
#
# Added after v7.95.0 fixed 6 bugs caused by these ghost references.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

ERRORS=0

check_pattern() {
  local pattern="$1"
  local description="$2"

  matches=$(grep -rn --include='*.ts' -E "$pattern" server/ 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo -e "${RED}FAIL:${NC} $description"
    echo "$matches"
    echo ""
    ERRORS=$((ERRORS + 1))
  fi
}

echo "Checking for ghost column references..."
echo ""

check_pattern \
  'booking_sessions\.(booking_id|booking_request_id)\b' \
  "booking_sessions.booking_id / booking_request_id — these columns do not exist"

check_pattern \
  '\bbs[0-9]*\.(booking_id|booking_request_id)\b' \
  "Aliased booking_sessions (bs/bs2) referencing ghost columns"

check_pattern \
  'booking_participants\.booking_id\b' \
  "booking_participants.booking_id — this column does not exist"

check_pattern \
  '\bbp[0-9]*\.booking_id\b' \
  "Aliased booking_participants (bp/bp2) referencing ghost booking_id"

if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}Found $ERRORS ghost column pattern(s).${NC}"
  echo "These columns do not exist. Use trackman_booking_id JOINs through booking_requests."
  echo "See v7.95.0 changelog for details."
  exit 1
fi

echo -e "${GREEN}No ghost column references found.${NC}"
exit 0
