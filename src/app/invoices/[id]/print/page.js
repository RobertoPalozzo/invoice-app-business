"use client";
// =====================================================================
// Anteprima di stampa — ROUTE DINAMICA /invoices/[id]/print
//
// Seconda route dinamica, annidata dentro [id]: la cartella "print"
// sta dentro "[id]", quindi l'id arriva sempre da useParams.
//
// Impaginazione copiata dalle fatture reali (formato A4).
// Tre modi per ottenere il PDF:
//   - "Share PDF": crea il file e apre il menu Condividi del telefono/iPad
//     (Mail, Gmail, Salva su File, WhatsApp...) con il PDF già allegato
//   - "Download PDF": scarica il file (comodo sul computer)
//   - "Print": la finestra di stampa del browser
// Le classi "print:hidden" nascondono menu e pulsanti nella stampa.
// =====================================================================
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { invoiceFileBaseName, makeInvoicePdf } from "@/lib/invoicePdf";
import {
  formatCurrency,
  formatDate,
  lineHeading,
  formatQuantity,
  formatTime,
  withFullStop,
} from "@/lib/format";

export default function InvoicePrintPage() {
  const { id } = useParams();

  const [settings, setSettings] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [client, setClient] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  // Il file PDF, preparato in anticipo appena i dati sono pronti.
  // Va creato PRIMA del tocco sul pulsante: su iPhone/iPad il menu
  // Condividi si apre solo se parte subito dal tocco dell'utente.
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfError, setPdfError] = useState(null);
  const [shareMessage, setShareMessage] = useState(null);

  // Carica i dati quando la pagina si apre o cambia l'id
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setNotFound(false);
      setError(null);

      if (!/^\d+$/.test(id)) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Dati dell'attività (intestazione e coordinate bancarie) + fattura
      const [settingsResult, invoiceResult] = await Promise.all([
        supabase.from("settings").select("*").maybeSingle(),
        supabase.from("invoice_totals").select("*").eq("id", id).maybeSingle(),
      ]);

      if (settingsResult.error || invoiceResult.error) {
        setError((settingsResult.error || invoiceResult.error).message);
        setLoading(false);
        return;
      }
      if (!invoiceResult.data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const [clientResult, itemsResult] = await Promise.all([
        supabase.from("clients").select("*").eq("id", invoiceResult.data.client_id).single(),
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

      setSettings(settingsResult.data);
      setInvoice(invoiceResult.data);
      setClient(clientResult.data);
      setItems(itemsResult.data);
      setLoading(false);
    }

    loadData();
  }, [id]);

  // Secondo useEffect: il titolo della scheda diventa il nome proposto
  // quando si usa "Print → Salva come PDF", es. "Acala_Inv_54-2026_CLI003"
  useEffect(() => {
    if (invoice && client) {
      document.title = invoiceFileBaseName(settings, invoice, client);
    }
    return () => {
      document.title = "Invoice App";
    };
  }, [settings, invoice, client]);

  // Terzo useEffect: quando i dati sono pronti, genera il PDF
  useEffect(() => {
    if (!invoice || !client) return;
    let cancelled = false; // evita aggiornamenti se si cambia pagina nel frattempo

    async function preparePdf() {
      try {
        const file = await makeInvoicePdf({ settings, invoice, client, items });
        if (!cancelled) setPdfFile(file);
      } catch (err) {
        if (!cancelled) setPdfError(err.message);
      }
    }
    preparePdf();

    return () => {
      cancelled = true;
    };
  }, [settings, invoice, client, items]);

  // Apre il menu Condividi di iOS/Android con il PDF allegato.
  // Se il browser non lo permette (es. alcuni computer), scarica il file.
  // Testo dell'email. Il periodo "SEPTEMBER 2026 (for the week ...)" va a capo
  // prima della parentesi, così il messaggio resta leggibile.
  function emailText() {
    const period = (invoice.period_title ?? "").trim();
    const cut = period.indexOf(" (");
    const periodLines = !period
      ? ""
      : cut > 0
      ? ` - ${period.slice(0, cut)}\n${period.slice(cut + 1)}`
      : ` - ${period}`;
    const signature = [
      settings?.owner_name,
      settings?.phone && `Mobile: ${settings.phone}`,
      settings?.email && `Email: ${settings.email}`,
    ]
      .filter(Boolean)
      .join("\n");
    return (
      `Hi,\nplease find attached invoice ${invoice.invoice_number}${periodLines}` +
      `${periodLines.endsWith(".") ? "" : "."}\n\nKind regards,\n\n${signature}`
    );
  }

  // Il menu Condividi non permette di indicare il destinatario:
  // copiamo l'email del cliente negli appunti, da incollare nel campo "A:".
  function copyClientEmail() {
    if (!client?.email || !navigator.clipboard) return false;
    navigator.clipboard.writeText(client.email).catch(() => {});
    return true;
  }

  async function sharePdf() {
    setShareMessage(null);
    if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
      // niente "await" prima di share(): Safari vuole share() subito dopo il tocco
      const copied = copyClientEmail();
      if (copied) setShareMessage(`${client.email} copied — paste it in the "To" field of the email.`);
      try {
        await navigator.share({
          files: [pdfFile],
          title: `Invoice ${invoice.invoice_number}`,
          // \r\n: alcune app (es. Gmail su iPad) gestiscono meglio questo "a capo"
          text: emailText().replace(/\n/g, "\r\n"),
        });
      } catch (err) {
        // AbortError = l'utente ha chiuso il menu: non è un errore
        if (err.name !== "AbortError") setShareMessage(`Could not share: ${err.message}`);
      }
    } else {
      downloadPdf();
      setShareMessage("Sharing is not available in this browser, so the PDF was downloaded instead.");
    }
  }

  // Gmail su iPad mette il testo condiviso tutto su una riga:
  // copiando il messaggio e incollandolo, gli "a capo" restano.
  function handleCopyMessage() {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(emailText())
      .then(() => setShareMessage("Message copied — paste it in the body of the email."))
      .catch(() => setShareMessage("Could not copy the message."));
  }

  function handleCopyEmail() {
    if (copyClientEmail()) setShareMessage(`${client.email} copied.`);
  }

  // Scarica il PDF con il suo nome (es. Invoice_54-2026_CLI003.pdf)
  function downloadPdf() {
    const url = URL.createObjectURL(pdfFile);
    const link = document.createElement("a");
    link.href = url;
    link.download = pdfFile.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  if (loading) return <p className="text-gray-500">Loading invoice...</p>;

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

  if (error) return <p className="text-red-600">Could not load the invoice: {error}</p>;

  // Con GST attiva la fattura diventa "Tax Invoice"
  const title = invoice.gst_included ? "TAX INVOICE" : "INVOICE";
  const business = settings ?? {};

  return (
    <div className="space-y-4">
      {/* Barra degli strumenti: visibile solo a schermo */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link
          href={`/invoices/${invoice.id}`}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
        >
          ← Back to invoice
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          {/* finché il PDF non è pronto, i pulsanti mostrano "Preparing PDF..." */}
          <button
            onClick={sharePdf}
            disabled={!pdfFile}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {pdfFile ? "Share PDF / Email" : "Preparing PDF..."}
          </button>
          <button
            onClick={downloadPdf}
            disabled={!pdfFile}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Download PDF
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
          >
            Print
          </button>
        </div>
        {/* destinatario: l'email del cliente, con pulsante per copiarla */}
        <p className="w-full text-sm text-gray-600">
          To:{" "}
          {client?.email ? (
            <>
              <span className="font-medium text-gray-900">{client.email}</span>{" "}
              <button onClick={handleCopyEmail} className="ml-1 text-blue-600 hover:underline">
                Copy
              </button>
            </>
          ) : (
            <span className="italic">no email saved for this client</span>
          )}
        </p>
        <p className="w-full text-sm text-gray-600">
          Message:{" "}
          <button onClick={handleCopyMessage} className="text-blue-600 hover:underline">
            Copy message
          </button>{" "}
          <span className="text-xs text-gray-500">(use it if the text arrives on one line, e.g. in Gmail)</span>
        </p>
        {pdfError && <p className="w-full text-sm text-red-600">Could not create the PDF: {pdfError}</p>}
        {shareMessage && <p className="w-full text-sm text-gray-600">{shareMessage}</p>}
      </div>

      {/* Il "foglio" A4. Il contenitore esterno permette lo scorrimento
          orizzontale su schermi stretti (il foglio è largo 210 mm). */}
      <div className="overflow-x-auto pb-4 print:overflow-visible print:pb-0">
      <article className="invoice-sheet mx-auto flex flex-col bg-white text-[13px] leading-snug text-gray-900 shadow-sm ring-1 ring-gray-200 print:shadow-none print:ring-0">
        {/* Fattura annullata: grande scritta diagonale, anche nel PDF */}
        {invoice.status === "void" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <span className="-rotate-[30deg] select-none text-[120px] font-black tracking-widest text-red-600/20">
              VOID
            </span>
          </div>
        )}
        {/* Intestazione: attività a sinistra, titolo e numeri a destra */}
        <header className="flex justify-between gap-8">
          <div>
            <p className="text-2xl font-bold">{business.owner_name}</p>
            {business.business_description && (
              <p className="font-semibold uppercase tracking-wide text-gray-600">
                {business.business_description}
              </p>
            )}
            {business.abn && <p>A.B.N. {business.abn}</p>}
            {business.address && <p className="mt-2">{business.address}</p>}
            {business.phone && <p>Mobile: {business.phone}</p>}
          </div>

          <div className="text-right">
            <p className="text-3xl font-bold tracking-wide text-gray-700">{title}</p>
            <table className="ml-auto mt-3 text-left">
              <tbody>
                <tr>
                  <td className="pr-3 font-semibold">DATE:</td>
                  <td>{formatDate(invoice.issue_date)}</td>
                </tr>
                <tr>
                  <td className="pr-3 font-semibold">INVOICE #</td>
                  <td>{invoice.invoice_number}</td>
                </tr>
                <tr>
                  <td className="pr-3 font-semibold">Customer ID</td>
                  <td>{client.client_code}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </header>

        {/* BILL TO */}
        <section className="mt-8">
          <p className="mb-1 inline-block bg-gray-800 px-2 py-0.5 text-xs font-bold text-white">BILL TO:</p>
          <p className="font-semibold">{client.contact_name}</p>
          {client.company && <p>{client.company}</p>}
          {client.address && <p>{client.address}</p>}
          {client.phone && <p>Phone: {client.phone}</p>}
          {client.email && <p>email: {client.email}</p>}
          {client.abn && <p>ABN: {client.abn}</p>}
        </section>

        {invoice.period_title && (
          <p className="mt-6 font-semibold">{invoice.period_title}</p>
        )}

        {/* Righe: DESCRIPTION | AMOUNT */}
        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="bg-gray-800 text-xs text-white">
              <th className="px-2 py-1 text-left font-bold">DESCRIPTION</th>
              <th className="w-28 px-2 py-1 text-right font-bold">RATE</th>
              <th className="w-24 px-2 py-1 text-right font-bold">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="break-inside-avoid border-b border-gray-200 align-top">
                <td className="px-2 py-2">
                  {/* prima riga in grassetto: "22.09 – Nome - Indirizzo" o "22.09 – percorso km" */}
                  {lineHeading(item) && <p className="font-semibold">{lineHeading(item)}</p>}
                  <p>{withFullStop(item.description)}</p>
                  {item.start_time && (
                    <p>
                      Time: {formatTime(item.start_time)} to {formatTime(item.end_time)}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  {formatQuantity(item.quantity)} {item.unit} @ {formatCurrency(item.unit_price)}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  {formatCurrency(item.quantity * item.unit_price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* In basso: commenti/pagamento a sinistra, totali a destra */}
        <section className="mt-6 flex break-inside-avoid justify-between gap-8">
          <div className="max-w-sm flex-1 border border-gray-300">
            <p className="bg-gray-800 px-2 py-0.5 text-xs font-bold text-white">OTHER COMMENTS</p>
            <div className="space-y-1 p-2">
              {invoice.comments && <p className="whitespace-pre-line">{invoice.comments}</p>}
              <p>Please EFT funds into:</p>
              <p>
                {business.bank_name} BSB: {business.bank_bsb} Acct: {business.bank_account_number}
              </p>
              <p>{business.bank_account_name}</p>
              <p className="pt-1 font-semibold">
                Terms: {business.payment_terms_days ?? 14} Days Payment
              </p>
            </div>
          </div>

          <table className="w-56 self-start">
            <tbody>
              <tr>
                <td className="py-0.5">SUBTOTAL</td>
                <td className="py-0.5 text-right">{formatCurrency(invoice.subtotal)}</td>
              </tr>
              <tr>
                <td className="py-0.5">TAX RATE</td>
                <td className="py-0.5 text-right">{Number(invoice.tax_rate).toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="py-0.5">TAX</td>
                <td className="py-0.5 text-right">{formatCurrency(invoice.tax_amount)}</td>
              </tr>
              <tr>
                <td className="py-0.5">OTHER</td>
                <td className="py-0.5 text-right">{formatCurrency(invoice.other_amount)}</td>
              </tr>
              <tr className="border-t-2 border-gray-800 text-base font-bold">
                <td className="pt-1">TOTAL</td>
                <td className="pt-1 text-right">{formatCurrency(invoice.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Piè di pagina: mt-auto lo spinge in fondo al foglio A4 */}
        <footer className="mt-auto pt-10 text-center">
          <p>If you have any questions about this invoice, please contact</p>
          <p>{business.email}</p>
          <p className="mt-2 font-bold italic">{business.footer_message}</p>
        </footer>
      </article>
      </div>
    </div>
  );
}
