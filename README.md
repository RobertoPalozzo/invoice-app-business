# Invoice App

A web app to create, store and print weekly invoices for a cleaning and aged care services business.

Built with **Next.js (App Router)** and **Supabase (Postgres)** for the *Build Advanced Interfaces* term break project.

## What it does

- Stores clients (companies and private clients), their care recipients and a catalogue of services
- Splits clients and services into two programs, **SAH** (Support at Home) and **Private**, each with its own tab; an invoice only offers the services of its client's program
- Applies the right rate automatically: care recipient rate → client rate → default rate
- Switches to the weekend version of a service (and its higher rate) on Saturdays and Sundays
- Creates weekly invoices with service lines (date, care recipient, time, hours) and mileage lines (route, Km)
- Calculates hours from start and end times, and subtotal, GST and total
- Blocks overlapping times, within the same invoice and across all invoices
- Copies last week's invoice to save typing
- New lines start with today's date (editable)
- Creates the invoice PDF in the app: share it (Mail, WhatsApp...), download it or print it
- PDF file name built from a format set in Settings, e.g. `Surname_Inv_54-2026_CLI003.pdf`
- Tracks the invoice status: draft → sent → paid (or void)
- Draft invoices take today's issue date until they are marked as sent
- Installable on iPhone and iPad ("Add to Home Screen")
- Ready for GST: one setting turns new invoices into "Tax Invoices"
- Filters invoices by status, client and Australian financial year (1 July – 30 June)

## Project structure

```
invoice-app/
├── README.md                          ← this file
├── docs/
│   ├── 01-project-plan.md             ← idea, pages, routes, requirements checklist
│   ├── 02-database-schema.md          ← tables, relationships, design decisions
│   ├── 03-presentation-guide.md       ← talk outline and live demo script
│   └── 04-going-live.md               ← publishing on Supabase + Netlify for real use
├── src/
│   ├── app/                           ← pages (App Router)
│   │   ├── page.js                    ← dashboard
│   │   ├── login/
│   │   ├── invoices/
│   │   │   ├── page.js                ← invoice list
│   │   │   ├── new/                   ← new invoice
│   │   │   └── [id]/                  ← invoice detail (dynamic)
│   │   │       ├── edit/              ← edit invoice (dynamic)
│   │   │       └── print/             ← A4 print preview (dynamic)
│   │   ├── clients/
│   │   │   ├── page.js                ← client list
│   │   │   └── [id]/                  ← client detail (dynamic)
│   │   ├── services/                  ← services and custom rates
│   │   └── settings/                  ← business details, GST, numbering
│   ├── components/
│   │   ├── AuthGuard.js               ← redirects to /login when signed out
│   │   ├── NavBar.js                  ← top menu
│   │   ├── InvoiceForm.js             ← shared form (new + edit)
│   │   ├── ProgramTabs.js             ← SAH / Private tabs
│   │   └── InvoicePdf.js              ← A4 invoice layout for the PDF
│   └── lib/
│       ├── supabaseClient.js          ← Supabase connection
│       ├── format.js                  ← currency, dates, times
│       ├── dateHelpers.js             ← periods, hours, weekends, financial year
│       ├── draftDates.js              ← keeps draft invoices dated today
│       ├── programs.js                ← SAH / Private programs
│       └── invoicePdf.js              ← builds the PDF file and its name
├── public/
└── supabase/
    ├── schema.sql                     ← full database with sample data (demo projects)
    ├── schema-production.sql          ← full database without sample data (real use)
    ├── test-cleanup.sql               ← removes test data (testing only)
    └── migrations/                    ← changes for an existing database
```

## Database setup

### New Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**, paste the schema and click **Run**:
   - `supabase/schema.sql` for a demo project (includes invented sample data)
   - `supabase/schema-production.sql` for real use (no sample data)
3. Go to **Authentication → Users → Add user**, create the login account and tick **Auto Confirm User**.

Both files already include every migration below.

### Existing project (created with an earlier schema)

Run the files in `supabase/migrations/` in order, once each:

| File | Change |
|------|--------|
| `001_invoice_number_full_year.sql` | Invoice numbers as `53/2026` instead of `53/26` |
| `002_settings_first_invoice_number.sql` | Starting invoice number in Settings |
| `003_weekend_services.sql` | Weekend version of services |
| `004_settings_pdf_file_name.sql` | PDF file name format in Settings |
| `005_clients_contact_person.sql` | Client contact person (internal only, not printed) |
| `006_invoice_number_suffix.sql` | Optional letter in the invoice number, e.g. `36A/2026` |
| `007_client_service_program.sql` | SAH / Private program for clients and services |

## Environment variables

Create `.env.local` in the project root (it is never committed):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The URL ends at `.supabase.co` (no `/rest/v1`). Use the **publishable** key, never the secret key.

## Run locally

```bash
npm install      # first time only
npm run dev      # open http://localhost:3000
```

## Tech stack

| Item      | Choice                         |
|-----------|--------------------------------|
| Framework | Next.js 16 (App Router)        |
| Database  | Supabase (Postgres)            |
| Auth      | Supabase Auth (email/password) |
| Security  | Row Level Security             |
| Language  | JavaScript                     |
| Styling   | Tailwind CSS                   |
| PDF       | @react-pdf/renderer (in the browser) |
| Hosting   | Netlify (`production` branch)  |

## Data and privacy

The repository contains **invented sample data only**. Real client and care recipient data lives only in the Supabase database, protected by login and Row Level Security.
