"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronsUpDown, ExternalLink, LogOut, Users } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { signOutAction } from "@/app/(auth)/login/actions";
import { APP_NAME, APP_VERSION, CHANGELOG_URL } from "@/lib/app-config";
import { THEME_OPTIONS, useTheme } from "./theme-toggle";

const itemClass =
  "flex h-9 cursor-default select-none items-center gap-2.5 rounded-md px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-sunken";

/**
 * Who is signed in, as one button at the foot of the rail. Its menu holds the
 * rarely used things: theme, People (admins), signing out, and the version.
 */
export function AccountMenu({
  name,
  email,
  admin,
}: {
  name: string;
  email: string;
  admin: boolean;
}) {
  const [theme, setTheme] = useTheme();
  const [fromKeyboard, setFromKeyboard] = useState(false);
  const [signingOut, startSignOut] = useTransition();
  const initial = (name.trim()[0] ?? "?").toUpperCase();

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Account: ${name}`}
        onPointerDown={() => setFromKeyboard(false)}
        onKeyDown={() => setFromKeyboard(true)}
        className="flex h-12 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left transition-[background-color,scale] duration-150 hover:bg-rail-raised active:scale-[0.98] data-[popup-open]:bg-rail-raised"
      >
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-rail-active text-sm font-semibold text-rail-ink"
        >
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-rail-ink">{name}</span>
          <span className="truncate text-xs text-rail-muted">{email}</span>
        </span>
        <ChevronsUpDown size={15} aria-hidden className="shrink-0 text-rail-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="top" sideOffset={6} align="start" className="z-50 outline-none">
          <Menu.Popup
            className={`w-[15rem] origin-[var(--transform-origin)] rounded-xl border border-rule bg-surface p-1.5 shadow-[var(--shadow-float)] outline-none transition-[scale,opacity] duration-150 ease-out data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-100 data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 ${fromKeyboard ? "!transition-none" : ""}`}
          >
            <Menu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as typeof theme)}>
              <Menu.GroupLabel className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-muted">
                Theme
              </Menu.GroupLabel>
              {THEME_OPTIONS.map(({ value, label, Icon }) => (
                <Menu.RadioItem
                  key={value}
                  value={value}
                  closeOnClick={false}
                  className={itemClass}
                >
                  <Icon size={15} aria-hidden className="text-ink-muted" />
                  <span className="flex-1">{label}</span>
                  <Menu.RadioItemIndicator>
                    <Check size={15} aria-hidden className="text-signal-ink" />
                  </Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className="my-1.5 h-px bg-rule" />
            {admin ? (
              <Menu.LinkItem closeOnClick render={<Link href="/people" />} className={itemClass}>
                <Users size={15} aria-hidden className="text-ink-muted" />
                People
              </Menu.LinkItem>
            ) : null}
            <Menu.Item
              className={itemClass}
              disabled={signingOut}
              onClick={() => startSignOut(() => signOutAction())}
            >
              <LogOut size={15} aria-hidden className="text-ink-muted" />
              {signingOut ? "Signing out" : "Sign out"}
            </Menu.Item>
            <Menu.Separator className="my-1.5 h-px bg-rule" />
            <Menu.LinkItem
              closeOnClick
              render={<a href={CHANGELOG_URL} target="_blank" rel="noreferrer" />}
              aria-label={`${APP_NAME} version ${APP_VERSION}: what's new (opens in a new tab)`}
              className={`${itemClass} text-[0.8125rem] text-ink-muted`}
            >
              <span className="flex-1 tabular">Version {APP_VERSION}</span>
              <span className="flex items-center gap-1">
                What&apos;s new
                <ExternalLink size={13} aria-hidden />
              </span>
            </Menu.LinkItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
