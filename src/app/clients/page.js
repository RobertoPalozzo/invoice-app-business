"use client";
// =====================================================================
// Elenco clienti — /clients
// Mostra tutti i clienti e permette di aggiungerne uno nuovo.
//   - il codice cliente (CLI004, CLI005...) si calcola da solo
//   - per un cliente privato si crea anche l'assistito con gli stessi
//     dati, perché il privato riceve il servizio per sé
// =====================================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

const inputClass = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";

// Valori vuoti del form "New client"
const EMPTY_CLIENT = {
  client_type: "company",
  contact_name: "",
  company: "",
  contact_person: "",
  address: "",
  phone: "",
  email: "",
  abn: "",
};

// ["CLI001", "CLI007"] → "CLI008"
function nextClientCode(codes) {
  const numbers = codes.map((code) => parseInt(code.replace(/\D/g, ""), 10)).filter((n) => !Number.isNaN(n));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `CLI${String(next).padStart(3, "0")}`;
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showInactive, setShowInactive] = useState(false);

  // Form "New client"
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_CLIENT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    async function loadClients() {
      const { data, error } = await supabase
        .from("clients")
        // anche gli assistiti di ogni cliente, per riconoscerlo meglio nell'elenco
        .select("*, care_recipients(full_name, active)")
        .order("client_code");
      if (error) setError(error.message);
      else setClients(data);
      setLoading(false);
    }
    loadClients();
  }, []);

  // Aggiorna un solo campo del form
  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event) {
    event.preventDefault();
    if (!form.contact_name.trim()) {
      setFormError("Enter the name to print on the invoice.");
      return;
    }
    setSaving(true);
    setFormError(null);

    // Codice calcolato al momento del salvataggio, dai codici esistenti
    const { data: codes } = await supabase.from("clients").select("client_code");
    const clientCode = nextClientCode((codes ?? []).map((c) => c.client_code));

    // stringhe vuote → null, così nel database restano campi vuoti veri
    const clean = (value) => value.trim() || null;

    const { data: newClient, error: insertError } = await supabase
      .from("clients")
      .insert({
        client_code: clientCode,
        client_type: form.client_type,
        contact_name: form.contact_name.trim(),
        company: form.client_type === "company" ? clean(form.company) : null,
        contact_person: form.client_type === "company" ? clean(form.contact_person) : null,
        address: clean(form.address),
        phone: clean(form.phone),
        email: clean(form.email),
        abn: clean(form.abn),
      })
      .select("id")
      .single();

    if (insertError) {
      setFormError(`Could not create the client: ${insertError.message}`);
      setSaving(false);
      return;
    }

    // Cliente privato: è anche l'assistito di sé stesso
    if (form.client_type === "private") {
      await supabase.from("care_recipients").insert({
        client_id: newClient.id,
        full_name: form.contact_name.trim(),
        address: clean(form.address),
      });
    }

    router.push(`/clients/${newClient.id}`);
  }

  const visible = clients.filter((c) => showInactive || c.active);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Clients</h1>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
            New client
          </button>
        )}
      </div>

      {/* ----- Form nuovo cliente ----- */}
      {showForm && (
        <form onSubmit={handleCreate} className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
          <h2 className="font-medium text-gray-900 sm:col-span-2">New client</h2>

          <fieldset className="flex gap-4 text-sm sm:col-span-2">
            <label className="flex items-center gap-2">
              <input type="radio" checked={form.client_type === "company"} onChange={() => setField("client_type", "company")} />
              Company (pays for several care recipients)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={form.client_type === "private"} onChange={() => setField("client_type", "private")} />
              Private (receives the service personally)
            </label>
          </fieldset>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              {form.client_type === "private" ? "Client name (Bill to)" : "Company name (Bill to)"}
            </span>
            <input value={form.contact_name} onChange={(e) => setField("contact_name", e.target.value)} className={inputClass} />
            <span className="text-xs text-gray-500">First line under BILL TO on the invoice.</span>
          </label>

          {form.client_type === "company" && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Contact person (optional, internal)</span>
              <input value={form.contact_person} onChange={(e) => setField("contact_person", e.target.value)} placeholder="e.g. William Saad" className={inputClass} />
              <span className="text-xs text-gray-500">Internal reference only: never printed on the invoice.</span>
            </label>
          )}

          {form.client_type === "company" && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Works for (optional, internal)</span>
              <input value={form.company} onChange={(e) => setField("company", e.target.value)} placeholder="e.g. Stone Community Care Pty Ltd" className={inputClass} />
              <span className="text-xs text-gray-500">Internal reference only: never printed on the invoice.</span>
            </label>
          )}

          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-gray-700">Address</span>
            <input value={form.address} onChange={(e) => setField("address", e.target.value)} className={inputClass} />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Phone</span>
            <input value={form.phone} onChange={(e) => setField("phone", e.target.value)} className={inputClass} />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Email</span>
            <input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} className={inputClass} />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">ABN (optional)</span>
            <input value={form.abn} onChange={(e) => setField("abn", e.target.value)} className={inputClass} />
          </label>

          {form.client_type === "private" && (
            <p className="self-end text-xs text-gray-500">
              A care recipient with the same name and address will be created automatically.
            </p>
          )}

          {formError && <p className="text-sm text-red-600 sm:col-span-2">{formError}</p>}

          <div className="flex justify-end gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_CLIENT);
                setFormError(null);
              }}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50">
              {saving ? "Saving..." : "Create client"}
            </button>
          </div>
        </form>
      )}

      {/* ----- Elenco ----- */}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <div className="flex justify-end border-b border-gray-200 px-4 py-2">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive clients ({clients.filter((c) => !c.active).length})
          </label>
        </div>

        {loading && <p className="px-4 py-6 text-gray-500">Loading clients...</p>}
        {error && <p className="px-4 py-6 text-red-600">Could not load clients: {error}</p>}
        {!loading && !error && visible.length === 0 && <p className="px-4 py-6 text-gray-500">No clients yet.</p>}

        {!loading && !error && visible.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Bill to</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Care recipients</th>
                <th className="px-4 py-2 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((client) => {
                // assistiti attivi: i primi 3 nomi + "+N" per gli altri
                const names = (client.care_recipients ?? []).filter((r) => r.active).map((r) => r.full_name).sort();
                const preview = names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
                return (
                  <tr key={client.id} className={`border-t border-gray-100 align-top hover:bg-gray-50 ${client.active ? "" : "text-gray-400"}`}>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-gray-700">{client.client_code}</td>
                    <td className="px-4 py-2">
                      <Link href={`/clients/${client.id}`} className="font-medium text-blue-700 hover:underline">
                        {client.contact_name}
                      </Link>
                      {!client.active && " (inactive)"}
                      {(client.contact_person || client.company) && (
                        <div className="text-xs text-gray-500">
                          {[client.contact_person, client.company && `for ${client.company}`].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-700">{client.email ?? "—"}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {client.client_type === "private" ? (
                        <span className="text-gray-400">—</span>
                      ) : names.length === 0 ? (
                        <span className="text-gray-400">none</span>
                      ) : (
                        <>
                          <span className="font-medium">{names.length}</span>
                          <div className="text-xs text-gray-500">{preview}</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          client.client_type === "private" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {client.client_type}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
