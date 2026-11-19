"use client";

import { Lock, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, ButtonLink, iconButtonClass } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput, inputClass } from "@/components/ui/field";
import { HoldButton } from "@/components/ui/hold-button";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  ACCOUNT_SUBTYPES,
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_SINGULAR,
  type AccountType,
} from "@/lib/account-types";
import {
  archiveAccountAction,
  deleteAccountAction,
  saveAccountAction,
  unarchiveAccountAction,
} from "./actions";

export type EditorAccount = {
  id: string;
  name: string;
  code: string | null;
  type: AccountType;
  subtype: string;
  description: string | null;
  parentAccountId: string | null;
  archived: boolean;
  isSystem: boolean;
  isBucket: boolean;
  bucketsEnabled: boolean;
  depth: number;
  hasChildren: boolean;
  descendantIds: string[];
};

type Props = {
  bookId: string;
  closeHref: string;
  canEdit: boolean;
  accounts: EditorAccount[];
  account?: EditorAccount;
  defaultType?: AccountType;
  defaultParentId?: string;
};

export function AccountEditor({
  bookId,
  closeHref,
  canEdit,
  accounts,
  account,
  defaultType,
  defaultParentId,
}: Props) {
  const isNew = !account;
  const uid = useId();
  const [state, formAction] = useActionState(
    saveAccountAction.bind(null, bookId, account?.id ?? null),
    {},
  );
  const v = state.values;
  const defaultParent = accounts.find((a) => a.id === defaultParentId);
  const [type, setType] = useState<AccountType>(
    (v?.type as AccountType) ?? account?.type ?? defaultParent?.type ?? defaultType ?? "expense",
  );
  const [parentId, setParentId] = useState<string>(
    v?.parentAccountId ?? account?.parentAccountId ?? defaultParent?.id ?? "",
  );

  const parentOptions = useMemo(() => {
    const excluded = new Set([account?.id, ...(account?.descendantIds ?? [])]);
    return accounts.filter(
      (a) =>
        a.type === type && !a.archived && !a.isBucket && !a.bucketsEnabled && !excluded.has(a.id),
    );
  }, [accounts, type, account]);

  const subtypes = ACCOUNT_SUBTYPES[type] as Record<string, string>;
  const defaultSubtype =
    v?.subtype && v.subtype in subtypes
      ? v.subtype
      : account && account.type === type
        ? account.subtype
        : (accounts.find((a) => a.id === parentId)?.subtype ?? Object.keys(subtypes)[0]);

  const typeLocked = Boolean(account?.isSystem || account?.hasChildren);
  const err = (f: string) => (state.field === f ? state.error : undefined);
  const title = isNew ? "New account" : account.name;

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
          {!isNew && account.isSystem ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] text-ink-muted">
              <Lock size={13} aria-hidden /> Used by the app. You can rename it.
            </p>
          ) : null}
        </div>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close"
          className={iconButtonClass({ size: "sm", extra: "-mr-1" })}
        >
          <X size={18} aria-hidden />
        </Link>
      </div>

      {!canEdit ? (
        <p className="px-5 py-5 text-sm text-ink-muted">
          You can view this book but not change it.
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-5 px-5 py-5" noValidate>
          <FormError message={state.field ? undefined : state.error} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor={`${uid}-acct-type`} error={err("type")}>
              {typeLocked ? (
                <>
                  <input type="hidden" name="type" value={type} />
                  <div
                    id={`${uid}-acct-type`}
                    className={`${inputClass} flex items-center bg-sunken text-ink-muted`}
                    title={
                      account?.isSystem
                        ? "System accounts keep their type."
                        : "Move its sub-accounts first to change the type."
                    }
                  >
                    {ACCOUNT_TYPE_SINGULAR[type]}
                  </div>
                </>
              ) : (
                <SelectInput
                  id={`${uid}-acct-type`}
                  name="type"
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as AccountType);
                    setParentId("");
                  }}
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_SINGULAR[t]}
                    </option>
                  ))}
                </SelectInput>
              )}
            </Field>
            <Field label="Detail type" htmlFor={`${uid}-acct-subtype`} error={err("subtype")}>
              <SelectInput
                key={type}
                id={`${uid}-acct-subtype`}
                name="subtype"
                defaultValue={defaultSubtype}
                disabled={account?.isSystem}
                invalid={Boolean(err("subtype"))}
              >
                {Object.entries(subtypes).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectInput>
              {account?.isSystem ? (
                <input type="hidden" name="subtype" value={account.subtype} />
              ) : null}
            </Field>
          </div>

          <Field label="Name" htmlFor={`${uid}-acct-name`} error={err("name")}>
            <TextInput
              id={`${uid}-acct-name`}
              name="name"
              required
              maxLength={100}
              autoComplete="off"
              autoFocus={isNew}
              defaultValue={v?.name ?? account?.name}
              invalid={Boolean(err("name"))}
            />
          </Field>

          <Field
            label="Account number"
            htmlFor={`${uid}-acct-code`}
            optional
            hint="Numbers sort before names, like 6010 Advertising."
            error={err("code")}
          >
            <TextInput
              id={`${uid}-acct-code`}
              name="code"
              maxLength={20}
              inputMode="numeric"
              autoComplete="off"
              defaultValue={v?.code ?? account?.code ?? ""}
              invalid={Boolean(err("code"))}
              className="max-w-40 font-mono"
            />
          </Field>

          <Field
            label="Sub-account of"
            htmlFor={`${uid}-acct-parent`}
            hint={
              parentOptions.length === 0
                ? `No other ${ACCOUNT_TYPE_SINGULAR[type].toLowerCase()} accounts to nest under.`
                : undefined
            }
            error={err("parentAccountId")}
          >
            <SelectInput
              id={`${uid}-acct-parent`}
              name="parentAccountId"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={account?.isSystem}
              invalid={Boolean(err("parentAccountId"))}
            >
              <option value="">None (top level)</option>
              {parentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {"   ".repeat(a.depth)}
                  {a.code ? `${a.code} ` : ""}
                  {a.name}
                </option>
              ))}
            </SelectInput>
            {account?.isSystem ? <input type="hidden" name="parentAccountId" value="" /> : null}
          </Field>

          <Field
            label="Description"
            htmlFor={`${uid}-acct-description`}
            optional
            error={err("description")}
          >
            <textarea
              id={`${uid}-acct-description`}
              name="description"
              rows={3}
              maxLength={500}
              defaultValue={v?.description ?? account?.description ?? ""}
              className={`${inputClass} h-auto py-2`}
            />
          </Field>

          <div className="flex items-center gap-2 pt-1">
            <SubmitButton pendingLabel="Saving">
              {isNew ? "Create account" : "Save changes"}
            </SubmitButton>
            <ButtonLink href={closeHref} scroll={false} variant="ghost">
              Cancel
            </ButtonLink>
          </div>
        </form>
      )}

      {account && canEdit && !account.isSystem ? (
        <ArchiveSection bookId={bookId} account={account} closeHref={closeHref} />
      ) : null}
    </div>
  );
}

function ArchiveSection({
  bookId,
  account,
  closeHref,
}: {
  bookId: string;
  account: EditorAccount;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const restore = () =>
    startTransition(async () => {
      const r = await unarchiveAccountAction(bookId, account.id);
      if (r.error) toast.error(r.error);
      else toast.success(`${account.name} restored`);
    });

  const archive = () =>
    startTransition(async () => {
      const r = await archiveAccountAction(bookId, account.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(`${account.name} archived`, {
        description: "It's hidden from lists but kept in your records.",
        action: {
          label: "Undo",
          onClick: async () => {
            const u = await unarchiveAccountAction(bookId, account.id);
            if (u.error) toast.error(u.error);
          },
        },
      });
      router.push(closeHref, { scroll: false });
    });

  const remove = () =>
    startTransition(async () => {
      const r = await deleteAccountAction(bookId, account.id);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(`${account.name} deleted`);
      router.push(closeHref, { scroll: false });
    });

  return (
    <div className="mx-5 mb-6 flex flex-col gap-4 border-t border-rule pt-5">
      {account.archived ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">This account is archived.</p>
          <div>
            <Button variant="secondary" size="sm" disabled={pending} onClick={restore}>
              Restore account
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">
            Archive hides the account from lists and pickers. Its history stays.
          </p>
          <div>
            <HoldButton
              label="Archive account"
              holdingLabel="Keep holding"
              onConfirm={archive}
              disabled={pending || account.hasChildren}
            />
          </div>
          {account.hasChildren ? (
            <p className="text-[0.8125rem] text-ink-muted">Archive its sub-accounts first.</p>
          ) : null}
        </div>
      )}
      {!account.hasChildren ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-ink-muted">
            No transactions use this account yet, so you can also delete it for good.
          </p>
          <div>
            <HoldButton
              label="Delete account"
              holdingLabel="Keep holding to delete"
              onConfirm={remove}
              disabled={pending}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
