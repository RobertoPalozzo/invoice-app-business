// =====================================================================
// Funzioni di formattazione usate in tutte le pagine.
// Tenerle in un solo posto garantisce che importi e date appaiano
// sempre nello stesso modo (come nelle fatture reali).
// =====================================================================

// 482.72 → "$482.72"
export function formatCurrency(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(Number(value ?? 0));
}

// Abbreviazioni fisse: il browser in en-AU scriverebbe "Sept" per settembre
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-09-26" → "26-Sep-26" (stesso formato delle fatture attuali)
export function formatDate(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  return `${day}-${MONTHS[Number(month) - 1]}-${year.slice(-2)}`;
}

// "2026-09-22" → "22.09" (formato breve usato nelle righe della fattura)
export function formatDayMonth(isoDate) {
  if (!isoDate) return "";
  const [, month, day] = isoDate.split("-");
  return `${day}.${month}`;
}

// "10:00:00" (formato del database) → "10:00"
export function formatTime(time) {
  return time ? time.slice(0, 5) : "";
}

// 2 → "2.0", 3.4 → "3.4" (una cifra decimale, come nelle fatture reali)
export function formatQuantity(value) {
  return Number(value ?? 0).toFixed(1);
}

// "Weekday" → "Weekday." ma "Weekday." resta "Weekday." (niente doppio punto)
export function withFullStop(text) {
  const t = (text ?? "").trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

// Colori dei badge per lo stato della fattura
export const STATUS_STYLES = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-700",
};
