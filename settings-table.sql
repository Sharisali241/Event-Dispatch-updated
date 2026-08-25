-- =============================================================================
-- Phase 4.5 — Shared settings table for Happenings.co
-- Run this in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to run before or after rls-policies.sql, and safe to re-run.
--
-- Context: CATS (inventory categories), COST_COLS (finance columns), PACKAGES
-- (saved carts) and MEDIA_CATS (gallery categories) lived only in each browser's
-- localStorage. Two people using the app therefore saw different categories,
-- different finance columns and different packages, and a deletion on one device
-- never reached the other.
--
-- One row per setting, keyed by the same string the client used as its
-- localStorage key, so the two stay easy to correlate:
--   ev_cats | ev_cost_cols | ev_pkgs | ev_m_cats   (jsonb arrays)
--   ev_fin_p                                        (jsonb string)
--
-- ev_fin_p is the finance PIN, moved here by FIXES.md 2.3 so it stops differing
-- per browser. It is stored in clear text and readable by any signed-in user.
-- That is deliberate and matches what it always was: a speed bump that keeps
-- finance off the screen in passing, NOT an access control. Anything that must
-- actually be restricted needs its own table and its own policy.
-- =============================================================================

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- The client upserts with ?on_conflict=key, which needs the primary key above.
-- Keep updated_at honest on every write.
create or replace function public.settings_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists settings_touch_updated_at on public.settings;
create trigger settings_touch_updated_at
  before update on public.settings
  for each row execute function public.settings_touch_updated_at();

-- Same access rule as every other table: signed-in users only, anon nothing.
alter table public.settings enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'settings'
  loop
    execute format('drop policy %I on public.settings', r.policyname);
  end loop;
end $$;

create policy "authenticated full access" on public.settings
  for all to authenticated using (true) with check (true);

revoke all on public.settings from anon;
grant select, insert, update, delete on public.settings to authenticated;

-- =============================================================================
-- SEEDING — optional.
--
-- The client seeds this table on its own: the first time anyone edits a
-- category, cost column, package or media category, saveSetting() upserts the
-- whole array. Until a key exists here, each device keeps using its local copy,
-- so nothing breaks in the gap between running this script and the first edit.
--
-- To publish one device's current lists immediately instead, open the app on
-- the device whose lists are correct, open DevTools -> Console and run:
--
--   ["ev_cats","ev_cost_cols","ev_pkgs","ev_m_cats"].forEach(function (k) {
--     var v = localStorage.getItem(k);
--     if (v) saveSetting(k, JSON.parse(v));
--   });
--
-- The PIN is a string, not an array, so it seeds separately (readFinPin handles
-- both the old raw and the new JSON-encoded localStorage forms):
--
--   if (readFinPin()) saveSetting("ev_fin_p", readFinPin());
--
-- =============================================================================

-- =============================================================================
-- VERIFY
-- =============================================================================

select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'settings';

select policyname, roles, cmd from pg_policies
where schemaname = 'public' and tablename = 'settings';

select key,
       jsonb_typeof(value) as type,
       case when jsonb_typeof(value) = 'array'
            then jsonb_array_length(value)::text
            else '-' end as entries,
       updated_at
from public.settings order by key;
