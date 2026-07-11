-- Add a per-match date so a single week can contain matches on more than one
-- calendar date (e.g. Sunday-night and Monday-night divisions sharing a week
-- number). Existing matches are backfilled from their week's current
-- schedule_weeks.week_date so nothing already scheduled loses its date.

alter table public.matches
  add column if not exists date date;

update public.matches m
set date = sw.week_date
from public.schedule_weeks sw
where sw.season_id = m.season_id
  and sw.week = m.week
  and m.date is null
  and sw.week_date is not null;
