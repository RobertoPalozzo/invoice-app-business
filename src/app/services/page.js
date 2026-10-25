"use client";
// =====================================================================
// Servizi e tariffe — /services
//
// Sezione 1: SERVICES — il catalogo delle prestazioni con la tariffa base.
//   I servizi non si cancellano (le fatture vecchie li usano):
//   si disattivano, e spariscono dal form delle nuove fatture.
//   "Weekend version": il servizio da usare al sabato e alla domenica;
//   il form delle fatture passa da solo da Weekday a Weekend.
//
// Sezione 2: CUSTOM RATES — tariffe che sostituiscono quella base
//   per un cliente intero o per un singolo assistito.
//   È la tabella letta da get_rate() con la regola:
//   assistito → cliente → tariffa base.
//   Cambiare una tariffa NON modifica le fatture già emesse,
//   perché ogni riga di fattura conserva il prezzo usato.
//
// Due schede, SAH e Private: ognuna mostra i servizi del suo programma
// (più quelli "All clients", es. i Km) e le tariffe dei suoi clienti.
// =====================================================================
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { formatCurrency } from "@/lib/format";
import { PROGRAM_LABELS, PROGRAM_STYLES, serviceFitsProgram } from "@/lib/programs";
import ProgramTabs from "@/components/ProgramTabs";

const inputClass = "w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm";
const EMPTY_SERVICE = { description: "", unit: "hours", default_rate: "", weekend_service_id: "", program: "" };

// Scelte per "For" (a chi è destinato un servizio)
const PROGRAM_OPTIONS = [
  { value: "sah", label: "SAH only" },
  { value: "private", label: "Private only" },
  { value: "all", label: "All clients" },
];
const EMPTY_RATE = { service_id: "", client_id: "", care_recipient_id: "", rate: "", notes: "" };

export default function ServicesPage() {
  const [services, setServices] = useState([]);
  const [rates, setRates] = useState([]);
  const [clients, setClients] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [newService, setNewService] = useState(EMPTY_SERVICE);
  const [editingServiceId, setEditingServiceId] = useState(null);
  const [serviceDraft, setServiceDraft] = useState(EMPTY_SERVICE);

  const [newRate, setNewRate] = useState(EMPTY_RATE);
  const [editingRateId, setEditingRateId] = useState(null);
  const [rateDraft, setRateDraft] = useState("");

  const [message, setMessage] = useState(null); // { type, text }
  const [showInactive, setShowInactive] = useState(false); // mostra anche i servizi disattivati
  const [tab, setTab] = useState("sah"); // scheda aperta: 'sah' o 'private'

  // Carica tutto ciò che serve alla pagina
  async function loadAll() {
    const [servicesResult, ratesResult, clientsResult, recipientsResult] = await Promise.all([
      supabase.from("services").select("*").order("description"),
      supabase
        .from("rates")
        .select("*, services(description, unit, default_rate), clients(client_code, contact_name, program), care_recipients(full_name, clients(client_code, program))")
        .order("id"),
      supabase.from("clients").select("id, client_code, contact_name, active, program").order("client_code"),
      supabase.from("care_recipients").select("id, client_id, full_name, active").order("full_name"),
    ]);
    const firstError = servicesResult.error || ratesResult.error || clientsResult.error || recipientsResult.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setServices(servicesResult.data);
      setRates(ratesResult.data);
      setClients(clientsResult.data);
      setRecipients(recipientsResult.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    // loadAll è async: lo stato si aggiorna dopo la risposta di Supabase
    async function init() {
      await loadAll();
    }
    init();
  }, []);

  // Traduce gli errori più comuni in messaggi comprensibili
  function showError(err) {
    const text =
      err.code === "23505"
        ? "A custom rate for this service already exists here. Edit the existing one instead."
        : err.message;
    setMessage({ type: "error", text });
  }

  // ================= SERVICES =================

  async function addService(event) {
    event.preventDefault();
    const rate = Number(newService.default_rate);
    if (!newService.description.trim() || newService.default_rate === "" || rate < 0) {
      setMessage({ type: "error", text: "Enter a description and a valid default rate." });
      return;
    }
    const { error } = await supabase.from("services").insert({
      description: newService.description.trim(),
      unit: newService.unit.trim() || "hours",
      default_rate: rate,
      program: newService.program || tab, // se non scelto: il programma della scheda aperta
    });
    if (error) return showError(error);
    setNewService(EMPTY_SERVICE);
    setMessage({ type: "ok", text: "Service added." });
    loadAll();
  }

  function startEditService(service) {
    setEditingServiceId(service.id);
    setServiceDraft({
      description: service.description,
      unit: service.unit,
      default_rate: String(service.default_rate),
      weekend_service_id: service.weekend_service_id ? String(service.weekend_service_id) : "",
      program: service.program,
    });
  }

  async function saveService(id) {
    const rate = Number(serviceDraft.default_rate);
    if (!serviceDraft.description.trim() || serviceDraft.default_rate === "" || rate < 0) {
      setMessage({ type: "error", text: "Enter a description and a valid default rate." });
      return;
    }
    const { error } = await supabase
      .from("services")
      .update({
        description: serviceDraft.description.trim(),
        unit: serviceDraft.unit.trim(),
        default_rate: rate,
        weekend_service_id: serviceDraft.weekend_service_id ? Number(serviceDraft.weekend_service_id) : null,
        program: serviceDraft.program,
      })
      .eq("id", id);
    if (error) return showError(error);
    setEditingServiceId(null);
    setMessage({ type: "ok", text: "Service updated. Existing invoices are not affected." });
    loadAll();
  }

  async function toggleService(service) {
    const { error } = await supabase.from("services").update({ active: !service.active }).eq("id", service.id);
    if (error) return showError(error);
    loadAll();
  }

  // Cancella un servizio che non serve più (DELETE).
  // Se è già usato in qualche fattura il database lo impedisce
  // (chiave esterna "on delete restrict"): in quel caso si disattiva.
  // Le sue tariffe personalizzate si cancellano insieme (on delete cascade)
  // e i collegamenti "Weekend version" che puntavano a lui si svuotano.
  async function deleteService(service) {
    const ok = window.confirm(
      `Delete "${service.description}"?\n\nIts custom rates will be removed too. This cannot be undone.`
    );
    if (!ok) return;

    const { error } = await supabase.from("services").delete().eq("id", service.id);
    if (error) {
      // 23503 = violazione di chiave esterna: il servizio compare in qualche fattura
      if (error.code === "23503") {
        setMessage({
          type: "error",
          text: `"${service.description}" is used in existing invoices, so it can't be deleted. Use Deactivate instead: it disappears from new invoices but old ones stay correct.`,
        });
      } else {
        showError(error);
      }
      return;
    }
    setMessage({ type: "ok", text: `"${service.description}" deleted.` });
    loadAll();
  }

  // ================= CUSTOM RATES =================

  async function addRate(event) {
    event.preventDefault();
    const rate = Number(newRate.rate);
    if (!newRate.service_id || !newRate.client_id || newRate.rate === "" || rate < 0) {
      setMessage({ type: "error", text: "Choose a service and a client, and enter a valid rate." });
      return;
    }
    // Se è scelto un assistito, la tariffa vale solo per lui;
    // altrimenti vale per tutto il cliente.
    const row = newRate.care_recipient_id
      ? { care_recipient_id: Number(newRate.care_recipient_id), client_id: null }
      : { client_id: Number(newRate.client_id), care_recipient_id: null };

    const { error } = await supabase.from("rates").insert({
      ...row,
      service_id: Number(newRate.service_id),
      rate,
      notes: newRate.notes.trim() || null,
    });
    if (error) return showError(error);
    setNewRate(EMPTY_RATE);
    setMessage({ type: "ok", text: "Custom rate added. It applies to new invoice lines." });
    loadAll();
  }

  async function saveRate(id) {
    const rate = Number(rateDraft);
    if (rateDraft === "" || rate < 0) {
      setMessage({ type: "error", text: "Enter a valid rate." });
      return;
    }
    const { error } = await supabase.from("rates").update({ rate }).eq("id", id);
    if (error) return showError(error);
    setEditingRateId(null);
    setMessage({ type: "ok", text: "Rate updated. Existing invoices are not affected." });
    loadAll();
  }

  async function deleteRate(rate) {
    if (!window.confirm("Remove this custom rate? The default rate will be used again for new lines.")) return;
    const { error } = await supabase.from("rates").delete().eq("id", rate.id);
    if (error) return showError(error);
    setMessage({ type: "ok", text: "Custom rate removed." });
    loadAll();
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-600">Could not load services: {error}</p>;

  const recipientsOfClient = recipients.filter((r) => String(r.client_id) === newRate.client_id && r.active);

  // ----- Cosa mostra la scheda aperta -----
  // servizi del programma della scheda + quelli per tutti
  const shownServices = services.filter((s) => showInactive || s.active);
  const tabServices = shownServices.filter((s) => serviceFitsProgram(s, tab) || s.id === editingServiceId);
  const serviceCounts = {
    sah: shownServices.filter((s) => serviceFitsProgram(s, "sah")).length,
    private: shownServices.filter((s) => serviceFitsProgram(s, "private")).length,
  };
  // tariffe dei clienti di questo programma (per tutto il cliente o per un suo assistito)
  const rateProgram = (rate) => rate.clients?.program ?? rate.care_recipients?.clients?.program;
  const tabRates = rates.filter((rate) => rateProgram(rate) === tab);
  const smallButton = "rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Services &amp; Rates</h1>

      {message && (
        <p className={`rounded-md px-4 py-2 text-sm ${message.type === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}

      <ProgramTabs
        value={tab}
        onChange={(value) => {
          setTab(value);
          setEditingServiceId(null);
          setEditingRateId(null);
          setNewRate(EMPTY_RATE); // il cliente scelto apparteneva all'altra scheda
        }}
        counts={serviceCounts}
      />

      {/* ================= SERVICES ================= */}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <h2 className="font-medium text-gray-900">Services</h2>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive ({services.filter((s) => !s.active && serviceFitsProgram(s, tab)).length})
          </label>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-gray-500">
            <tr>
              <th className="px-4 py-2 font-medium">Description</th>
              <th className="px-4 py-2 font-medium">Unit</th>
              <th className="px-4 py-2 text-right font-medium">Default rate</th>
              <th className="px-4 py-2 font-medium">Weekend version</th>
              <th className="px-4 py-2 font-medium">For</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {tabServices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                  No {tab === "sah" ? "SAH" : "private"} services yet.
                </td>
              </tr>
            )}
            {tabServices.map((service) =>
              editingServiceId === service.id ? (
                <tr key={service.id} className="border-t border-gray-100 bg-yellow-50">
                  <td className="px-4 py-2">
                    <input value={serviceDraft.description} onChange={(e) => setServiceDraft({ ...serviceDraft, description: e.target.value })} className={inputClass} />
                  </td>
                  <td className="px-4 py-2">
                    <input value={serviceDraft.unit} onChange={(e) => setServiceDraft({ ...serviceDraft, unit: e.target.value })} className={`${inputClass} w-20`} />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" step="0.01" min="0" value={serviceDraft.default_rate} onChange={(e) => setServiceDraft({ ...serviceDraft, default_rate: e.target.value })} className={`${inputClass} w-24 text-right`} />
                  </td>
                  <td className="px-4 py-2">
                    {/* servizi con la stessa unità, escluso sé stesso */}
                    <select
                      value={serviceDraft.weekend_service_id}
                      onChange={(e) => setServiceDraft({ ...serviceDraft, weekend_service_id: e.target.value })}
                      className={inputClass}
                    >
                      <option value="">None</option>
                      {services
                        .filter((s) => s.id !== service.id && s.unit.trim().toLowerCase() === serviceDraft.unit.trim().toLowerCase())
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.description} ({formatCurrency(s.default_rate)})
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select value={serviceDraft.program} onChange={(e) => setServiceDraft({ ...serviceDraft, program: e.target.value })} className={inputClass}>
                      {PROGRAM_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </td>
                  <td></td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button onClick={() => saveService(service.id)} className="mr-1 rounded-md bg-gray-900 px-2 py-1 text-xs text-white">Save</button>
                    <button onClick={() => setEditingServiceId(null)} className={smallButton}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={service.id} className={`border-t border-gray-100 ${service.active ? "" : "text-gray-400"}`}>
                  <td className="px-4 py-2">{service.description}</td>
                  <td className="px-4 py-2">{service.unit}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(service.default_rate)}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {services.find((s) => s.id === service.weekend_service_id)?.description ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PROGRAM_STYLES[service.program]}`}>
                      {PROGRAM_LABELS[service.program]}
                    </span>
                  </td>
                  <td className="px-4 py-2">{service.active ? "Active" : "Inactive"}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button onClick={() => startEditService(service)} className={`${smallButton} mr-1`}>Edit</button>
                    <button onClick={() => toggleService(service)} className={`${smallButton} mr-1`}>
                      {service.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => deleteService(service)}
                      className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>

        {/* Aggiungi servizio */}
        <form onSubmit={addService} className="flex flex-wrap items-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <label className="block min-w-60 flex-[3]">
            <span className="text-xs text-gray-600">New service description</span>
            <input value={newService.description} onChange={(e) => setNewService({ ...newService, description: e.target.value })} className={inputClass} />
          </label>
          <label className="block w-24">
            <span className="text-xs text-gray-600">Unit</span>
            <input value={newService.unit} onChange={(e) => setNewService({ ...newService, unit: e.target.value })} className={inputClass} />
          </label>
          <label className="block w-28">
            <span className="text-xs text-gray-600">Default rate $</span>
            <input type="number" step="0.01" min="0" value={newService.default_rate} onChange={(e) => setNewService({ ...newService, default_rate: e.target.value })} className={inputClass} />
          </label>
          <label className="block w-36">
            <span className="text-xs text-gray-600">For</span>
            <select value={newService.program || tab} onChange={(e) => setNewService({ ...newService, program: e.target.value })} className={inputClass}>
              {PROGRAM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
            Add service
          </button>
        </form>
        <p className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
          Use the unit “Km” for mileage services: they appear in the mileage lines of the invoice form. To charge a
          higher weekend rate, add a “… Weekend” service, then edit the weekday service and choose it as its weekend
          version. “For” decides which clients can use a service: SAH only, Private only, or All clients (e.g. mileage).
        </p>
      </section>

      {/* ================= CUSTOM RATES ================= */}
      <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="font-medium text-gray-900">Custom rates</h2>
          <p className="text-xs text-gray-500">
            Which rate is used: care recipient rate → client rate → default rate (the most specific wins).
          </p>
        </div>

        {tabRates.length === 0 ? (
          <p className="px-4 py-6 text-gray-500">No custom rates: every {tab === "sah" ? "SAH" : "private"} client uses the default rates.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium">Applies to</th>
                <th className="px-4 py-2 text-right font-medium">Default</th>
                <th className="px-4 py-2 text-right font-medium">Custom rate</th>
                <th className="px-4 py-2 font-medium">Notes</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tabRates.map((rate) => (
                <tr key={rate.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{rate.services.description}</td>
                  <td className="px-4 py-2">
                    {rate.care_recipients ? (
                      <>
                        {rate.care_recipients.full_name}{" "}
                        <span className="text-gray-400">(recipient · {rate.care_recipients.clients.client_code})</span>
                      </>
                    ) : (
                      <>
                        {rate.clients.contact_name} <span className="text-gray-400">(whole client · {rate.clients.client_code})</span>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-400 line-through">{formatCurrency(rate.services.default_rate)}</td>
                  <td className="px-4 py-2 text-right font-medium">
                    {editingRateId === rate.id ? (
                      <input type="number" step="0.01" min="0" value={rateDraft} onChange={(e) => setRateDraft(e.target.value)} className="w-24 rounded-md border border-gray-300 px-2 py-1 text-right text-sm" />
                    ) : (
                      `${formatCurrency(rate.rate)} / ${rate.services.unit}`
                    )}
                  </td>
                  <td className="px-4 py-2 text-gray-500">{rate.notes}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {editingRateId === rate.id ? (
                      <>
                        <button onClick={() => saveRate(rate.id)} className="mr-1 rounded-md bg-gray-900 px-2 py-1 text-xs text-white">Save</button>
                        <button onClick={() => setEditingRateId(null)} className={smallButton}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingRateId(rate.id);
                            setRateDraft(String(rate.rate));
                          }}
                          className={`${smallButton} mr-1`}
                        >
                          Edit
                        </button>
                        <button onClick={() => deleteRate(rate)} className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50">
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Aggiungi tariffa personalizzata */}
        <form onSubmit={addRate} className="grid gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:grid-cols-6">
          <label className="block sm:col-span-2">
            <span className="text-xs text-gray-600">Service</span>
            <select value={newRate.service_id} onChange={(e) => setNewRate({ ...newRate, service_id: e.target.value })} className={inputClass}>
              <option value="">Choose...</option>
              {services.filter((s) => s.active && serviceFitsProgram(s, tab)).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.description} ({formatCurrency(s.default_rate)}/{s.unit})
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-gray-600">Client</span>
            <select
              value={newRate.client_id}
              onChange={(e) => setNewRate({ ...newRate, client_id: e.target.value, care_recipient_id: "" })}
              className={inputClass}
            >
              <option value="">Choose...</option>
              {clients.filter((c) => c.active && c.program === tab).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.client_code} – {c.contact_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-gray-600">Care recipient (optional)</span>
            <select
              value={newRate.care_recipient_id}
              disabled={!newRate.client_id}
              onChange={(e) => setNewRate({ ...newRate, care_recipient_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Whole client</option>
              {recipientsOfClient.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-gray-600">Rate $</span>
            <input type="number" step="0.01" min="0" value={newRate.rate} onChange={(e) => setNewRate({ ...newRate, rate: e.target.value })} className={inputClass} />
          </label>
          <label className="block sm:col-span-4">
            <span className="text-xs text-gray-600">Notes (optional)</span>
            <input value={newRate.notes} onChange={(e) => setNewRate({ ...newRate, notes: e.target.value })} className={inputClass} />
          </label>
          <div className="flex items-end">
            <button type="submit" className="w-full rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
              Add rate
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
