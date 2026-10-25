// =====================================================================
// Programmi: SAH (Support at Home) e Private
//
// Ogni CLIENTE appartiene a un programma:
//   'sah'     → assistiti del programma governativo Support at Home
//   'private' → clienti privati e commerciali
//
// Ogni SERVIZIO indica a chi è destinato:
//   'sah' / 'private' → solo i clienti di quel programma
//   'all'             → tutti (es. il rimborso chilometrico)
//
// Usato dalle schede di Clients e Services & Rates e dal form fattura.
// =====================================================================

// Le due schede, nell'ordine in cui compaiono
export const PROGRAM_TABS = [
  { value: "sah", label: "SAH" },
  { value: "private", label: "Private" },
];

// Etichette e colori dei badge
export const PROGRAM_LABELS = { sah: "SAH", private: "Private", all: "All clients" };
export const PROGRAM_STYLES = {
  sah: "bg-teal-100 text-teal-800",
  private: "bg-amber-100 text-amber-800",
  all: "bg-gray-100 text-gray-700",
};

// Un servizio si può usare per un cliente di questo programma?
export function serviceFitsProgram(service, program) {
  return service.program === "all" || service.program === program;
}
