"use client";

import { Check, Copy } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/field";
import { HoldButton } from "@/components/ui/hold-button";
import type { BookRole } from "@/lib/account-types";
import type { InviteView, PersonView } from "@/server/people/service";
import {
  inviteAction,
  removePersonAction,
  renewInviteAction,
  revokeInviteAction,
  setAccessAction,
  setAdminAction,
} from "./actions";

type Book = { id: string; name: string; archived: boolean };
type Choice = BookRole | "none";
type AccessMap = Record<string, Choice>;

const ROLE_OPTIONS: { value: Choice; label: string }[] = [
  { value: "none", label: "No access" },
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "owner", label: "Owner" },
];

const toList = (m: AccessMap) =>
  Object.entries(m)
    .filter(([, role]) => role !== "none")
    .map(([bookId, role]) => ({ bookId, role: role as BookRole }));

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function PeopleManager({
  me,
  books,
  people,
  invites,
}: {
  me: string;
  books: Book[];
  people: PersonView[];
  invites: InviteView[];
}) {
  return (
    <div className="flex flex-col gap-10">
      <RoleGuide />
      <InviteForm books={books} />
      {invites.length ? (
        <section aria-labelledby="pending-heading" className="flex flex-col gap-3">
          <h2 id="pending-heading" className="text-base font-semibold">
            Waiting to join
          </h2>
          <ul className="flex flex-col gap-2">
            {invites.map((i) => (
              <PendingInvite key={i.id} invite={i} />
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="people-heading" className="flex flex-col gap-3">
        <h2 id="people-heading" className="text-base font-semibold">
          People with a login
        </h2>
        <ul className="flex flex-col gap-3">
          {people.map((p) => (
            <PersonCard key={p.id} person={p} books={books} isMe={p.id === me} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function RoleGuide() {
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-xl bg-sunken p-4 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="font-medium">Owner</dt>
      <dd className="text-ink-muted">
        Everything an editor can do, plus connecting banks to the book and its settings: rename,
        archive, delete.
      </dd>
      <dt className="font-medium">Editor</dt>
      <dd className="text-ink-muted">
        Enters and approves transactions, sets up and syncs the book&apos;s bank accounts, and works
        with rules, buckets, budgets, loans and reconciling.
      </dd>
      <dt className="font-medium">Viewer</dt>
      <dd className="text-ink-muted">
        Sees the book and its reports, but can&apos;t change anything.
      </dd>
      <dt className="font-medium">Admin</dt>
      <dd className="text-ink-muted">Manages people for the whole install.</dd>
    </dl>
  );
}

function AccessPicker({
  books,
  value,
  onChange,
  idPrefix,
}: {
  books: Book[];
  value: AccessMap;
  onChange: (next: AccessMap) => void;
  idPrefix: string;
}) {
  if (books.length === 0) {
    return <p className="text-sm text-ink-muted">There are no books yet.</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-rule rounded-lg border border-rule">
      {books.map((b) => (
        <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <label htmlFor={`${idPrefix}-${b.id}`} className="min-w-0 flex-1 truncate text-sm">
            {b.name}
            {b.archived ? <span className="text-ink-muted"> (archived)</span> : null}
          </label>
          {/* The wrapper sets the width: SelectInput is full width by design. */}
          <div className="w-36 shrink-0">
            <SelectInput
              id={`${idPrefix}-${b.id}`}
              value={value[b.id] ?? "none"}
              onChange={(e) => onChange({ ...value, [b.id]: e.target.value as Choice })}
            >
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectInput>
          </div>
        </div>
      ))}
    </div>
  );
}

function CopyLink({ link, name }: { link: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const uid = useId();
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-signal bg-signal-soft/40 p-4">
      <label htmlFor={`${uid}-link`} className="text-sm font-medium">
        Send this link to {name}
      </label>
      <div className="flex gap-2">
        <TextInput
          id={`${uid}-link`}
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Couldn't copy. Select the link and copy it.");
            }
          }}
        >
          {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-[0.8125rem] text-ink-muted">
        It works once and expires in 7 days. Anyone with the link can use it, so send it only to
        them. It won&apos;t be shown again; you can make a new one below.
      </p>
    </div>
  );
}

function InviteForm({ books }: { books: Book[] }) {
  const uid = useId();
  const live = books.filter((b) => !b.archived);
  const initial = (): AccessMap =>
    Object.fromEntries(live.map((b) => [b.id, live.length === 1 ? "editor" : "none"]));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [access, setAccess] = useState<AccessMap>(initial);
  const [error, setError] = useState<{ message?: string; field?: string }>({});
  const [made, setMade] = useState<{ link: string; name: string }>();
  const [pending, start] = useTransition();

  return (
    <section aria-labelledby="invite-heading" className="flex flex-col gap-4">
      <h2 id="invite-heading" className="text-base font-semibold">
        Invite someone
      </h2>
      {made ? <CopyLink link={made.link} name={made.name} /> : null}
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await inviteAction({ name, email, access: toList(access) });
            if (r.error) {
              setError({ message: r.error, field: r.field });
              return;
            }
            setError({});
            setMade({ link: r.link!, name: name.trim() });
            setName("");
            setEmail("");
            setAccess(initial());
          });
        }}
      >
        <FormError
          message={error.field === "name" || error.field === "email" ? undefined : error.message}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Name"
            htmlFor={`${uid}-name`}
            error={error.field === "name" ? error.message : undefined}
          >
            <TextInput
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="off"
              invalid={error.field === "name"}
            />
          </Field>
          <Field
            label="Email"
            htmlFor={`${uid}-email`}
            hint="They'll sign in with this."
            error={error.field === "email" ? error.message : undefined}
          >
            <TextInput
              id={`${uid}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              invalid={error.field === "email"}
            />
          </Field>
        </div>
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-[0.8125rem] font-medium">Books they can open</legend>
          <AccessPicker
            books={live}
            value={access}
            onChange={setAccess}
            idPrefix={`${uid}-access`}
          />
        </fieldset>
        <div>
          <Button type="submit" variant="primary" pending={pending} pendingLabel="Making the link">
            Make invite link
          </Button>
        </div>
      </form>
    </section>
  );
}

function PendingInvite({ invite }: { invite: InviteView }) {
  const [pending, start] = useTransition();
  const [link, setLink] = useState<string>();
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-rule p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{invite.name}</div>
          <div className="truncate text-sm text-ink-muted">{invite.email}</div>
          <div className="mt-1 text-[0.8125rem] text-ink-muted">
            {invite.access.length
              ? invite.access.map((a) => `${a.bookName}: ${roleLabel(a.role)}`).join(", ")
              : "No books yet"}
            {" · "}
            {invite.expired
              ? "Link expired"
              : `Link expires ${dateFormat.format(invite.expiresAt)}`}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await renewInviteAction(invite.id);
                if (r.error) toast.error(r.error);
                else setLink(r.link);
              })
            }
          >
            New link
          </Button>
          <HoldButton
            label="Withdraw"
            holdingLabel="Keep holding"
            disabled={pending}
            onConfirm={() =>
              start(async () => {
                const r = await revokeInviteAction(invite.id);
                if (r.error) toast.error(r.error);
                else toast.success(`Invitation for ${invite.name} withdrawn`);
              })
            }
          />
        </div>
      </div>
      {link ? <CopyLink link={link} name={invite.name} /> : null}
    </li>
  );
}

const roleLabel = (r: BookRole) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r;

function PersonCard({ person, books, isMe }: { person: PersonView; books: Book[]; isMe: boolean }) {
  const uid = useId();
  const saved: AccessMap = Object.fromEntries(person.access.map((a) => [a.bookId, a.role]));
  const [access, setAccess] = useState<AccessMap>(saved);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const changed = books.some((b) => (access[b.id] ?? "none") !== (saved[b.id] ?? "none"));

  const act = (fn: () => Promise<{ error?: string }>, done?: string) =>
    start(async () => {
      const r = await fn();
      if (r.error) {
        setError(r.error);
        return;
      }
      setError(undefined);
      if (done) toast.success(done);
    });

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-rule p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-medium">
            {person.name}
            {isMe ? (
              <span className="text-[0.8125rem] font-normal text-ink-muted">(you)</span>
            ) : null}
            {person.isAdmin ? (
              <span className="rounded-full bg-signal-soft px-2 py-0.5 text-xs font-medium">
                Admin
              </span>
            ) : null}
          </div>
          <div className="truncate text-sm text-ink-muted">{person.email}</div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={person.isAdmin}
            disabled={pending || isMe}
            onChange={(e) =>
              act(
                () => setAdminAction(person.id, e.target.checked),
                e.target.checked
                  ? `${person.name} is now an admin`
                  : `${person.name} is no longer an admin`,
              )
            }
            className="size-4 accent-[var(--signal)]"
          />
          Admin
        </label>
      </div>
      <FormError message={error} />
      <AccessPicker books={books} value={access} onChange={setAccess} idPrefix={`${uid}-access`} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!changed || pending}
          onClick={() =>
            act(() => setAccessAction(person.id, toList(access)), `Saved access for ${person.name}`)
          }
        >
          Save access
        </Button>
        {changed ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setAccess(saved)}>
            Undo changes
          </Button>
        ) : null}
        {isMe ? null : (
          <span className="ml-auto">
            <HoldButton
              label="Remove person"
              holdingLabel="Keep holding to remove"
              disabled={pending}
              onConfirm={() =>
                act(() => removePersonAction(person.id), `${person.name} was removed`)
              }
            />
          </span>
        )}
      </div>
    </li>
  );
}
