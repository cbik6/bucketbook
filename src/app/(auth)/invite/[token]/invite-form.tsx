"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { Field, FormError, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { acceptInviteAction } from "./actions";

export function InviteForm({ token, name, email }: { token: string; name: string; email: string }) {
  const [state, formAction] = useActionState(acceptInviteAction.bind(null, token), {});
  const [showPassword, setShowPassword] = useState(false);
  const v = state.values ?? {};
  const err = (f: string) => (state.field === f ? state.error : undefined);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormError message={state.field ? undefined : state.error} />
      <Field label="Your name" htmlFor="invite-name" error={err("name")}>
        <TextInput
          id="invite-name"
          name="name"
          autoComplete="name"
          required
          maxLength={100}
          defaultValue={v.name ?? name}
          invalid={Boolean(err("name"))}
        />
      </Field>
      <Field label="Email" htmlFor="invite-email" hint="You'll sign in with this.">
        <TextInput
          id="invite-email"
          type="email"
          autoComplete="username"
          value={email}
          readOnly
          className="text-ink-muted"
        />
      </Field>
      <Field
        label="Choose a password"
        htmlFor="invite-password"
        hint="At least 10 characters."
        error={err("password")}
      >
        <div className="relative">
          <TextInput
            id="invite-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            minLength={10}
            required
            autoFocus
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
        <SubmitButton pendingLabel="Setting up your login">Join and open the books</SubmitButton>
      </div>
    </form>
  );
}
