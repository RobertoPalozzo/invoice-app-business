-- =====================================================================
-- TEST CLEANUP — remove test data while the app is still being tested
--
-- How to use (Supabase → SQL Editor → New query):
--   1. Copy ONLY the section you need (A, B, C or D) and click Run.
--   2. Each section runs inside a transaction (begin ... commit):
--      if something fails, nothing is deleted.
--
-- WARNING: deletions are permanent. Do NOT use this file once real
-- invoices have been sent to clients: from then on use VOID in the app.
--
-- Settings (business details, bank, GST, PDF name) are never touched.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A. Delete ONE invoice by its number (e.g. '3/2026')
--    Le righe (invoice_items) vengono eliminate in automatico (cascade).
-- ---------------------------------------------------------------------
begin;
delete from invoices where invoice_number = '3/2026';   -- ← change the number
commit;


-- ---------------------------------------------------------------------
-- B. Delete ALL invoices (clients, recipients, services and rates stay)
--    La numerazione ripartirà dal "first invoice number" in Settings.
-- ---------------------------------------------------------------------
begin;
delete from invoice_items;
delete from invoices;
commit;


-- ---------------------------------------------------------------------
-- C. Delete ONE client with everything linked to it
--    (its invoices, its care recipients and its custom rates)
-- ---------------------------------------------------------------------
begin;
-- prima le fatture del cliente (le righe seguono in cascade)
delete from invoices
 where client_id = (select id from clients where client_code = 'CLI003');   -- ← change the code
-- poi le tariffe legate ai suoi assistiti, gli assistiti e il cliente
delete from rates
 where care_recipient_id in (select id from care_recipients
                              where client_id = (select id from clients where client_code = 'CLI003'));
delete from care_recipients
 where client_id = (select id from clients where client_code = 'CLI003');
delete from clients where client_code = 'CLI003';   -- le sue tariffe spariscono in cascade
commit;


-- ---------------------------------------------------------------------
-- D. FULL RESET — empty everything except Settings
--    (invoices, clients, care recipients, services, rates)
-- ---------------------------------------------------------------------
begin;
delete from invoice_items;
delete from invoices;
delete from rates;
delete from care_recipients;
delete from clients;
update services set weekend_service_id = null;   -- scollega le versioni weekend
delete from services;
commit;


-- ---------------------------------------------------------------------
-- Check what is left
-- ---------------------------------------------------------------------
select 'invoices' as table_name, count(*) from invoices
union all select 'invoice_items', count(*) from invoice_items
union all select 'clients', count(*) from clients
union all select 'care_recipients', count(*) from care_recipients
union all select 'services', count(*) from services
union all select 'rates', count(*) from rates;
