"use client";
// =====================================================================
// Dettaglio fattura — ROUTE DINAMICA /invoices/[id]
//
// La cartella si chiama [id]: le parentesi quadre dicono a Next.js che
// quel pezzo dell'URL è variabile. Una sola pagina serve TUTTE le
// fatture: /invoices/1, /invoices/2, /invoices/57...
//
// I tre hook richiesti dal progetto lavorano insieme:
//   useParams → legge l'id dall'URL
//   useState  → conserva fattura, cliente, righe, caricamento, errore
//   useEffect → esegue le query quando la pagina si apre
//               e di nuovo se l'id cambia
// Tutti e tre funzionano solo in un Client Component → "use client".
// =====================================================================
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import {
  formatCurrency,
  formatDate,
  formatQuantity,
  formatTime,
  STATUS_STYLES,
} from "@/lib/format";

// Azioni disponibili per ogni stato (il "ciclo di vita" della fattura):
//   draft → sent → paid
//   una fattura inviata si può annullare (void) o riportare in bozza
const STATUS_ACTIONS = {
  draft: [{ label: "Mark as sent", next: "sent", primary: true }],
  sent: [
    { label: "Mark as paid", next: "paid", primary: true },
    { label: "Back to draft", next: "draft" },
    { label: "Void", next: "void", danger: true },
  ],
  paid: [{ label: "Mark as unpaid", next: "sent" }],
  void: [{ label: "Restore as draft", next: "draft" }],
};

export default function InvoiceDetailPage() {
  // 1. useParams: per /invoices/2 restituisce { id: "2" } (sempre stringa)
  const { id } = useParams();
  const router = useRouter();
  const [busy, setBusy] = useState(false); // true mentre un'azione è in corso
  const [actionError, setActionError] = useState(null);

  // 2. useState: un contenitore per ogni informazione della pagina
  const [invoice, setInvoice] = useState(null);
  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  // 3. useEffect: si attiva al caricamento e ogni volta che cambia "id"
  useEffect(() => {
    async function loadInvoice() {
      setLoading(true);
      setNotFound(false);
      setError(null);

      // L'id deve essere un numero intero positivo: /invoices/abc → "not found"
      if (!/^\d+$/.test(id)) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Query 1: la fattura con i totali già calcolati dalla vista
      // .eq("id", id) → WHERE id = <parametro dell'URL>
      const { data: invoiceData, error: invoiceError } = await supabase
        .from("invoice_totals")
        .select("*")
        .eq("id", id)
        .maybeSingle(); // nessuna riga → null invece di errore

      if (invoiceError) {
        setError(invoiceError.message);
        setLoading(false);
        return;
      }
      if (!invoiceData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Query 2 e 3 in parallelo: dati del cliente e righe della fattura.
      // care_recipients(full_name, address) aggiunge i dati dell'assistito
      // a ogni riga, seguendo la chiave esterna care_recipient_id (una "join").
      const [clientResult, itemsResult] = await Promise.all([
        supabase.from("clients").select("*").eq("id", invoiceData.client_id).single(),
        supabase
          .from("invoice_items")
          .select("*, care_recipients(full_name, address)")
          .eq("invoice_id", id)
          .order("position"),
      ]);

      if (clientResult.error || itemsResult.error) {
        setError((clientResult.error || itemsResult.error).message);
        setLoading(false);
        return;
      }

      setInvoice(invoiceData);
      setClient(clientResult.data);
      setItems(itemsResult.data);
      setLoading(false);
    }

    loadInvoice();
  }, [id]); // [id] = riesegui se l'utente passa a un'altra fattura

  // Cambia lo stato della fattura (UPDATE nel database)
  async function changeStatus(nextStatus) {
    if (nextStatus === "void" && !window.confirm("Void this invoice? It will no longer count in the totals.")) {
      return;
    }
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.from("invoices").update({ status: nextStatus }).eq("id", id);
    if (error) {
      setActionError(error.message);
    } else {
      // aggiorna solo lo stato locale: non serve ricaricare la pagina
      setInvoice((current) => ({ ...current, status: nextStatus }));
    }
    setBusy(false);
  }

  // Elimina una bozza (DELETE). Le righe si cancellano da sole grazie a
  // "on delete cascade" nello schema del database.
  async function deleteDraft() {
    if (!window.confirm(`Delete draft invoice ${invoice.invoice_number}? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setActionError(null);
    const { error } = await supabase.from("invoices").delete().eq("id", id).eq("status", "draft");
    if (error) {
      setActionError(error.message);
      setBusy(false);
      return;
    }
    router.push("/");
  }

  // ---------- Stati intermedi: caricamento, non trovata, errore ----------
  if (loading) {
    return <p className="text-gray-500">Loading invoice...</p>;
  }

  if (notFound) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900">Invoice not found</h1>
        <p className="text-gray-600">There is no invoice with ID “{id}”.</p>
        <Link href="/" className="text-blue-700 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  if (error) {
    return <p className="text-red-600">Could not load the invoice: {error}</p>;
  }

  // ---------- Pagina con i dati ----------
  return (
    <div className="space-y-6">
      {/* Intestazione: numero, stato, azioni */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">
          Invoice {invoice.invoice_number}
        </h1>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[invoice.status]}`}>
          {invoice.status}
        </span>
        <div className="ml-auto flex gap-2">
          <Link href="/" className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
            Back
          </Link>
          {/* link alla seconda route dinamica: /invoices/[id]/print */}
          <Link
            href={`/invoices/${invoice.id}/print`}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
          >
            Print preview
          </Link>
        </div>
      </div>

      {/* Avviso per le fatture annullate: restano in archivio ma non contano */}
      {invoice.status === "void" && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>This invoice has been voided.</strong> It is kept in the records so that invoice
          numbers have no gaps, but it is not counted in any totals. Use “Restore as draft” to reactivate it.
        </p>
      )}

      {/* Azioni sullo stato: cambiano in base allo stato attuale */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <span className="mr-2 text-sm text-gray-500">Actions:</span>
        {STATUS_ACTIONS[invoice.status].map((action) => (
          <button
            key={action.next}
            disabled={busy}
            onClick={() => changeStatus(action.next)}
            className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${
              action.primary
                ? "bg-blue-600 font-medium text-white hover:bg-blue-500"
                : action.danger
                ? "border border-red-300 text-red-700 hover:bg-red-50"
                : "border border-gray-300 text-gray-700 hover:bg-gray-100"
            }`}
          >
            {action.label}
          </button>
        ))}
        {invoice.status === "draft" && (
          <button
            disabled={busy}
            onClick={deleteDraft}
            className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Delete draft
          </button>
        )}
        {/* Modifica possibile solo per bozze e fatture inviate */}
        {(invoice.status === "draft" || invoice.status === "sent") && (
          <Link
            href={`/invoices/${invoice.id}/edit`}
            className={`${invoice.status === "draft" ? "" : "ml-auto"} rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100`}
          >
            Edit invoice
          </Link>
        )}
        {actionError && <p className="w-full text-sm text-red-600">{actionError}</p>}
      </div>

      {/* Riquadri: cliente e date */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Bill to</h2>
          <p className="font-medium text-gray-900">
            {/* link alla route dinamica del cliente: /clients/[id] */}
            <Link href={`/clients/${client.id}`} className="text-blue-700 hover:underline">
              {client.contact_name}
            </Link>
          </p>
          {client.company && <p className="text-xs text-gray-500">Works for {client.company} (not printed)</p>}
          {client.address && <p className="text-gray-700">{client.address}</p>}
          {client.phone && <p className="text-gray-700">Phone: {client.phone}</p>}
          {client.email && <p className="text-gray-700">Email: {client.email}</p>}
          <p className="mt-1 text-sm text-gray-500">
            Customer ID: {client.client_code} · {client.client_type}
          </p>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Details</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-gray-500">Issue date</dt>
            <dd>{formatDate(invoice.issue_date)}</dd>
            <dt className="text-gray-500">Due date</dt>
            <dd>{formatDate(invoice.due_date)}</dd>
            <dt className="text-gray-500">Period</dt>
            <dd>
              {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
            </dd>
            <dt className="text-gray-500">GST</dt>
            <dd>{invoice.gst_included ? `Included (${invoice.gst_rate}%)` : "Not registered"}</dd>
          </dl>
          {invoice.period_title && (
            <p className="mt-3 text-sm font-medium text-gray-900">{invoice.period_title}</p>
          )}
        </section>
      </div>

      {/* Righe della fattura */}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
              <th className="px-4 py-2 text-right font-medium">Rate</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-gray-100 align-top">
                <td className="whitespace-nowrap px-4 py-3">{formatDate(item.service_date)}</td>
                <td className="px-4 py-3">
                  {item.care_recipients && (
                    <p className="font-medium text-gray-900">
                      {item.care_recipients.full_name}
                      <span className="font-normal text-gray-500"> – {item.care_recipients.address}</span>
                    </p>
                  )}
                  <p className="text-gray-700">{item.description}</p>
                  {item.start_time && (
                    <p className="text-gray-500">
                      Time: {formatTime(item.start_time)} to {formatTime(item.end_time)}
                    </p>
                  )}
                  {item.route && <p className="text-gray-500">{item.route}</p>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {formatQuantity(item.quantity)} {item.unit}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {formatCurrency(item.unit_price)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                  {formatCurrency(item.quantity * item.unit_price)}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  This invoice has no lines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Totali: arrivano già calcolati dalla vista invoice_totals */}
      <section className="ml-auto w-full max-w-xs rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <dl className="grid grid-cols-2 gap-y-1">
          <dt className="text-gray-500">Subtotal</dt>
          <dd className="text-right">{formatCurrency(invoice.subtotal)}</dd>
          <dt className="text-gray-500">Tax rate</dt>
          <dd className="text-right">{Number(invoice.tax_rate).toFixed(1)}%</dd>
          <dt className="text-gray-500">Tax</dt>
          <dd className="text-right">{formatCurrency(invoice.tax_amount)}</dd>
          <dt className="text-gray-500">Other</dt>
          <dd className="text-right">{formatCurrency(invoice.other_amount)}</dd>
          <dt className="border-t border-gray-200 pt-2 font-semibold text-gray-900">Total</dt>
          <dd className="border-t border-gray-200 pt-2 text-right font-semibold text-gray-900">
            {formatCurrency(invoice.total)}
          </dd>
        </dl>
      </section>

      {invoice.comments && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Comments</h2>
          <p className="whitespace-pre-line text-gray-700">{invoice.comments}</p>
        </section>
      )}
    </div>
  );
}
