-- =====================================================================
-- Migrazione 005 — persona di riferimento del cliente (solo uso interno)
--
-- Nuovo campo "contact_person": il nome della persona dietro una
-- compagnia (es. "William Saad" per "W SAAD - Optimum Care Management").
-- Serve solo a riconoscere i clienti nell'app: NON viene stampato
-- sulla fattura né sul PDF.
--
-- Da eseguire UNA volta nel SQL Editor di Supabase, su OGNI progetto
-- che usa questa versione dell'app (quello reale e quello di prova).
-- Si può eseguire più volte senza problemi ("if not exists").
-- I dati esistenti non vengono toccati: la colonna parte vuota.
-- =====================================================================
alter table clients
  add column if not exists contact_person text;

-- Verifica
select client_code, contact_name, contact_person, company from clients order by client_code;
