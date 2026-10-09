// =====================================================================
// Data delle BOZZE: finché una fattura è "draft" la sua data di
// emissione segue il giorno corrente.
//
// Esempio: bozza creata il 5 ottobre, assistiti aggiunti fino al 7,
// inviata il 9 → aprendola il 9 la data diventa 9 ottobre.
// La scadenza si sposta degli stessi giorni (es. sempre +14).
//
// Quando la fattura viene segnata come "sent" la data si ferma lì.
// Viene chiamata dal dettaglio, dall'anteprima di stampa e dal form
// di modifica, così il PDF ha sempre la data giusta.
//
// Non sposta la data in un altro anno solare: il numero (es. 60/2026)
// è legato all'anno, e una fattura 60/2026 datata 2027 sarebbe sbagliata.
// =====================================================================
import { supabase } from "@/lib/supabaseClient";
import { addDays, daysBetween, todayISO } from "@/lib/dateHelpers";

// Le nuove date di una bozza, oppure null se non c'è niente da cambiare
export function draftDateChanges(invoice) {
  if (!invoice || invoice.status !== "draft") return null;

  const today = todayISO();
  if (invoice.issue_date === today) return null;
  if (Number(today.slice(0, 4)) !== invoice.year) return null;

  // la scadenza mantiene la stessa distanza dalla data di emissione
  const dueGap = invoice.due_date ? daysBetween(invoice.issue_date, invoice.due_date) : null;
  return {
    issue_date: today,
    due_date: dueGap === null ? null : addDays(today, dueGap),
  };
}

// Aggiorna le date nel database e restituisce la fattura con le date nuove.
// Se l'aggiornamento non riesce, restituisce la fattura così com'era.
export async function refreshDraftDates(invoice) {
  const changes = draftDateChanges(invoice);
  if (!changes) return invoice;

  const { error } = await supabase
    .from("invoices")
    .update(changes)
    .eq("id", invoice.id)
    .eq("status", "draft"); // sicurezza: non tocca mai fatture già inviate

  if (error) return invoice;
  return { ...invoice, ...changes };
}
