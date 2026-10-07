"use client";

import { useRef } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A row of mutually exclusive choices on a grey track, the chosen one raised on a white tile. A radio group:
 * arrow keys move and select, Home and End jump.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, disabled = false }: { label: string; options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; disabled?: boolean }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = options.length - 1;
    const next = event.key === "ArrowRight" || event.key === "ArrowDown" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-control bg-[#f5f5f4] p-1">
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-9 rounded-[8px] px-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border border-line bg-surface font-medium shadow-sm" : "border border-transparent text-[#57534e] hover:text-foreground"}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
