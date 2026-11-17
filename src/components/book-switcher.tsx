"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, Library, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export type SwitcherBook = { id: string; name: string; templateLabel: string };

const itemClass =
  "flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-sunken";

/**
 * Book picker. The popup grows from its trigger (origin-aware) and fades,
 * quick on the way in and quicker on the way out.
 */
export function BookSwitcher({
  books,
  currentId,
  tone = "rail",
}: {
  books: SwitcherBook[];
  currentId?: string;
  tone?: "rail" | "paper";
}) {
  const current = books.find((b) => b.id === currentId);
  // Opened from the keyboard: show the menu instantly, no scale or fade.
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const triggerTone =
    tone === "rail"
      ? "bg-rail-raised text-rail-ink hover:bg-rail-active data-[popup-open]:bg-rail-active"
      : "border border-rule-strong bg-surface text-ink";

  return (
    <Menu.Root>
      <Menu.Trigger
        onPointerDown={() => setFromKeyboard(false)}
        onKeyDown={() => setFromKeyboard(true)}
        className={`flex h-11 w-full min-w-0 items-center gap-2.5 rounded-lg px-3 text-left transition-[background-color,transform] duration-150 active:scale-[0.98] ${triggerTone}`}
      >
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium">{current?.name ?? "Choose a book"}</span>
          {current ? (
            <span
              className={`truncate text-xs ${tone === "rail" ? "text-rail-muted" : "text-ink-muted"}`}
            >
              {current.templateLabel}
            </span>
          ) : null}
        </span>
        <ChevronsUpDown size={15} aria-hidden className="shrink-0 opacity-70" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="start" className="z-50 outline-none">
          <Menu.Popup
            className={`w-[min(18rem,calc(100vw-2rem))] origin-[var(--transform-origin)] rounded-xl border border-rule bg-surface p-1.5 shadow-[var(--shadow-float)] outline-none transition-[scale,opacity] duration-150 ease-[var(--ease-out)] data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 ${fromKeyboard ? "!transition-none" : ""}`}
          >
            <Menu.Group>
              <Menu.GroupLabel className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-muted">
                Your books
              </Menu.GroupLabel>
              {books.map((b) => (
                <Menu.LinkItem
                  key={b.id}
                  render={<Link href={`/books/${b.id}/accounts`} />}
                  className={itemClass}
                >
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  {b.id === currentId ? (
                    <Check size={15} aria-label="Current book" className="text-signal-ink" />
                  ) : null}
                </Menu.LinkItem>
              ))}
            </Menu.Group>
            <Menu.Separator className="my-1.5 h-px bg-rule" />
            <Menu.LinkItem render={<Link href="/books/new" />} className={itemClass}>
              <Plus size={15} aria-hidden className="text-ink-muted" />
              New book
            </Menu.LinkItem>
            <Menu.LinkItem render={<Link href="/books" />} className={itemClass}>
              <Library size={15} aria-hidden className="text-ink-muted" />
              All books
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
