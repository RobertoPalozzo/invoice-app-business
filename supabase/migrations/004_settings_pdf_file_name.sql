-- =====================================================================
-- Migrazione 004 — formato del nome del file PDF
--
-- Nuova impostazione: il nome dei PDF delle fatture, con segnaposto
-- che l'app sostituisce con i dati della fattura, es.
--   {surname}_Inv_{number}_{client}  →  Acala_Inv_54-2026_CLI003.pdf
--
-- Da eseguire UNA volta nel SQL Editor di Supabase, su OGNI progetto
-- che usa questa versione dell'app (quello reale e quello di prova).
-- Si può eseguire più volte senza problemi ("if not exists").
-- =====================================================================
alter table settings
  add column if not exists pdf_file_name text not null
    default '{surname}_Inv_{number}_{client}';

-- Verifica
select pdf_file_name from settings;
