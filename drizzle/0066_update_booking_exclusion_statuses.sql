CREATE OR REPLACE FUNCTION booking_time_range(req_date date, s_time time, e_time time)
RETURNS tsrange AS $$
BEGIN
  IF e_time <= s_time THEN
    RETURN tsrange((req_date + s_time)::timestamp, (req_date + INTERVAL '1 day' + e_time)::timestamp);
  ELSE
    RETURN tsrange((req_date + s_time)::timestamp, (req_date + e_time)::timestamp);
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_no_overlap;

ALTER TABLE booking_requests
ADD CONSTRAINT booking_requests_no_overlap
EXCLUDE USING gist (
  resource_id WITH =,
  booking_time_range(request_date, start_time, end_time) WITH &&
)
WHERE (status IN ('pending', 'approved', 'confirmed', 'checked_in') AND resource_id IS NOT NULL);

COMMENT ON CONSTRAINT booking_requests_no_overlap ON booking_requests IS
'Prevents overlapping bookings on the same resource. Handles cross-midnight bookings. Applies to active bookings (pending/approved/confirmed/checked_in). Attended bookings are excluded as they are immutable historical records.';
