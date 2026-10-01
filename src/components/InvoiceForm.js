"use client";
// =====================================================================
// InvoiceForm — il form delle fatture, usato da DUE pagine:
//   /invoices/new        → <InvoiceForm />                 (nuova fattura)
//   /invoices/[id]/edit  → <InvoiceForm invoiceId={id} />  (modifica)
// Un solo componente per entrambe: niente codice duplicato.
//
// useState conserva:
//   - i dati di base (cliente, date, periodo, commenti)
//   - l'elenco delle righe (un array di oggetti)
// useEffect carica i dati iniziali (e, in modifica, la fattura esistente)
// e gli assistiti del cliente scelto.
//
// Salvataggio di una NUOVA fattura:
//   1. calcola il prossimo numero dell'anno (es. 54/2026)
//   2. inserisce la fattura in invoices
//   3. inserisce le righe in invoice_items
// Salvataggio di una MODIFICA:
//   1. aggiorna i dati della fattura (numero e cliente restano uguali)
//   2. inserisce le nuove righe, POI cancella le vecchie
//      (in quest'ordine: se qualcosa va storto non si perdono righe)
// In entrambi i casi alla fine apre /invoices/[id].
// =====================================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { formatCurrency, formatDayMonth, formatTime } from "@/lib/format";
import {
  addDays,
  buildPeriodTitle,
  daysBetween,
  hoursBetween,
  isWeekend,
  mondayOf,
  timesOverlap,
  todayISO,
} from "@/lib/dateHelpers";

// Crea una riga vuota. "key" serve a React per distinguere le righe
// (non va nel database).
function emptyLine(type = "service", date = "", recipientId = "") {
  return {
    key: crypto.randomUUID(),
    item_type: type,
    service_date: date,
    care_recipient_id: recipientId,
    service_id: "",
    description: "",
    start_time: "",
    end_time: "",
    route: "",
    quantity: "",
    unit: type === "mileage" ? "Km" : "hours",
    unit_price: "",
    gst_applicable: true,
  };
}

// Trasforma una riga letta dal database nel formato usato dal form.
// shiftDays sposta la data (serve per "Copy last invoice").
function itemToLine(item, shiftDays = 0) {
  return {
    key: crypto.randomUUID(),
    item_type: item.item_type,
    service_date: item.service_date ? addDays(item.service_date, shiftDays) : "",
    care_recipient_id: item.care_recipient_id ? String(item.care_recipient_id) : "",
    service_id: item.service_id ? String(item.service_id) : "",
    description: item.description,
    start_time: item.start_time ? item.start_time.slice(0, 5) : "",
    end_time: item.end_time ? item.end_time.slice(0, 5) : "",
    route: item.route ?? "",
    quantity: String(item.quantity),
    unit: item.unit,
    unit_price: String(item.unit_price),
    gst_applicable: item.gst_applicable,
  };
}

// Stile comune dei campi del form
const inputClass = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-500";

// Stati in cui una fattura si può modificare
const EDITABLE_STATUSES = ["draft", "sent"];

// ---------------------------------------------------------------------
// TimeSelect — scelta dell'orario con due menu: ore e minuti a passi di 5.
// Sostituisce <input type="time">, che su iPad/iPhone mostra tutti i
// minuti (0–59) ignorando il passo. Il valore resta "HH:MM" (es. "10:05").
// ---------------------------------------------------------------------
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0")); // "00".."23"
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0")); // "00","05".."55"

function TimeSelect({ value, onChange }) {
  const [hour = "", minute = ""] = value ? value.slice(0, 5).split(":") : [];
  // un vecchio orario non multiplo di 5 (es. 10:07) resta selezionabile
  const minuteOptions = minute && !MINUTES.includes(minute) ? [...MINUTES, minute].sort() : MINUTES;
  const selectClass = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";

  return (
    <div className="flex items-center gap-1">
      <select
        aria-label="Hour"
        value={hour}
        // scegliendo l'ora senza minuti, i minuti partono da "00"; "--" svuota l'orario
        onChange={(e) => onChange(e.target.value ? `${e.target.value}:${minute || "00"}` : "")}
        className={selectClass}
      >
        <option value="">--</option>
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-gray-500">:</span>
      <select
        aria-label="Minutes"
        value={minute}
        disabled={!hour}
        onChange={(e) => onChange(`${hour}:${e.target.value}`)}
        className={`${selectClass} disabled:bg-gray-100`}
      >
        {!hour && <option value="">--</option>}
        {minuteOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function InvoiceForm({ invoiceId = null }) {
  const router = useRouter();
  const isEdit = invoiceId !== null; // true = modifica, false = nuova fattura
  const [existing, setExisting] = useState(null); // la fattura che si sta modificando

  // ---------- Dati caricati da Supabase ----------
  const [settings, setSettings] = useState(null);
  const [clients, setClients] = useState([]);
  const [services, setServices] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ---------- Dati della fattura (valori iniziali calcolati una volta) ----------
  const [clientId, setClientId] = useState("");
  const [issueDate, setIssueDate] = useState(todayISO);
  const [dueDate, setDueDate] = useState(() => addDays(todayISO(), 14));
  const [periodStart, setPeriodStart] = useState(() => mondayOf(todayISO()));
  const [periodEnd, setPeriodEnd] = useState(() => addDays(mondayOf(todayISO()), 6));
  const [periodTitle, setPeriodTitle] = useState(() =>
    buildPeriodTitle(mondayOf(todayISO()), addDays(mondayOf(todayISO()), 6))
  );
  const [comments, setComments] = useState("");
  const [otherAmount, setOtherAmount] = useState("0");
  const [lines, setLines] = useState([]);

  // ---------- Stato del salvataggio ----------
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [copyMessage, setCopyMessage] = useState(null);

  // useEffect #1: al caricamento legge impostazioni, clienti e servizi.
  // In modifica legge anche la fattura esistente e le sue righe.
  useEffect(() => {
    async function loadInitialData() {
      // in modifica servono anche clienti e servizi disattivati,
      // perché la fattura potrebbe usarli
      let clientsQuery = supabase.from("clients").select("*").order("client_code");
      if (!isEdit) clientsQuery = clientsQuery.eq("active", true);

      const [settingsResult, clientsResult, servicesResult] = await Promise.all([
        supabase.from("settings").select("*").maybeSingle(),
        clientsQuery,
        supabase.from("services").select("*").order("description"),
      ]);

      const firstError = settingsResult.error || clientsResult.error || servicesResult.error;
      if (firstError) {
        setLoadError(firstError.message);
        setLoading(false);
        return;
      }

      setSettings(settingsResult.data);
      setClients(clientsResult.data);
      setServices(servicesResult.data);

      if (!isEdit) {
        // nuova fattura: la scadenza usa i giorni di pagamento delle impostazioni
        if (settingsResult.data) {
          setDueDate(addDays(todayISO(), settingsResult.data.payment_terms_days));
        }
        setLoading(false);
        return;
      }

      // ----- Modifica: carica la fattura e riempie il form -----
      if (!/^\d+$/.test(invoiceId)) {
        setLoadError("Invoice not found.");
        setLoading(false);
        return;
      }
      const [invoiceResult, itemsResult] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", invoiceId).maybeSingle(),
        supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("position"),
      ]);
      if (invoiceResult.error || itemsResult.error) {
        setLoadError((invoiceResult.error || itemsResult.error).message);
        setLoading(false);
        return;
      }
      if (!invoiceResult.data) {
        setLoadError("Invoice not found.");
        setLoading(false);
        return;
      }

      const inv = invoiceResult.data;
      setExisting(inv);
      setClientId(String(inv.client_id));
      setIssueDate(inv.issue_date);
      setDueDate(inv.due_date ?? "");
      setPeriodStart(inv.period_start ?? "");
      setPeriodEnd(inv.period_end ?? "");
      setPeriodTitle(inv.period_title ?? "");
      setComments(inv.comments ?? "");
      setOtherAmount(String(inv.other_amount));
      setLines(itemsResult.data.map((item) => itemToLine(item)));
      setLoading(false);
    }
    loadInitialData();
  }, [isEdit, invoiceId]);

  // useEffect #2: quando cambia il cliente, carica i suoi assistiti
  useEffect(() => {
    async function loadRecipients() {
      if (!clientId) {
        setRecipients([]);
        return;
      }
      let query = supabase
        .from("care_recipients")
        .select("*")
        .eq("client_id", clientId)
        .order("full_name");
      // nuova fattura: solo assistiti attivi; in modifica anche quelli
      // disattivati, perché le righe esistenti potrebbero riferirsi a loro
      if (!isEdit) query = query.eq("active", true);
      const { data } = await query;
      setRecipients(data ?? []);
    }
    loadRecipients();
  }, [clientId, isEdit]);

  // ---------- Valori derivati (ricalcolati a ogni render) ----------
  const selectedClient = clients.find((c) => String(c.id) === String(clientId));
  // per un cliente privato c'è un solo assistito: viene scelto in automatico
  const defaultRecipientId = recipients.length === 1 ? String(recipients[0].id) : "";
  // GST: una nuova fattura segue le impostazioni attuali; una fattura
  // esistente mantiene la GST con cui era stata emessa
  const gstOn = isEdit ? Boolean(existing?.gst_included) : Boolean(settings?.gst_registered);
  const gstRate = gstOn ? Number(isEdit ? existing.gst_rate : settings.gst_rate) : 0;

  const lineAmount = (line) => (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
  const subtotal = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const gstBase = lines.filter((l) => l.gst_applicable).reduce((sum, l) => sum + lineAmount(l), 0);
  const taxAmount = gstOn ? Math.round(gstBase * gstRate) / 100 : 0;
  const total = subtotal + taxAmount + (Number(otherAmount) || 0);

  // Sovrapposizioni tra righe di QUESTA fattura (ricalcolate a ogni modifica).
  // Risultato: { chiaveRiga: ["Overlaps with line 2 (10:00–12:00)", ...] }
  const overlapWarnings = {};
  lines.forEach((a, i) => {
    lines.forEach((b, j) => {
      if (i === j || !a.service_date || a.service_date !== b.service_date) return;
      if (timesOverlap(a.start_time, a.end_time, b.start_time, b.end_time)) {
        overlapWarnings[a.key] = overlapWarnings[a.key] ?? [];
        overlapWarnings[a.key].push(`Overlaps with line ${j + 1} (${b.start_time}–${b.end_time})`);
      }
    });
  });
  const hasOverlaps = Object.keys(overlapWarnings).length > 0;

  // ---------- Gestione delle date ----------
  function handleIssueDateChange(value) {
    setIssueDate(value);
    if (value) setDueDate(addDays(value, settings?.payment_terms_days ?? 14));
  }

  function handlePeriodStartChange(value) {
    setPeriodStart(value);
    if (!value) return;
    const newEnd = addDays(value, 6); // di default una settimana
    setPeriodEnd(newEnd);
    setPeriodTitle(buildPeriodTitle(value, newEnd));
  }

  function handlePeriodEndChange(value) {
    setPeriodEnd(value);
    if (value && periodStart) setPeriodTitle(buildPeriodTitle(periodStart, value));
  }

  // ---------- Gestione delle righe ----------
  // Aggiorna solo alcuni campi di una riga, lasciando invariate le altre
  function updateLine(key, changes) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...changes } : line))
    );
  }

  function addLine(type) {
    setLines((current) => [...current, emptyLine(type, periodStart, defaultRecipientId)]);
  }

  function removeLine(key) {
    setLines((current) => current.filter((line) => line.key !== key));
  }

  // Chiede a Supabase la tariffa giusta (assistito → cliente → base)
  async function applyRate(key, recipientId, serviceId) {
    if (!serviceId) return;
    const service = services.find((s) => String(s.id) === String(serviceId));
    if (!recipientId) {
      updateLine(key, { unit_price: service ? String(service.default_rate) : "" });
      return;
    }
    const { data, error } = await supabase.rpc("get_rate", {
      p_care_recipient_id: Number(recipientId),
      p_service_id: Number(serviceId),
    });
    if (!error && data !== null) updateLine(key, { unit_price: String(data) });
  }

  // Sceglie la versione giusta del servizio per la data:
  //   weekend + servizio feriale con versione weekend → versione weekend
  //   giorno feriale + servizio weekend → torna alla versione feriale
  function serviceForDate(serviceId, date) {
    if (!serviceId) return serviceId;
    const service = services.find((s) => String(s.id) === String(serviceId));
    if (!service) return serviceId;
    if (isWeekend(date) && service.weekend_service_id) {
      return String(service.weekend_service_id);
    }
    if (date && !isWeekend(date)) {
      const weekdayVersion = services.find((s) => String(s.weekend_service_id) === String(service.id));
      if (weekdayVersion) return String(weekdayVersion.id);
    }
    return String(serviceId);
  }

  // Imposta servizio, descrizione, unità e tariffa di una riga
  function setLineService(line, serviceId, extraChanges = {}) {
    const service = services.find((s) => String(s.id) === String(serviceId));
    updateLine(line.key, {
      ...extraChanges,
      service_id: serviceId,
      description: service ? service.description : "",
      unit: service ? service.unit : line.unit,
      gst_applicable: service ? service.gst_applicable : true,
    });
    applyRate(line.key, line.care_recipient_id, serviceId);
  }

  function handleServiceChange(line, serviceId) {
    setLineService(line, serviceForDate(serviceId, line.service_date));
  }

  // Cambiando la data, il servizio passa da Weekday a Weekend (o viceversa)
  function handleDateChange(line, date) {
    const resolved = serviceForDate(line.service_id, date);
    if (line.service_id && resolved !== String(line.service_id)) {
      setLineService(line, resolved, { service_date: date });
    } else {
      updateLine(line.key, { service_date: date });
    }
  }

  function handleRecipientChange(line, recipientId) {
    updateLine(line.key, { care_recipient_id: recipientId });
    applyRate(line.key, recipientId, line.service_id);
  }

  // Le ore si ricalcolano quando cambia l'orario di inizio o di fine
  function handleTimeChange(line, field, value) {
    const start = field === "start_time" ? value : line.start_time;
    const end = field === "end_time" ? value : line.end_time;
    const hours = hoursBetween(start, end);
    updateLine(line.key, {
      [field]: value,
      ...(hours !== null ? { quantity: String(hours) } : {}),
    });
  }

  // Copia le righe dell'ultima fattura del cliente, spostando le date
  // della stessa distanza tra il vecchio e il nuovo periodo.
  async function copyLastInvoice() {
    setCopyMessage(null);
    const { data: lastInvoice } = await supabase
      .from("invoices")
      .select("id, invoice_number, period_start")
      .eq("client_id", clientId)
      .neq("status", "void")
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastInvoice) {
      setCopyMessage("This client has no previous invoices to copy.");
      return;
    }

    const { data: oldItems } = await supabase
      .from("invoice_items")
      .select("*")
      .eq("invoice_id", lastInvoice.id)
      .order("position");

    const shift =
      lastInvoice.period_start && periodStart ? daysBetween(lastInvoice.period_start, periodStart) : 0;

    const copied = (oldItems ?? []).map((item) => itemToLine(item, shift));

    setLines(copied);
    setCopyMessage(
      `Copied ${copied.length} lines from invoice ${lastInvoice.invoice_number}. Check dates, times and kilometres.`
    );
  }

  // ---------- Controllo dei dati prima del salvataggio ----------
  function validate() {
    if (!clientId) return "Choose a client.";
    if (!issueDate) return "Enter the issue date.";
    if (periodStart && periodEnd && periodEnd < periodStart) return "The period ends before it starts.";
    if (lines.length === 0) return "Add at least one line.";
    for (const [index, line] of lines.entries()) {
      const n = index + 1;
      if (!line.description.trim()) return `Line ${n}: enter a description or choose a service.`;
      if (!(Number(line.quantity) > 0)) return `Line ${n}: the quantity must be greater than 0.`;
      if (line.unit_price === "" || Number(line.unit_price) < 0) return `Line ${n}: enter a valid rate.`;
      if (line.start_time && line.end_time && line.end_time <= line.start_time)
        return `Line ${n}: the end time must be after the start time.`;
    }
    if (hasOverlaps) return "Some lines overlap in time on the same day. Fix the times marked in red.";
    return null;
  }

  // Controlla che gli orari non si sovrappongano a quelli di ALTRE fatture
  // (anche di altri clienti): non si può essere in due posti insieme.
  // Restituisce il messaggio d'errore, oppure null se è tutto a posto.
  async function findConflictsWithOtherInvoices() {
    const timedLines = lines.filter((l) => l.service_date && l.start_time && l.end_time);
    if (timedLines.length === 0) return null;

    const dates = [...new Set(timedLines.map((l) => l.service_date))];
    // righe di altre fatture negli stessi giorni, con numero e stato della fattura
    const { data: others, error } = await supabase
      .from("invoice_items")
      .select("invoice_id, service_date, start_time, end_time, care_recipients(full_name), invoices(invoice_number, status)")
      .in("service_date", dates)
      .not("start_time", "is", null);

    if (error) return `Could not check for overlapping times: ${error.message}`;

    for (const [index, line] of lines.entries()) {
      if (!timedLines.includes(line)) continue;
      const clash = others.find(
        (other) =>
          other.service_date === line.service_date &&
          other.invoices?.status !== "void" &&
          (!isEdit || other.invoice_id !== existing.id) && // in modifica si ignora la fattura stessa
          timesOverlap(line.start_time, line.end_time, other.start_time, other.end_time)
      );
      if (clash) {
        return (
          `Line ${index + 1} (${formatDayMonth(line.service_date)} ${line.start_time}–${line.end_time}) ` +
          `overlaps with invoice ${clash.invoices.invoice_number}: ` +
          `${clash.care_recipients?.full_name ?? "another service"}, ` +
          `${formatTime(clash.start_time)}–${formatTime(clash.end_time)}.`
        );
      }
    }
    return null;
  }

  // Righe nel formato del database, collegate alla fattura indicata
  function buildRows(targetInvoiceId) {
    return lines.map((line, index) => ({
      invoice_id: targetInvoiceId,
      position: index + 1,
      item_type: line.item_type,
      service_date: line.service_date || null,
      care_recipient_id: line.care_recipient_id ? Number(line.care_recipient_id) : null,
      service_id: line.service_id ? Number(line.service_id) : null,
      description: line.description.trim(),
      start_time: line.start_time || null,
      end_time: line.end_time || null,
      route: line.route.trim() || null,
      quantity: Number(line.quantity),
      unit: line.unit,
      unit_price: Number(line.unit_price),
      gst_applicable: line.gst_applicable,
    }));
  }

  // Campi della fattura modificabili dal form (uguali per nuova e modifica)
  function invoiceFields() {
    return {
      due_date: dueDate || null,
      period_start: periodStart || null,
      period_end: periodEnd || null,
      period_title: periodTitle.trim() || null,
      other_amount: Number(otherAmount) || 0,
      comments: comments.trim() || null,
    };
  }

  // ---------- Salvataggio ----------
  async function handleSave(event) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError(null);

    // controllo sul database: orari in conflitto con altre fatture?
    const conflict = await findConflictsWithOtherInvoices();
    if (conflict) {
      setFormError(conflict);
      setSaving(false);
      return;
    }

    if (isEdit) {
      await saveChanges();
    } else {
      await createInvoice();
    }
  }

  // ----- MODIFICA di una fattura esistente -----
  async function saveChanges() {
    // ricontrolla lo stato: nel frattempo potrebbe essere stata pagata
    const { data: current } = await supabase.from("invoices").select("status").eq("id", existing.id).single();
    if (!current || !EDITABLE_STATUSES.includes(current.status)) {
      setFormError("This invoice can no longer be edited (it is paid or voided).");
      setSaving(false);
      return;
    }

    // 1. aggiorna i dati della fattura (numero, data, cliente e GST restano)
    const { error: updateError } = await supabase
      .from("invoices")
      .update(invoiceFields())
      .eq("id", existing.id);
    if (updateError) {
      setFormError(`Could not save the changes: ${updateError.message}`);
      setSaving(false);
      return;
    }

    // 2. prende gli id delle righe attuali...
    const { data: oldRows } = await supabase.from("invoice_items").select("id").eq("invoice_id", existing.id);
    const oldIds = (oldRows ?? []).map((row) => row.id);

    // 3. ...inserisce le nuove righe...
    const { error: insertError } = await supabase.from("invoice_items").insert(buildRows(existing.id));
    if (insertError) {
      setFormError(`Could not save the invoice lines: ${insertError.message}`);
      setSaving(false);
      return;
    }

    // 4. ...e solo ora cancella le vecchie
    if (oldIds.length > 0) {
      const { error: deleteError } = await supabase.from("invoice_items").delete().in("id", oldIds);
      if (deleteError) {
        setFormError(`Lines saved, but old lines could not be removed: ${deleteError.message}`);
        setSaving(false);
        return;
      }
    }

    router.push(`/invoices/${existing.id}`);
  }

  // ----- CREAZIONE di una nuova fattura -----
  async function createInvoice() {
    // 1. Prossimo numero dell'anno: il più alto + 1
    const year = Number(issueDate.slice(0, 4));
    const { data: lastNumber } = await supabase
      .from("invoices")
      .select("sequence_number")
      .eq("year", year)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sequenceNumber = Math.max(
      (lastNumber?.sequence_number ?? 0) + 1,
      // numero di partenza dalle impostazioni, solo per l'anno indicato
      settings?.first_invoice_year === year ? settings.first_invoice_number : 1
    );

    // 2. La fattura. GST copiata dalle impostazioni in questo momento.
    const { data: newInvoice, error: invoiceError } = await supabase
      .from("invoices")
      .insert({
        ...invoiceFields(),
        year,
        sequence_number: sequenceNumber,
        client_id: Number(clientId),
        issue_date: issueDate,
        status: "draft",
        gst_included: gstOn,
        gst_rate: gstRate,
      })
      .select("id")
      .single();

    if (invoiceError) {
      setFormError(`Could not save the invoice: ${invoiceError.message}`);
      setSaving(false);
      return;
    }

    // 3. Le righe, collegate alla fattura appena creata
    const { error: itemsError } = await supabase.from("invoice_items").insert(buildRows(newInvoice.id));

    if (itemsError) {
      // se le righe falliscono, si toglie la fattura vuota appena creata
      await supabase.from("invoices").delete().eq("id", newInvoice.id);
      setFormError(`Could not save the invoice lines: ${itemsError.message}`);
      setSaving(false);
      return;
    }

    // 4. Tutto salvato: apre la fattura
    router.push(`/invoices/${newInvoice.id}`);
  }

  // ---------- Render ----------
  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (loadError) return <p className="text-red-600">Could not load the form data: {loadError}</p>;

  // In modifica, le fatture pagate o annullate non si toccano
  if (isEdit && !EDITABLE_STATUSES.includes(existing.status)) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900">Invoice {existing.invoice_number} can’t be edited</h1>
        <p className="text-gray-600">
          It is <strong>{existing.status}</strong>. Mark it as unpaid or restore it as a draft first.
        </p>
        <Link href={`/invoices/${existing.id}`} className="text-blue-700 hover:underline">
          ← Back to the invoice
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">
          {isEdit ? `Edit invoice ${existing.invoice_number}` : "New invoice"}
        </h1>
        {gstOn && (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
            Tax invoice · GST {gstRate}%
          </span>
        )}
      </div>

      {/* ----- Cliente e date ----- */}
      <section className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-gray-700">Client</span>
          <select
            value={clientId}
            disabled={isEdit}
            onChange={(e) => {
              setClientId(e.target.value);
              setLines([]); // gli assistiti cambiano: si riparte da zero
              setCopyMessage(null);
            }}
            className={inputClass}
          >
            <option value="">Choose a client...</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.client_code} – {client.contact_name}
                {client.company ? ` (${client.company})` : ""}
                {client.client_type === "private" ? " · private" : ""}
              </option>
            ))}
          </select>
          {isEdit && (
            <span className="text-xs text-gray-500">
              The client can’t be changed. To bill another client, void this invoice and create a new one.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Issue date</span>
          <input
            type="date"
            value={issueDate}
            disabled={isEdit}
            onChange={(e) => handleIssueDateChange(e.target.value)}
            className={inputClass}
          />
          {isEdit && <span className="text-xs text-gray-500">Number and issue date stay the same.</span>}
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Due date</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Period from</span>
          <input type="date" value={periodStart} onChange={(e) => handlePeriodStartChange(e.target.value)} className={inputClass} />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Period to</span>
          <input type="date" value={periodEnd} onChange={(e) => handlePeriodEndChange(e.target.value)} className={inputClass} />
        </label>

        <label className="block sm:col-span-2">
          <span className="text-sm font-medium text-gray-700">Period title (printed on the invoice)</span>
          <input type="text" value={periodTitle} onChange={(e) => setPeriodTitle(e.target.value)} className={inputClass} />
        </label>
      </section>

      {/* ----- Righe ----- */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="mr-auto font-medium text-gray-900">Lines</h2>
          {clientId && !isEdit && (
            <button type="button" onClick={copyLastInvoice} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
              Copy last invoice
            </button>
          )}
          <button type="button" disabled={!clientId} onClick={() => addLine("service")} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40">
            + Service
          </button>
          <button type="button" disabled={!clientId} onClick={() => addLine("mileage")} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40">
            + Mileage
          </button>
          <button type="button" disabled={!clientId} onClick={() => addLine("other")} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-40">
            + Other
          </button>
        </div>

        {copyMessage && <p className="border-b border-gray-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">{copyMessage}</p>}

        {!clientId && <p className="px-4 py-6 text-gray-500">Choose a client to start adding lines.</p>}
        {clientId && lines.length === 0 && (
          <p className="px-4 py-6 text-gray-500">No lines yet. Add a service, a mileage line, or copy the last invoice.</p>
        )}

        {lines.map((line, index) => {
          // servizi adatti al tipo di riga: Km per il rimborso, ore per i servizi
          // servizi adatti al tipo di riga (Km per il rimborso, ore per i servizi);
          // quelli disattivati compaiono solo se la riga li usa già
          const serviceOptions = services.filter(
            (s) =>
              (line.item_type === "mileage" ? s.unit === "Km" : s.unit !== "Km") &&
              (s.active || String(s.id) === line.service_id)
          );
          return (
            <div key={line.key} className="grid gap-3 border-t border-gray-100 px-4 py-4 first:border-t-0 sm:grid-cols-6">
              <div className="flex items-center justify-between sm:col-span-6">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Line {index + 1} · {line.item_type}
                </span>
                <button type="button" onClick={() => removeLine(line.key)} className="text-sm text-red-600 hover:underline">
                  Remove
                </button>
              </div>

              <label className="block sm:col-span-2">
                <span className="text-xs text-gray-600">Date</span>
                <input type="date" value={line.service_date} onChange={(e) => handleDateChange(line, e.target.value)} className={inputClass} />
                {isWeekend(line.service_date) && <span className="text-xs font-medium text-purple-700">Weekend</span>}
              </label>

              {line.item_type !== "other" && (
                <label className="block sm:col-span-4">
                  <span className="text-xs text-gray-600">Care recipient</span>
                  <select value={line.care_recipient_id} onChange={(e) => handleRecipientChange(line, e.target.value)} className={inputClass}>
                    <option value="">Choose...</option>
                    {recipients.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name} – {r.address}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {line.item_type !== "other" && (
                <label className="block sm:col-span-6">
                  <span className="text-xs text-gray-600">Service</span>
                  <select value={line.service_id} onChange={(e) => handleServiceChange(line, e.target.value)} className={inputClass}>
                    <option value="">Choose...</option>
                    {serviceOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.description}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block sm:col-span-6">
                <span className="text-xs text-gray-600">Description (printed on the invoice)</span>
                <input type="text" value={line.description} onChange={(e) => updateLine(line.key, { description: e.target.value })} className={inputClass} />
              </label>

              {line.item_type === "service" && (
                <>
                  <div className="block sm:col-span-2">
                    <span className="text-xs text-gray-600">Start time</span>
                    <TimeSelect value={line.start_time} onChange={(value) => handleTimeChange(line, "start_time", value)} />
                  </div>
                  <div className="block sm:col-span-2">
                    <span className="text-xs text-gray-600">End time</span>
                    <TimeSelect value={line.end_time} onChange={(value) => handleTimeChange(line, "end_time", value)} />
                  </div>
                </>
              )}

              {line.item_type === "mileage" && (
                <label className="block sm:col-span-4">
                  <span className="text-xs text-gray-600">Route</span>
                  <input
                    type="text"
                    placeholder="From ... to ... and back"
                    value={line.route}
                    onChange={(e) => updateLine(line.key, { route: e.target.value })}
                    className={inputClass}
                  />
                </label>
              )}

              {line.item_type === "other" && (
                <label className="block sm:col-span-4">
                  <span className="text-xs text-gray-600">Unit</span>
                  <input type="text" value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value })} className={inputClass} />
                </label>
              )}

              <label className="block">
                <span className="text-xs text-gray-600">{line.unit === "Km" ? "Km" : line.unit === "hours" ? "Hours" : "Qty"}</span>
                <input type="number" step="0.1" min="0" value={line.quantity} onChange={(e) => updateLine(line.key, { quantity: e.target.value })} className={inputClass} />
              </label>

              <label className="block">
                <span className="text-xs text-gray-600">Rate $</span>
                <input type="number" step="0.01" min="0" value={line.unit_price} onChange={(e) => updateLine(line.key, { unit_price: e.target.value })} className={inputClass} />
              </label>

              {/* Riga nel weekend con un servizio feriale senza versione weekend:
                  avviso (non blocca), perché la tariffa potrebbe essere da alzare */}
              {line.item_type === "service" &&
                isWeekend(line.service_date) &&
                (() => {
                  const service = services.find((s) => String(s.id) === String(line.service_id));
                  const isWeekendVersion = services.some((s) => String(s.weekend_service_id) === String(line.service_id));
                  return service && !service.weekend_service_id && !isWeekendVersion ? (
                    <p className="rounded-md bg-amber-50 px-3 py-1.5 text-sm text-amber-800 sm:col-span-6">
                      This is a weekend date, but this service has no weekend version. Check the rate, or link a
                      weekend version in Services &amp; Rates.
                    </p>
                  ) : null;
                })()}

              {/* Avviso immediato se l'orario si sovrappone a un'altra riga */}
              {overlapWarnings[line.key] && (
                <p className="rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700 sm:col-span-6">
                  ⚠ {overlapWarnings[line.key].join(" · ")}
                </p>
              )}

              <p className="self-end text-right text-sm font-medium text-gray-900 sm:col-span-6">
                Amount: {formatCurrency(lineAmount(line))}
              </p>
            </div>
          );
        })}
      </section>

      {/* ----- Commenti e totali ----- */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block rounded-lg border border-gray-200 bg-white p-4">
          <span className="text-sm font-medium text-gray-700">Other comments (optional)</span>
          <textarea rows={4} value={comments} onChange={(e) => setComments(e.target.value)} className={inputClass} />
          <span className="text-xs text-gray-500">Bank details and payment terms are added automatically.</span>
        </label>

        <section className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
          <dl className="grid grid-cols-2 items-center gap-y-1">
            <dt className="text-gray-500">Subtotal</dt>
            <dd className="text-right">{formatCurrency(subtotal)}</dd>
            <dt className="text-gray-500">Tax rate</dt>
            <dd className="text-right">{gstRate.toFixed(1)}%</dd>
            <dt className="text-gray-500">Tax</dt>
            <dd className="text-right">{formatCurrency(taxAmount)}</dd>
            <dt className="text-gray-500">Other</dt>
            <dd className="text-right">
              <input
                type="number"
                step="0.01"
                value={otherAmount}
                onChange={(e) => setOtherAmount(e.target.value)}
                className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm"
              />
            </dd>
            <dt className="border-t border-gray-200 pt-2 font-semibold text-gray-900">Total</dt>
            <dd className="border-t border-gray-200 pt-2 text-right font-semibold text-gray-900">{formatCurrency(total)}</dd>
          </dl>
        </section>
      </div>

      {formError && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{formError}</p>}

      <div className="flex justify-end gap-2">
        <Link
          href={isEdit ? `/invoices/${existing.id}` : "/"}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving
            ? "Saving..."
            : isEdit
            ? "Save changes"
            : `Save invoice${selectedClient ? ` for ${selectedClient.client_code}` : ""}`}
        </button>
      </div>
    </form>
  );
}
