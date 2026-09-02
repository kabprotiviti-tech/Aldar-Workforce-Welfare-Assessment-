"use client";

import { useId, useRef, useState } from "react";

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  defaultTabId?: string;
  className?: string;
}

/** Accessible tabs: roving tabindex, arrow/Home/End keyboard navigation. */
export function Tabs({ items, defaultTabId, className = "" }: TabsProps) {
  const [activeId, setActiveId] = useState(defaultTabId ?? items[0]?.id);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const baseId = useId();

  function focusAndSelect(index: number) {
    const item = items[(index + items.length) % items.length];
    if (!item) return;
    setActiveId(item.id);
    tabRefs.current[item.id]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAndSelect(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAndSelect(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusAndSelect(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAndSelect(items.length - 1);
    }
  }

  const activeItem = items.find((item) => item.id === activeId) ?? items[0];

  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 border-b border-ds-line">
        {items.map((item, index) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              ref={(el) => {
                tabRefs.current[item.id] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`ds-focus-ring -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                selected ? "border-ds-accent text-ds-ink" : "border-transparent text-ds-ink-2 hover:text-ds-ink"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeItem && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${activeItem.id}`}
          aria-labelledby={`${baseId}-tab-${activeItem.id}`}
          tabIndex={0}
          className="ds-focus-ring pt-4"
        >
          {activeItem.content}
        </div>
      )}
    </div>
  );
}
