"use client";

import { useMemo, useState } from "react";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import type { SheetColumn, SheetColumnFormat, SheetColumnType } from "@/app/_types/types";
import { SHEET_COLUMN_TYPES } from "@/app/utils/sheetColumns";
import { SHEET_DATE_FORMATS } from "@timely/contract/sheetTypes";
import { formatCurrency, formatDateValue, SHEET_CURRENCY_CHOICES } from "@timely/contract/sheetDisplay";
import Select from "@/app/_components/_ui/select";
import SegmentedControl from "@/app/_components/_ui/segmentedControl";
import { controlClass } from "@/app/_components/_ui/field";

const NUMERIC: SheetColumnType[] = ["number", "currency", "percent", "formula"];

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function currencyLabel(code: string) {
  try {
    const name = new Intl.DisplayNames(undefined, { type: "currency" }).of(code);
    return name && name !== code ? `${code} · ${name}` : code;
  } catch {
    return code;
  }
}

/**
 * The column header's settings: its type, and how its values look (currency,
 * date style, decimal places). Changes apply to the whole column at once.
 */
export default function SheetColumnSettings({
  column,
  onType,
  onFormat,
  onEditOptions,
}: {
  column: SheetColumn;
  onType: (type: SheetColumnType) => void;
  onFormat: (patch: Partial<SheetColumnFormat>) => void;
  onEditOptions: () => void;
}) {
  const format = column.format ?? {};
  const [customCurrency, setCustomCurrency] = useState("");
  const today = useMemo(() => todayIso(), []);
  const knownCurrency = !format.currency || (SHEET_CURRENCY_CHOICES as readonly string[]).includes(format.currency);
  const currencyOptions = [
    { value: "", label: "No symbol" },
    ...SHEET_CURRENCY_CHOICES.map((code) => ({ value: code, label: currencyLabel(code) })),
    ...(knownCurrency ? [] : [{ value: format.currency!, label: format.currency! }]),
  ];

  return (
    <div className="w-64 space-y-3 p-1">
      <section>
        <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Type</p>
        <div className="grid grid-cols-2 gap-0.5">
          {SHEET_COLUMN_TYPES.map((option) => {
            const active = column.type === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onType(option.value)}
                className={`flex items-center justify-between rounded-md px-2 py-1 text-left text-xs transition-colors ${
                  active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                }`}
              >
                {option.label}
                {active ? <Check className="size-3" /> : null}
              </button>
            );
          })}
        </div>
        {column.type === "select" ? (
          <button
            type="button"
            onClick={onEditOptions}
            className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-primary hover:bg-accent/60"
          >
            Edit dropdown options…
          </button>
        ) : null}
      </section>

      {column.type === "currency" ? (
        <section className="border-t border-border pt-2">
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Currency</p>
          <Select
            size="sm"
            searchable
            value={format.currency ?? ""}
            onChange={(value) => onFormat({ currency: value || undefined })}
            options={currencyOptions}
            aria-label="Currency"
          />
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={customCurrency}
              onChange={(event) => setCustomCurrency(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && customCurrency.trim()) {
                  onFormat({ currency: customCurrency.trim().slice(0, 8) });
                  setCustomCurrency("");
                }
              }}
              placeholder="Other code or symbol"
              aria-label="Other currency"
              className={controlClass("sm", "min-w-0 flex-1 text-xs")}
            />
          </div>
          <p className="mt-1 px-1 text-[11px] text-muted-foreground">
            Shows as {formatCurrency(1250, format.currency, format.decimals ?? 2)}
          </p>
        </section>
      ) : null}

      {column.type === "date" ? (
        <section className="border-t border-border pt-2">
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Date style</p>
          <div className="grid grid-cols-2 gap-0.5">
            {SHEET_DATE_FORMATS.map((style) => {
              const active = (format.dateFormat ?? "yyyy-mm-dd") === style;
              return (
                <button
                  key={style}
                  type="button"
                  title={style}
                  onClick={() => onFormat({ dateFormat: style === "yyyy-mm-dd" ? undefined : style })}
                  className={`truncate rounded-md px-2 py-1 text-left text-xs tabular-nums transition-colors ${
                    active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                  }`}
                >
                  {formatDateValue(today, style)}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {NUMERIC.includes(column.type) ? (
        <section className="border-t border-border pt-2">
          <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Decimal places</p>
          <SegmentedControl
            size="sm"
            fill
            value={format.decimals === undefined ? "auto" : String(format.decimals)}
            onChange={(value) => onFormat({ decimals: value === "auto" ? undefined : Number(value) })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "0", label: "0" },
              { value: "1", label: "1" },
              { value: "2", label: "2" },
              { value: "3", label: "3" },
            ]}
            aria-label="Decimal places"
          />
        </section>
      ) : null}
    </div>
  );
}
