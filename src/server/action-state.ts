import { unstable_rethrow } from "next/navigation";
import { UserFacingError } from "./errors";

/** What a form's server action returns to the page. */
export type ActionState = {
  error?: string;
  field?: string;
  /** Echo of submitted values so a failed form keeps what the user typed. */
  values?: Record<string, string>;
  success?: string;
};

export const initialActionState: ActionState = {};

export function formValues(formData: FormData, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = String(formData.get(k) ?? "");
  return out;
}

/**
 * Turns an error into form feedback. Next.js redirects and notFound() are
 * thrown as errors too, so they are re-thrown untouched.
 */
export function actionError(err: unknown, values?: Record<string, string>): ActionState {
  unstable_rethrow(err);
  if (err instanceof UserFacingError) {
    return { error: err.message, field: err.field, values };
  }
  // Better Auth APIError carries a user-safe message in body.message.
  const apiMessage = (err as { body?: { message?: unknown } })?.body?.message;
  if (typeof apiMessage === "string" && apiMessage) {
    return { error: apiMessage, values };
  }
  console.error("[action] unexpected error", err);
  return { error: "Something went wrong on our side. Please try again.", values };
}
