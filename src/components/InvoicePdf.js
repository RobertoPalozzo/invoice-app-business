// =====================================================================
// InvoicePdf — la fattura come VERO file PDF (libreria @react-pdf/renderer)
//
// Stessa impaginazione della pagina di stampa, ma disegnata con i
// componenti di react-pdf (Document, Page, View, Text) invece che in HTML.
// Il risultato è un file PDF che si può condividere o scaricare,
// senza passare dalla finestra di stampa del browser (utile su iPad).
//
// Le misure sono in punti tipografici (pt): 1 mm ≈ 2,83 pt.
// =====================================================================
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { formatCurrency, formatDate, formatQuantity, formatTime, lineHeading, withFullStop } from "@/lib/format";

const DARK = "#1f2937";
const GREY = "#4b5563";
const LINE = "#d1d5db";

const styles = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 42, paddingHorizontal: 42, fontSize: 9.5, color: "#111827", fontFamily: "Helvetica" },

  // intestazione
  header: { flexDirection: "row", justifyContent: "space-between" },
  owner: { fontSize: 17, fontFamily: "Helvetica-Bold" },
  description: { fontFamily: "Helvetica-Bold", color: GREY, textTransform: "uppercase", marginTop: 2 },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", color: "#374151", textAlign: "right" },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 2 },
  metaLabel: { fontFamily: "Helvetica-Bold", width: 70 },
  metaValue: { width: 60 },

  // etichette scure (BILL TO, DESCRIPTION, OTHER COMMENTS)
  darkLabel: { backgroundColor: DARK, color: "white", fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 2, paddingHorizontal: 5 },

  // righe
  tableHeader: { flexDirection: "row", backgroundColor: DARK, color: "white", fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 3, paddingHorizontal: 5, marginTop: 6 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 5, paddingHorizontal: 5 },
  colDesc: { flex: 1, paddingRight: 8 },
  colRate: { width: 110, textAlign: "right" },
  colAmount: { width: 70, textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },

  // fondo: commenti + totali
  bottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 },
  commentsBox: { width: 250, borderWidth: 0.5, borderColor: LINE },
  commentsBody: { padding: 6, gap: 1 },
  totals: { width: 170 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  grandTotal: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: DARK, marginTop: 3, paddingTop: 4, fontSize: 12, fontFamily: "Helvetica-Bold" },

  // piè di pagina, sempre in fondo al foglio
  footer: { position: "absolute", bottom: 42, left: 42, right: 42, textAlign: "center" },

  // scritta VOID per le fatture annullate
  watermark: { position: "absolute", top: 330, left: 60, fontSize: 110, color: "#dc2626", opacity: 0.15, fontFamily: "Helvetica-Bold", transform: "rotate(-30deg)" },
});

export default function InvoicePdf({ settings, invoice, client, items }) {
  const business = settings ?? {};
  const title = invoice.gst_included ? "TAX INVOICE" : "INVOICE";

  return (
    <Document title={`Invoice ${invoice.invoice_number}`} author={business.owner_name ?? ""}>
      <Page size="A4" style={styles.page}>
        {invoice.status === "void" && <Text style={styles.watermark}>VOID</Text>}

        {/* Intestazione */}
        <View style={styles.header}>
          <View>
            <Text style={styles.owner}>{business.owner_name}</Text>
            {business.business_description ? <Text style={styles.description}>{business.business_description}</Text> : null}
            {business.abn ? <Text>A.B.N. {business.abn}</Text> : null}
            {business.address ? <Text style={{ marginTop: 6 }}>{business.address}</Text> : null}
            {business.phone ? <Text>Mobile: {business.phone}</Text> : null}
          </View>
          <View>
            <Text style={styles.title}>{title}</Text>
            <View style={[styles.metaRow, { marginTop: 8 }]}>
              <Text style={styles.metaLabel}>DATE:</Text>
              <Text style={styles.metaValue}>{formatDate(invoice.issue_date)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>INVOICE #</Text>
              <Text style={styles.metaValue}>{invoice.invoice_number}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Customer ID</Text>
              <Text style={styles.metaValue}>{client.client_code}</Text>
            </View>
          </View>
        </View>

        {/* BILL TO */}
        <View style={{ marginTop: 22 }}>
          <Text style={[styles.darkLabel, { alignSelf: "flex-start", marginBottom: 3 }]}>BILL TO:</Text>
          <Text style={styles.bold}>{client.contact_name}</Text>
          {client.address ? <Text>{client.address}</Text> : null}
          {client.phone ? <Text>Phone: {client.phone}</Text> : null}
          {client.email ? <Text>email: {client.email}</Text> : null}
          {client.abn ? <Text>ABN: {client.abn}</Text> : null}
        </View>

        {invoice.period_title ? <Text style={[styles.bold, { marginTop: 16 }]}>{invoice.period_title}</Text> : null}

        {/* Righe */}
        <View style={styles.tableHeader}>
          <Text style={styles.colDesc}>DESCRIPTION</Text>
          <Text style={styles.colRate}>RATE</Text>
          <Text style={styles.colAmount}>AMOUNT</Text>
        </View>
        {items.map((item) => (
          <View key={item.id} style={styles.row} wrap={false}>
            <View style={styles.colDesc}>
              {/* prima riga in grassetto, stesso schema della pagina di stampa */}
              {lineHeading(item) ? <Text style={styles.bold}>{lineHeading(item)}</Text> : null}
              <Text>{withFullStop(item.description)}</Text>
              {item.start_time ? (
                <Text>
                  Time: {formatTime(item.start_time)} to {formatTime(item.end_time)}
                </Text>
              ) : null}
            </View>
            <Text style={styles.colRate}>
              {formatQuantity(item.quantity)} {item.unit} @ {formatCurrency(item.unit_price)}
            </Text>
            <Text style={styles.colAmount}>{formatCurrency(item.quantity * item.unit_price)}</Text>
          </View>
        ))}

        {/* Commenti/pagamento + totali */}
        <View style={styles.bottom} wrap={false}>
          <View style={styles.commentsBox}>
            <Text style={styles.darkLabel}>OTHER COMMENTS</Text>
            <View style={styles.commentsBody}>
              {invoice.comments ? <Text>{invoice.comments}</Text> : null}
              <Text>Please EFT funds into:</Text>
              <Text>
                {business.bank_name} BSB: {business.bank_bsb} Acct: {business.bank_account_number}
              </Text>
              <Text>{business.bank_account_name}</Text>
              <Text style={[styles.bold, { marginTop: 3 }]}>Terms: {business.payment_terms_days ?? 14} Days Payment</Text>
            </View>
          </View>

          <View style={styles.totals}>
            <View style={styles.totalRow}>
              <Text>SUBTOTAL</Text>
              <Text>{formatCurrency(invoice.subtotal)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>TAX RATE</Text>
              <Text>{Number(invoice.tax_rate).toFixed(1)}%</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>TAX</Text>
              <Text>{formatCurrency(invoice.tax_amount)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text>OTHER</Text>
              <Text>{formatCurrency(invoice.other_amount)}</Text>
            </View>
            <View style={styles.grandTotal}>
              <Text>TOTAL</Text>
              <Text>{formatCurrency(invoice.total)}</Text>
            </View>
          </View>
        </View>

        {/* Piè di pagina (fixed = ripetuto su ogni pagina se la fattura è lunga) */}
        <View style={styles.footer} fixed>
          <Text>If you have any questions about this invoice, please contact</Text>
          <Text>{business.email}</Text>
          <Text style={[styles.bold, { marginTop: 4 }]}>{business.footer_message}</Text>
        </View>
      </Page>
    </Document>
  );
}
