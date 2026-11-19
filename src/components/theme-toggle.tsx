"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const STORAGE_KEY = "bb-theme";

/** Runs before paint (inlined in the root layout) so there is no flash of the wrong theme. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`;

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

export const THEME_OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "Match system", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** The current color theme and a setter that applies and remembers it. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a value set before hydration
    setTheme(t === "light" || t === "dark" ? t : "system");
  }, []);
  return [
    theme,
    (t: Theme) => {
      setTheme(t);
      applyTheme(t);
    },
  ];
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`inline-flex rounded-lg bg-rail-raised p-0.5 ${className ?? ""}`}
    >
      {THEME_OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={`tap-target-y flex h-7 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
              active ? "bg-rail-active text-rail-ink" : "text-rail-muted hover:text-rail-ink"
            }`}
          >
            <Icon size={15} strokeWidth={1.75} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
