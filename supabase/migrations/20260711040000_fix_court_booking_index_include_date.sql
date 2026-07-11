-- The court double-booking guard was keyed on (season_id, week, match_time, court)
-- with no date, so a Sunday-night match and a Monday-night match sharing a week
-- number, court, and time were treated as the same booking at the database level
-- and rejected as duplicates. Now that matches carry their own date, rebuild the
-- index to include it so different nights are correctly treated as different
-- bookings, while same-night double-bookings are still blocked.

drop index if exists public.matches_unique_court_booking;

create unique index matches_unique_court_booking
  on public.matches (season_id, week, match_time, court, date);
