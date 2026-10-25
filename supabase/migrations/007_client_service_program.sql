-- =====================================================================
-- Migrazione 007 — programma dei clienti e dei servizi: SAH o Private
--
-- I clienti si dividono in due gruppi:
--   'sah'     → assistiti del programma Support at Home
--               (es. quelli seguiti per Stone Community Care)
--   'private' → clienti privati e commerciali
--
-- Anche ogni servizio indica a chi è destinato:
--   'sah'     → solo clienti SAH      (es. "SAH General house cleaning – Weekday")
--   'private' → solo clienti privati  (es. pulizia uffici)
--   'all'     → tutti i clienti       (es. "Mileage reimbursement")
--
-- Nel form della fattura ogni cliente vede solo i servizi del suo
-- programma più quelli 'all'. Le fatture già emesse non cambiano.
--
-- Assegnazione iniziale (poi si corregge dall'app, cliente per cliente):
--   - clienti con "Stone Community" in "Works for"  → 'sah'
--   - servizi con "SAH" nel nome                   → 'sah'
--   - servizi in Km                                 → 'all'
--   - tutto il resto                                → 'private'
--
-- Da eseguire UNA volta nel SQL Editor di Supabase, su OGNI progetto
-- che usa questa versione dell'app (prima quello demo, poi quello reale).
-- Si può eseguire più volte: le assegnazioni iniziali toccano solo le
-- righe appena create (la prima volta), non quelle già corrette a mano.
-- =====================================================================
begin;

-- 1. Le due colonne nuove (se esistono già non succede niente)
alter table clients
  add column if not exists program text;
alter table services
  add column if not exists program text;

-- 2. Assegnazione iniziale, solo dove il programma è ancora vuoto
update clients
   set program = case when company ilike '%stone community%' then 'sah' else 'private' end
 where program is null;

update services
   set program = case
                   when description ~ '\mSAH\M'    then 'sah'  -- la parola SAH, in qualsiasi punto
                   when lower(trim(unit)) = 'km'      then 'all'
                   else 'private'
                 end
 where program is null;

-- 3. Ora le colonne sono sempre piene: valore predefinito e controllo
alter table clients
  alter column program set default 'private',
  alter column program set not null;
alter table clients
  drop constraint if exists clients_program_check,
  add constraint clients_program_check check (program in ('sah', 'private'));

alter table services
  alter column program set default 'private',
  alter column program set not null;
alter table services
  drop constraint if exists services_program_check,
  add constraint services_program_check check (program in ('sah', 'private', 'all'));

commit;

-- Controllo: come sono stati divisi clienti e servizi
select 'client' as kind, client_code as code, contact_name as name, program from clients
union all
select 'service', id::text, description, program from services
order by kind, program, code;
