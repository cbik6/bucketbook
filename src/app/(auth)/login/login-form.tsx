"use client";

import { useActionState } from "react";
import { Field, FormError, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signInAction } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signInAction, {});
  const v = state.values ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={next} />
      <FormError message={state.error} />
      <Field label="Email" htmlFor="login-email">
        <TextInput
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          autoFocus
          defaultValue={v.email}
        />
      </Field>
      <Field label="Password" htmlFor="login-password">
        <TextInput
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <div>
        <SubmitButton pendingLabel="Signing in">Sign in</SubmitButton>
      </div>
    </form>
  );
}
