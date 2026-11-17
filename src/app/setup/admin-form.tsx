"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { Field, FormError, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { createAdminAction } from "./actions";

export function AdminForm() {
  const [state, formAction] = useActionState(createAdminAction, {});
  const [showPassword, setShowPassword] = useState(false);
  const v = state.values ?? {};
  const err = (f: string) => (state.field === f ? state.error : undefined);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormError message={state.field ? undefined : state.error} />
      <Field label="Your name" htmlFor="admin-name" error={err("name")}>
        <TextInput
          id="admin-name"
          name="name"
          autoComplete="name"
          required
          defaultValue={v.name}
          invalid={Boolean(err("name"))}
        />
      </Field>
      <Field
        label="Email"
        htmlFor="admin-email"
        hint="You sign in with this. It never leaves your server."
        error={err("email")}
      >
        <TextInput
          id="admin-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={v.email}
          invalid={Boolean(err("email"))}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="admin-password"
        hint="At least 10 characters."
        error={err("password")}
      >
        <div className="relative">
          <TextInput
            id="admin-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={10}
            required
            invalid={Boolean(err("password"))}
            className="pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted hover:text-ink"
          >
            {showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </button>
        </div>
      </Field>
      <div>
        <SubmitButton pendingLabel="Creating your login">Create login and continue</SubmitButton>
      </div>
    </form>
  );
}
