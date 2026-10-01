// =====================================================================
// makeInvoicePdf — crea il file PDF di una fattura nel browser.
//
// La libreria @react-pdf/renderer è pesante, quindi viene caricata
// SOLO quando serve (import dinamico): le altre pagine restano veloci.
// Restituisce un oggetto File pronto da condividere o scaricare.
// =====================================================================

// Formato predefinito del nome del file (modificabile in Settings)
export const DEFAULT_PDF_FILE_NAME = "{surname}_Inv_{number}_{client}";

// Segnaposto disponibili nel formato, con una breve spiegazione
export const PDF_NAME_PLACEHOLDERS = {
  "{surname}": "last word of the business / owner name",
  "{name}": "full business / owner name",
  "{number}": "invoice number, e.g. 54-2026",
  "{seq}": "invoice sequence only, e.g. 54",
  "{year}": "invoice year, e.g. 2026",
  "{client}": "client code, e.g. CLI003",
  "{client_name}": "client name",
  "{date}": "issue date, e.g. 2026-09-26",
};

// Applica il formato ai dati della fattura:
//   "{surname}_Inv_{number}_{client}" → "Acala_Inv_54-2026_CLI003"
// Senza estensione: serve anche come titolo della pagina di stampa.
export function invoiceFileBaseName(settings, invoice, client) {
  const ownerName = (settings?.owner_name ?? "").trim();
  const words = ownerName.split(/\s+/);
  const values = {
    "{surname}": words[words.length - 1] ?? "",
    "{name}": ownerName,
    "{number}": String(invoice.invoice_number ?? "").replace("/", "-"),
    "{seq}": String(invoice.sequence_number ?? ""),
    "{year}": String(invoice.year ?? ""),
    "{client}": client?.client_code ?? "",
    "{client_name}": client?.contact_name ?? "",
    "{date}": invoice.issue_date ?? "",
  };

  let name = settings?.pdf_file_name || DEFAULT_PDF_FILE_NAME;
  for (const [placeholder, value] of Object.entries(values)) {
    name = name.split(placeholder).join(value);
  }

  // Pulizia: niente caratteri vietati nei nomi dei file, spazi → "_"
  name = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.-]+|[_.-]+$/g, "")
    .slice(0, 120);

  // formato vuoto o tutto cancellato dalla pulizia → nome sicuro
  return name || `Invoice_${values["{number}"]}`;
}

export async function makeInvoicePdf({ settings, invoice, client, items }) {
  const [{ pdf }, { default: InvoicePdf }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/components/InvoicePdf"),
  ]);

  const blob = await pdf(
    <InvoicePdf settings={settings} invoice={invoice} client={client} items={items} />
  ).toBlob();

  const fileName = `${invoiceFileBaseName(settings, invoice, client)}.pdf`;
  return new File([blob], fileName, { type: "application/pdf" });
}
