-- =====================================================================
-- Migrazione 006 — lettera facoltativa nel numero della fattura
--
-- Serve per un caso raro: un numero usato per errore due volte su
-- fatture già inviate e pagate (non si possono più rinumerare).
-- Esempio: la seconda 36/2026 viene registrata come 36A/2026.
--
--   number_suffix = ''   →  36/2026   (tutte le fatture normali)
--   number_suffix = 'A'  →  36A/2026
--
-- Le fatture nuove create dall'app hanno sempre la lettera vuota:
-- la numerazione normale non cambia.
--
-- Da eseguire UNA volta nel SQL Editor di Supabase (progetto reale).
-- Tutto in una transazione: se qualcosa va storto non cambia niente.
-- =====================================================================
begin;

-- la vista dei totali usa invoice_number: va tolta e ricreata
drop view if exists invoice_totals;

-- 1. nuova colonna: una sola lettera maiuscola, oppure vuota
alter table invoices
  add column if not exists number_suffix text not null default ''
    check (number_suffix ~ '^[A-Z]?$');

-- 2. il numero completo include la lettera: 36 + A + / + 2026
alter table invoices drop column invoice_number;
alter table invoices add column invoice_number text generated always as
  (sequence_number::text || number_suffix || '/' || year::text) stored;

-- 3. unicità: stesso anno e numero ammessi solo con lettere diverse
alter table invoices drop constraint if exists invoices_year_sequence_number_key;
alter table invoices add constraint invoices_year_sequence_suffix_key
  unique (year, sequence_number, number_suffix);

-- 4. la vista dei totali, identica a prima
create view invoice_totals
with (security_invoker = true) as
with sums as (
  select
    i.id,
    coalesce(sum(it.quantity * it.unit_price), 0) as subtotal,
    coalesce(sum(it.quantity * it.unit_price)
             filter (where it.gst_applicable), 0) as gst_base
  from invoices i
  left join invoice_items it on it.invoice_id = i.id
  group by i.id
)
select
  i.*,
  c.client_code,
  c.client_type,
  c.contact_name as client_name,
  round(s.subtotal, 2)::numeric(12,2) as subtotal,
  case when i.gst_included then i.gst_rate else 0 end as tax_rate,
  case when i.gst_included then round(s.gst_base * i.gst_rate / 100, 2)
       else 0 end::numeric(12,2) as tax_amount,
  (round(s.subtotal, 2)
   + case when i.gst_included then round(s.gst_base * i.gst_rate / 100, 2) else 0 end
   + i.other_amount)::numeric(12,2) as total
from invoices i
join sums s    on s.id = i.id
join clients c on c.id = i.client_id;

-- permessi della vista (come in schema-production.sql)
grant select on invoice_totals to authenticated;
revoke all on invoice_totals from anon;

commit;

-- Verifica: i numeri delle fatture esistenti devono essere invariati
select invoice_number, number_suffix from invoices order by year, sequence_number, number_suffix;
