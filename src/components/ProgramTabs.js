"use client";
// =====================================================================
// ProgramTabs — le due schede "SAH" e "Private"
//   <ProgramTabs value={tab} onChange={setTab} counts={{ sah: 4, private: 3 }} />
// value    → la scheda aperta ('sah' o 'private')
// onChange → chiamata con la scheda scelta
// counts   → (facoltativo) quanti elementi ci sono in ogni scheda
// =====================================================================
import { PROGRAM_TABS } from "@/lib/programs";

export default function ProgramTabs({ value, onChange, counts }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-gray-200">
      {PROGRAM_TABS.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              active
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
            }`}
          >
            {tab.label}
            {counts && <span className="ml-1.5 text-xs font-normal text-gray-400">{counts[tab.value] ?? 0}</span>}
          </button>
        );
      })}
    </div>
  );
}
