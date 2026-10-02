"use client";
// =====================================================================
// Scheda cliente — ROUTE DINAMICA /clients/[id]
//
// Stesso schema di /invoices/[id]:
//   useParams → id dall'URL
//   useEffect → query a Supabase quando cambia l'id
//   useState  → dati, caricamento, errori
//
// Qui le query sono quattro, tutte filtrate con l'id del cliente:
//   1. il cliente
//   2. i suoi assistiti
//   3. le sue fatture (con i totali dalla vista)
//   4. le tariffe personalizzate (del cliente e dei suoi assistiti)
// =====================================================================
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { formatCurrency, formatDate, STATUS_STYLES } from "@/lib/format";

export default function ClientDetailPage() {
  const { id } = useParams();

  const [client, setClient] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  // Form "Add care recipient"
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  // Modifica dei dati del cliente: editing = true mostra il form
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // copia dei campi mentre si modifica
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  // Modifica di un assistito: id dell'assistito aperto in modifica
  const [editingRecipientId, setEditingRecipientId] = useState(null);
  const [recipientDraft, setRecipientDraft] = useState({ full_name: "", address: "" });
  const [recipientError, setRecipientError] = useState(null);

  useEffect(() => {
    async function loadClient() {
      setLoading(true);
      setNotFound(false);
      setError(null);

      if (!/^\d+$/.test(id)) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Query 1: il cliente con l'id dell'URL
      const { data: clientData, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (clientError) {
        setError(clientError.message);
        setLoading(false);
        return;
      }
      if (!clientData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      // Query 2-3 in parallelo: assistiti e fatture del cliente
      const [recipientsResult, invoicesResult] = await Promise.all([
        supabase
          .from("care_recipients")
          .select("*")
          .eq("client_id", id)
          .order("full_name"),
        supabase
          .from("invoice_totals")
          .select("id, invoice_number, issue_date, period_start, period_end, status, total")
          .eq("client_id", id)
          .order("issue_date", { ascending: false }),
      ]);

      if (recipientsResult.error || invoicesResult.error) {
        setError((recipientsResult.error || invoicesResult.error).message);
        setLoading(false);
        return;
      }

      // Query 4: tariffe personalizzate del cliente OPPURE dei suoi assistiti.
      // .or(...) = condizione "A oppure B" in un'unica query.
      // services(...) e care_recipients(...) aggiungono i nomi leggibili.
      const recipientIds = recipientsResult.data.map((r) => r.id);
      let ratesFilter = `client_id.eq.${id}`;
      if (recipientIds.length > 0) {
        ratesFilter += `,care_recipient_id.in.(${recipientIds.join(",")})`;
      }
      const { data: ratesData, error: ratesError } = await supabase
        .from("rates")
        .select("id, rate, notes, client_id, services(description, unit, default_rate), care_recipients(full_name)")
        .or(ratesFilter);

      if (ratesError) {
        setError(ratesError.message);
        setLoading(false);
        return;
      }

      setClient(clientData);
      setRecipients(recipientsResult.data);
      setInvoices(invoicesResult.data);
      setRates(ratesData);
      setLoading(false);
    }

    loadClient();
  }, [id]);

  // Aggiunge un assistito a questo cliente (INSERT) e lo mostra subito
  async function addRecipient(event) {
    event.preventDefault();
    if (!newName.trim()) {
      setAddError("Enter the care recipient's name.");
      return;
    }
    setAdding(true);
    setAddError(null);
    const { data, error } = await supabase
      .from("care_recipients")
      .insert({ client_id: Number(id), full_name: newName.trim(), address: newAddress.trim() || null })
      .select("*")
      .single();
    if (error) {
      setAddError(error.message);
    } else {
      // aggiunge il nuovo assistito alla lista, in ordine alfabetico
      setRecipients((current) => [...current, data].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      setNewName("");
      setNewAddress("");
    }
    setAdding(false);
  }

  // ---------- Modifica del cliente ----------
  function startEditing() {
    // il form parte dai valori attuali (null → stringa vuota)
    setDraft({
      contact_name: client.contact_name ?? "",
      company: client.company ?? "",
      contact_person: client.contact_person ?? "",
      address: client.address ?? "",
      phone: client.phone ?? "",
      email: client.email ?? "",
      abn: client.abn ?? "",
      active: client.active,
    });
    setEditError(null);
    setEditing(true);
  }

  async function saveClient(event) {
    event.preventDefault();
    if (!draft.contact_name.trim()) {
      setEditError("Enter the name to print on the invoice.");
      return;
    }
    setSaving(true);
    setEditError(null);

    const clean = (value) => value.trim() || null;
    const changes = {
      contact_name: draft.contact_name.trim(),
      company: client.client_type === "company" ? clean(draft.company) : null,
      contact_person: client.client_type === "company" ? clean(draft.contact_person) : null,
      address: clean(draft.address),
      phone: clean(draft.phone),
      email: clean(draft.email),
      abn: clean(draft.abn),
      active: draft.active,
    };

    // UPDATE del cliente; .select().single() restituisce la riga aggiornata
    const { data, error } = await supabase.from("clients").update(changes).eq("id", id).select("*").single();
    if (error) {
      setEditError(error.message);
      setSaving(false);
      return;
    }

    // Cliente privato: è anche il suo unico assistito → stessi nome e indirizzo
    if (client.client_type === "private" && recipients.length === 1) {
      const { data: updatedRecipient } = await supabase
        .from("care_recipients")
        .update({ full_name: changes.contact_name, address: changes.address })
        .eq("id", recipients[0].id)
        .select("*")
        .single();
      if (updatedRecipient) setRecipients([updatedRecipient]);
    }

    setClient(data);
    setEditing(false);
    setSaving(false);
  }

  // Riattiva con un clic un cliente disattivato (per errore o dopo una pausa)
  async function reactivateClient() {
    const { data, error } = await supabase.from("clients").update({ active: true }).eq("id", id).select("*").single();
    if (error) {
      setEditError(error.message);
      return;
    }
    setClient(data);
  }

  // ---------- Modifica di un assistito ----------
  function startEditingRecipient(recipient) {
    setEditingRecipientId(recipient.id);
    setRecipientDraft({ full_name: recipient.full_name, address: recipient.address ?? "" });
    setRecipientError(null);
  }

  async function saveRecipient(recipientId) {
    if (!recipientDraft.full_name.trim()) {
      setRecipientError("Enter the care recipient's name.");
      return;
    }
    const { data, error } = await supabase
      .from("care_recipients")
      .update({ full_name: recipientDraft.full_name.trim(), address: recipientDraft.address.trim() || null })
      .eq("id", recipientId)
      .select("*")
      .single();
    if (error) {
      setRecipientError(error.message);
      return;
    }
    setRecipients((current) => current.map((r) => (r.id === recipientId ? data : r)));
    setEditingRecipientId(null);
  }

  // Gli assistiti non si cancellano (le fatture vecchie li usano):
  // si disattivano e spariscono dal form delle nuove fatture
  async function toggleRecipient(recipient) {
    const { data, error } = await supabase
      .from("care_recipients")
      .update({ active: !recipient.active })
      .eq("id", recipient.id)
      .select("*")
      .single();
    if (error) {
      setRecipientError(error.message);
      return;
    }
    setRecipients((current) => current.map((r) => (r.id === recipient.id ? data : r)));
  }

  if (loading) return <p className="text-gray-500">Loading client...</p>;

  if (notFound) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-gray-900">Client not found</h1>
        <p className="text-gray-600">There is no client with ID “{id}”.</p>
        <Link href="/" className="text-blue-700 hover:underline">
          ← Back to dashboard
        </Link>
      </div>
    );
  }

  if (error) return <p className="text-red-600">Could not load the client: {error}</p>;

  // Riepilogo calcolato dalle fatture già caricate (le annullate non contano)
  const activeInvoices = invoices.filter((inv) => inv.status !== "void");
  const totalInvoiced = activeInvoices.reduce((sum, inv) => sum + Number(inv.total), 0);
  const outstanding = activeInvoices
    .filter((inv) => inv.status === "sent")
    .reduce((sum, inv) => sum + Number(inv.total), 0);

  return (
    <div className="space-y-6">
      {/* Intestazione */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-gray-900">{client.contact_name}</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {client.client_code}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
            client.client_type === "private" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
          }`}
        >
          {client.client_type}
        </span>
        {!client.active && (
          <>
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">inactive</span>
            {!editing && (
              <button
                onClick={reactivateClient}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-500"
              >
                Reactivate client
              </button>
            )}
          </>
        )}
        {!editing && (
          <button
            onClick={startEditing}
            className="ml-auto rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            Edit client
          </button>
        )}
      </div>

      {/* Form di modifica del cliente (al posto dei contatti) */}
      {editing && (
        <form onSubmit={saveClient} className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
          <h2 className="font-medium text-gray-900 sm:col-span-2">Edit client {client.client_code}</h2>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              {client.client_type === "private" ? "Client name (Bill to)" : "Company name (Bill to)"}
            </span>
            <input value={draft.contact_name} onChange={(e) => setDraft({ ...draft, contact_name: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>

          {client.client_type === "company" && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Contact person (optional, internal)</span>
              <input value={draft.contact_person} onChange={(e) => setDraft({ ...draft, contact_person: e.target.value })} placeholder="e.g. William Saad" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
              <span className="text-xs text-gray-500">Internal reference only: never printed on the invoice.</span>
            </label>
          )}

          {client.client_type === "company" && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Works for (optional, internal)</span>
              <input value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} placeholder="e.g. Stone Community Care Pty Ltd" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
              <span className="text-xs text-gray-500">Internal reference only: never printed on the invoice.</span>
            </label>
          )}

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-gray-700">Address</span>
            <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Phone</span>
            <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">ABN</span>
            <input value={draft.abn} onChange={(e) => setDraft({ ...draft, abn: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
          </label>

          {/* riguarda tutto il cliente, non l'ABN: su una riga a parte */}
          <label className="flex items-start gap-2 border-t border-gray-200 pt-3 text-sm sm:col-span-2">
            <input type="checkbox" className="mt-0.5" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            <span>
              <span className="font-medium text-gray-700">Client active</span>
              <span className="block text-xs text-gray-500">
                Untick when you no longer work for this client: it disappears from the client list of new invoices, but its old invoices stay.
              </span>
            </span>
          </label>

          <p className="text-xs text-gray-500 sm:col-span-2">
            Changes also appear on this client&apos;s existing invoices when they are viewed or printed again.
            {client.client_type === "private" && " The care recipient's name and address are updated too."}
          </p>

          {editError && <p className="text-sm text-red-600 sm:col-span-2">{editError}</p>}

          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      )}

      {/* Contatti + riepilogo */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className={`rounded-lg border border-gray-200 bg-white p-4 ${editing ? "hidden" : ""}`}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Contact details</h2>
          {client.contact_person && <p className="text-sm text-gray-500">Contact person: {client.contact_person} (not printed)</p>}
          {client.company && <p className="text-sm text-gray-500">Works for: {client.company} (not printed)</p>}
          {client.address && <p className="text-gray-700">{client.address}</p>}
          {client.phone && <p className="text-gray-700">Phone: {client.phone}</p>}
          {client.email && <p className="text-gray-700">Email: {client.email}</p>}
          {client.abn && <p className="text-gray-700">ABN: {client.abn}</p>}
        </section>

        <section className="grid grid-cols-3 gap-2 rounded-lg border border-gray-200 bg-white p-4 text-center">
          <div>
            <p className="text-2xl font-semibold text-gray-900">{activeInvoices.length}</p>
            <p className="text-xs text-gray-500">Invoices</p>
          </div>
          <div>
            <p className="text-2xl font-semibold text-gray-900">{formatCurrency(totalInvoiced)}</p>
            <p className="text-xs text-gray-500">Total invoiced</p>
          </div>
          <div>
            <p className={`text-2xl font-semibold ${outstanding > 0 ? "text-amber-600" : "text-gray-900"}`}>
              {formatCurrency(outstanding)}
            </p>
            <p className="text-xs text-gray-500">Awaiting payment</p>
          </div>
        </section>
      </div>

      {/* Assistiti */}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 font-medium text-gray-900">
          Care recipients ({recipients.length})
        </h2>
        {recipients.length === 0 ? (
          <p className="px-4 py-6 text-gray-500">No care recipients yet.</p>
        ) : (
          <ul>
            {recipients.map((recipient) =>
              editingRecipientId === recipient.id ? (
                // riga in modifica
                <li key={recipient.id} className="flex flex-wrap items-end gap-2 border-t border-gray-100 bg-yellow-50 px-4 py-3 first:border-t-0">
                  <label className="block min-w-40 flex-1">
                    <span className="text-xs text-gray-600">Name</span>
                    <input value={recipientDraft.full_name} onChange={(e) => setRecipientDraft({ ...recipientDraft, full_name: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                  </label>
                  <label className="block min-w-60 flex-[2]">
                    <span className="text-xs text-gray-600">Address</span>
                    <input value={recipientDraft.address} onChange={(e) => setRecipientDraft({ ...recipientDraft, address: e.target.value })} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
                  </label>
                  <button onClick={() => saveRecipient(recipient.id)} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
                    Save
                  </button>
                  <button onClick={() => setEditingRecipientId(null)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
                    Cancel
                  </button>
                </li>
              ) : (
                <li
                  key={recipient.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-100 px-4 py-2 first:border-t-0 ${recipient.active ? "" : "text-gray-400"}`}
                >
                  <span className={`font-medium ${recipient.active ? "text-gray-900" : ""}`}>
                    {recipient.full_name}
                    {!recipient.active && " (inactive)"}
                  </span>
                  <span className="flex-1 text-gray-500">{recipient.address}</span>
                  {/* per un privato si modifica dalla scheda del cliente */}
                  {client.client_type === "company" && (
                    <span className="flex gap-1">
                      <button onClick={() => startEditingRecipient(recipient)} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100">
                        Edit
                      </button>
                      <button onClick={() => toggleRecipient(recipient)} className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100">
                        {recipient.active ? "Deactivate" : "Activate"}
                      </button>
                    </span>
                  )}
                </li>
              )
            )}
          </ul>
        )}
        {recipientError && <p className="border-t border-gray-100 px-4 py-2 text-sm text-red-600">{recipientError}</p>}

        {/* Per le compagnie si possono aggiungere assistiti; un privato ha solo sé stesso */}
        {client.client_type === "company" && (
          <form onSubmit={addRecipient} className="flex flex-wrap items-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
            <label className="block min-w-40 flex-1">
              <span className="text-xs text-gray-600">Name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block min-w-60 flex-[2]">
              <span className="text-xs text-gray-600">Address</span>
              <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <button type="submit" disabled={adding} className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
              {adding ? "Adding..." : "Add care recipient"}
            </button>
            {addError && <p className="w-full text-sm text-red-600">{addError}</p>}
          </form>
        )}
      </section>

      {/* Tariffe personalizzate */}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 font-medium text-gray-900">Custom rates</h2>
        {rates.length === 0 ? (
          <p className="px-4 py-6 text-gray-500">This client uses the default rates for every service.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Applies to</th>
                <th className="px-4 py-2 text-right font-medium">Default</th>
                <th className="px-4 py-2 text-right font-medium">Custom rate</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((rate) => (
                <tr key={rate.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{rate.services.description}</td>
                  <td className="px-4 py-2">
                    {rate.care_recipients ? rate.care_recipients.full_name : "Whole client"}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400 line-through">
                    {formatCurrency(rate.services.default_rate)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {formatCurrency(rate.rate)} / {rate.services.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Fatture del cliente */}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 font-medium text-gray-900">Invoices</h2>
        {invoices.length === 0 ? (
          <p className="px-4 py-6 text-gray-500">No invoices for this client yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Invoice #</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Period</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2">
                    <Link href={`/invoices/${invoice.id}`} className="font-medium text-blue-700 hover:underline">
                      {invoice.invoice_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{formatDate(invoice.issue_date)}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {formatDate(invoice.period_start)} – {formatDate(invoice.period_end)}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[invoice.status]}`}>
                      {invoice.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(invoice.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
