"use client";
// =====================================================================
// Dashboard (/) — ultime fatture lette da Supabase.
// Schema tipico di ogni pagina dell'app:
//   1. useState  → contenitori per dati, caricamento ed errore
//   2. useEffect → al caricamento esegue la query
//   3. render    → loading / errore / lista vuota / dati
// =====================================================================
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { formatCurrency, formatDate, STATUS_STYLES } from "@/lib/format";

export default function DashboardPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadInvoices() {
      // invoice_totals è la vista che calcola subtotale, GST e totale
      const { data, error } = await supabase
        .from("invoice_totals")
        .select("id, invoice_number, client_name, client_code, issue_date, status, total")
        // stesso ordine della pagina Invoices: numero più alto in cima
        .order("year", { ascending: false })
        .order("sequence_number", { ascending: false })
        .order("number_suffix", { ascending: false })
        .limit(10);

      if (error) setError(error.message);
      else setInvoices(data);
      setLoading(false);
    }
    loadInvoices();
  }, []); // [] = esegui una sola volta, al primo caricamento

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <Link
          href="/invoices/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          New invoice
        </Link>
      </div>

      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 font-medium text-gray-900">
          Latest invoices
        </h2>

        {loading && <p className="px-4 py-6 text-gray-500">Loading invoices...</p>}

        {error && <p className="px-4 py-6 text-red-600">Could not load invoices: {error}</p>}

        {!loading && !error && invoices.length === 0 && (
          <p className="px-4 py-6 text-gray-500">No invoices yet.</p>
        )}

        {!loading && !error && invoices.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Invoice #</th>
                <th className="px-4 py-2 font-medium">Client</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    {/* link alla route dinamica /invoices/[id] */}
                    <Link href={`/invoices/${invoice.id}`} className="font-medium text-blue-700 hover:underline">
                      {invoice.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {invoice.client_name}{" "}
                    <span className="text-gray-400">({invoice.client_code})</span>
                  </td>
                  <td className="px-4 py-2">{formatDate(invoice.issue_date)}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[invoice.status]}`}>
                      {invoice.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatCurrency(invoice.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
