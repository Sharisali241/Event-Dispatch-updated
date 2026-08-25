-- =============================================================================
-- Phase 0 — Row Level Security for Happenings.co
-- Run this in the Supabase dashboard: SQL Editor -> New query -> Run.
--
-- Context: as audited on 2026-08-23, the anon (public) role could SELECT every
-- row of all five tables and held UPDATE/DELETE grants on them. The anon key is
-- committed in a public repo, so this made all client data world-readable.
--
-- This app has no per-user ownership column -- it is a single shared team
-- workspace where every signed-in user sees all data. So the rule is simply:
--   authenticated  -> full access
--   anon           -> nothing
-- =============================================================================

-- 1. Turn RLS on. Until a policy grants access, this denies everything.
alter table public.bookings  enable row level security;
alter table public.inventory enable row level security;
alter table public.staff     enable row level security;
alter table public.media     enable row level security;
alter table public.tasks     enable row level security;

-- 2. Drop any pre-existing permissive policies so this script is idempotent
--    and so a leftover "allow all" policy cannot keep anon alive.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('bookings','inventory','staff','media','tasks')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 3. Grant full access to signed-in users only.
--    `to authenticated` is what makes this work with the access token that
--    db() now sends; a request bearing only the anon key matches no policy.
create policy "authenticated full access" on public.bookings
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on public.inventory
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on public.staff
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on public.media
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on public.tasks
  for all to authenticated using (true) with check (true);

-- 4. Belt and braces: remove the table-level grants the anon role still holds.
--    RLS alone would already block it, but this closes the hole at both layers.
revoke all on public.bookings, public.inventory, public.staff, public.media, public.tasks
  from anon;

grant select, insert, update, delete
  on public.bookings, public.inventory, public.staff, public.media, public.tasks
  to authenticated;

-- =============================================================================
-- VERIFY -- both of these should show the lockdown took effect.
-- =============================================================================

-- Every table should read rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('bookings','inventory','staff','media','tasks')
order by tablename;

-- Every policy should list roles = {authenticated}, and there should be
-- exactly one row per table.
select tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('bookings','inventory','staff','media','tasks')
order by tablename;
