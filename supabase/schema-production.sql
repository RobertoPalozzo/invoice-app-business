-- =====================================================================
-- Invoice App — PRODUCTION schema (database reale, SENZA dati di prova)
-- Generato da schema.sql togliendo la sezione "SAMPLE DATA".
-- Da eseguire UNA volta su un progetto Supabase nuovo e vuoto.
-- Dopo: creare l'utente in Authentication e compilare Settings nell'app.
-- =====================================================================

-- =====================================================================
-- Invoice App — database schema (Next.js + Supabase)
-- Version 4: clienti privati + tariffe personalizzate per cliente
-- e per assistito.
-- Nomi di tabelle, colonne e valori in inglese (visibili in classe);
-- commenti in italiano come promemoria.
--
-- Come usarlo: incollare tutto nel SQL Editor di Supabase ed eseguire
-- una volta sola, su un progetto nuovo e vuoto.
-- Gli importi sono sempre ESCLUSA GST; la GST viene calcolata a parte.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. SETTINGS — i dati dell'attività (una sola riga)
--    gst_registered: oggi FALSE. Quando diventerà TRUE, le NUOVE
--    fatture includeranno la GST e saranno intestate "Tax Invoice".
-- ---------------------------------------------------------------------
create table settings (
  id                   int primary key default 1 check (id = 1),  -- impone una sola riga
  owner_name           text not null,
  business_description text,                  -- es. "Cleaning & Aged Care Services"
  abn                  text,
  address              text,
  phone                text,
  email                text,
  bank_name            text,
  bank_account_name    text,
  bank_bsb             text,
  bank_account_number  text,
  gst_registered       boolean not null default false,
  gst_rate             numeric(5,2) not null default 10.00,
  payment_terms_days   int not null default 14,
  footer_message       text default 'Thank You For Your Business!',
  -- numero di partenza: "nel first_invoice_year parti almeno da first_invoice_number"
  -- (serve quando l'app si comincia a usare a metà anno)
  first_invoice_number int not null default 1 check (first_invoice_number >= 1),
  first_invoice_year   int
);


-- ---------------------------------------------------------------------
-- 2. CLIENTS — chi paga la fattura (riquadro "BILL TO")
--    client_type:
--      'company' → un'organizzazione che paga per più assistiti
--      'private' → una persona servita direttamente, che paga per sé.
--                  Per un cliente privato l'app crea in automatico
--                  anche un assistito con lo stesso nome e indirizzo.
-- ---------------------------------------------------------------------
create table clients (
  id             bigint generated always as identity primary key,
  client_code    text not null unique,         -- es. CLI003 (= "Customer ID")
  client_type    text not null default 'company'
                 check (client_type in ('company', 'private')),
  contact_name   text not null,                -- nome stampato in fattura
  company        text,                         -- vuoto per i privati
  address        text,
  phone          text,
  email          text,
  abn            text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. CARE_RECIPIENTS — le persone presso cui si svolge il servizio
--    Ogni assistito appartiene a un cliente.
--    ATTENZIONE: dati personali sensibili (nomi e indirizzi di casa).
-- ---------------------------------------------------------------------
create table care_recipients (
  id          bigint generated always as identity primary key,
  client_id   bigint not null references clients(id) on delete restrict,
  full_name   text not null,
  address     text,
  active      boolean not null default true
);

create index care_recipients_client_idx on care_recipients(client_id);


-- ---------------------------------------------------------------------
-- 4. SERVICES — catalogo delle prestazioni con tariffa di base
--    Anche il rimborso chilometrico è un servizio (unit = 'Km'),
--    così la sua tariffa si può personalizzare come le altre.
--    weekend_service_id: il servizio da usare al sabato e alla domenica
--    (es. "... Weekday" → "... Weekend"); il form cambia da solo.
-- ---------------------------------------------------------------------
create table services (
  id                 bigint generated always as identity primary key,
  description        text not null,                -- es. "SAH Individual social support Weekday"
  unit               text not null default 'hours',-- hours, Km...
  default_rate       numeric(10,2) not null,
  gst_applicable     boolean not null default true,
  active             boolean not null default true,
  weekend_service_id bigint references services(id) on delete set null,
  constraint services_weekend_not_self check (weekend_service_id <> id)
);


-- ---------------------------------------------------------------------
-- 5. RATES — tariffe personalizzate (sovrascrivono quella di base)
--    Ogni riga vale per UN servizio e per:
--      - un cliente intero  (client_id valorizzato), OPPURE
--      - un singolo assistito (care_recipient_id valorizzato).
--    Regola di priorità (vince la più specifica):
--      1. tariffa dell'assistito
--      2. tariffa del cliente/compagnia
--      3. default_rate del servizio
-- ---------------------------------------------------------------------
create table rates (
  id                bigint generated always as identity primary key,
  service_id        bigint not null references services(id) on delete cascade,
  client_id         bigint references clients(id) on delete cascade,
  care_recipient_id bigint references care_recipients(id) on delete cascade,
  rate              numeric(10,2) not null check (rate >= 0),
  notes             text,
  -- esattamente uno dei due deve essere valorizzato
  check ((client_id is null) <> (care_recipient_id is null))
);

-- una sola tariffa per combinazione servizio + cliente / servizio + assistito
create unique index rates_client_unique    on rates(service_id, client_id)         where client_id is not null;
create unique index rates_recipient_unique on rates(service_id, care_recipient_id) where care_recipient_id is not null;


-- ---------------------------------------------------------------------
-- 6. get_rate() — restituisce la tariffa giusta applicando la priorità
--    Dall'app si chiama così:
--      supabase.rpc('get_rate', { p_care_recipient_id: 5, p_service_id: 1 })
--    Il valore viene poi COPIATO in invoice_items.unit_price: se in
--    futuro una tariffa cambia, le fatture vecchie restano invariate.
-- ---------------------------------------------------------------------
create function get_rate(p_care_recipient_id bigint, p_service_id bigint)
returns numeric
language sql
stable
security invoker
as $$
  select coalesce(
    -- 1. tariffa specifica dell'assistito
    (select r.rate from rates r
      where r.care_recipient_id = p_care_recipient_id
        and r.service_id = p_service_id),
    -- 2. tariffa del cliente a cui appartiene l'assistito
    (select r.rate from rates r
       join care_recipients cr on cr.client_id = r.client_id
      where cr.id = p_care_recipient_id
        and r.service_id = p_service_id),
    -- 3. tariffa di base del servizio
    (select s.default_rate from services s where s.id = p_service_id)
  );
$$;


-- ---------------------------------------------------------------------
-- 7. INVOICES — una per cliente per periodo (di solito 1 settimana,
--    a volte 2: il periodo è libero, period_start → period_end)
--    Numero nel formato "53/2026": progressivo unico per tutti i
--    clienti, che riparte da 1 ogni anno solare (1 gennaio).
--    gst_included e gst_rate vengono COPIATI da settings alla
--    creazione: le fatture già emesse non cambiano mai.
-- ---------------------------------------------------------------------
create table invoices (
  id              bigint generated always as identity primary key,
  year            int not null,
  sequence_number int not null,
  invoice_number  text generated always as
                  (sequence_number::text || '/' || year::text) stored,
  client_id       bigint not null references clients(id) on delete restrict,
  issue_date      date not null default current_date,
  due_date        date,
  period_start    date,
  period_end      date,
  period_title    text,                        -- es. "SEPTEMBER 2026 (for the week from ...)"
  status          text not null default 'draft'
                  check (status in ('draft', 'sent', 'paid', 'void')),
  gst_included    boolean not null default false,
  gst_rate        numeric(5,2) not null default 0,
  other_amount    numeric(10,2) not null default 0,  -- riga "OTHER" del riepilogo
  comments        text,                        -- riquadro "OTHER COMMENTS"
  created_at      timestamptz not null default now(),
  unique (year, sequence_number),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create index invoices_client_idx on invoices(client_id);


-- ---------------------------------------------------------------------
-- 8. INVOICE_ITEMS — le righe della fattura
--    item_type 'service' → data, assistito, orario, ore @ tariffa
--    item_type 'mileage' → data, percorso, Km @ tariffa
--    item_type 'other'   → riga libera
--    unit_price viene proposto da get_rate() ma resta modificabile.
-- ---------------------------------------------------------------------
create table invoice_items (
  id                bigint generated always as identity primary key,
  invoice_id        bigint not null references invoices(id) on delete cascade,
  position          int not null default 1,    -- ordine delle righe
  item_type         text not null default 'service'
                    check (item_type in ('service', 'mileage', 'other')),
  service_date      date,
  care_recipient_id bigint references care_recipients(id) on delete restrict,
  service_id        bigint references services(id) on delete restrict,
  description       text not null,             -- copiata dal servizio, modificabile
  start_time        time,
  end_time          time,
  route             text,                      -- per i Km: "from ... to ... and back"
  quantity          numeric(10,2) not null check (quantity > 0),
  unit              text not null default 'hours',
  unit_price        numeric(10,2) not null check (unit_price >= 0),
  gst_applicable    boolean not null default true,
  check (end_time is null or start_time is null or end_time > start_time)
);

create index invoice_items_invoice_idx on invoice_items(invoice_id);


-- ---------------------------------------------------------------------
-- 9. INVOICE_TOTALS (vista) — totali calcolati, mai salvati
--    Produce SUBTOTAL, TAX RATE, TAX, OTHER, TOTAL come nel riepilogo.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- 10. SECURITY (Row Level Security)
--     Solo chi ha fatto login può leggere e scrivere.
-- ---------------------------------------------------------------------
alter table settings        enable row level security;
alter table clients         enable row level security;
alter table care_recipients enable row level security;
alter table services        enable row level security;
alter table rates           enable row level security;
alter table invoices        enable row level security;
alter table invoice_items   enable row level security;

create policy "Authenticated users only" on settings        for all to authenticated using (true) with check (true);
create policy "Authenticated users only" on clients         for all to authenticated using (true) with check (true);
create policy "Authenticated users only" on care_recipients for all to authenticated using (true) with check (true);
create policy "Authenticated users only" on services        for all to authenticated using (true) with check (true);
create policy "Authenticated users only" on rates           for all to authenticated using (true) with check (true);
create policy "Authenticated users only" on invoices        for all to authenticated using (true) with check (true);
create policy "Authenticated users only" on invoice_items   for all to authenticated using (true) with check (true);

-- la funzione è eseguibile solo da utenti loggati
revoke execute on function get_rate(bigint, bigint) from public, anon;
grant  execute on function get_rate(bigint, bigint) to authenticated;


-- ---------------------------------------------------------------------
-- PERMESSI ESPLICITI (Data API)
-- Il progetto è creato con "Automatically expose new tables" DISATTIVATO:
-- nessuna tabella è accessibile finché non lo diciamo qui.
-- I permessi vanno SOLO a "authenticated" (utenti con login), mai ad
-- "anon" (chi non ha fatto login). Le regole RLS restano il secondo
-- livello di protezione.
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated;

grant select, insert, update, delete on
  settings, clients, care_recipients, services, rates, invoices, invoice_items
  to authenticated;

-- la vista dei totali si può solo leggere
grant select on invoice_totals to authenticated;

-- per sicurezza: gli anonimi non hanno alcun accesso
revoke all on
  settings, clients, care_recipients, services, rates, invoices, invoice_items, invoice_totals
  from anon;
