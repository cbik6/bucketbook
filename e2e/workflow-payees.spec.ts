import { type Page, expect, test } from "@playwright/test";
import { clickSetupLink, pickFrom } from "./helpers";

/** Payees: typed on an entry, managed on the Payees page, totalled in a report. */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

const field = (page: Page, label: string | RegExp, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

test("payees: typed on an entry, renamed on the Payees page, shown in the report", async ({
  page,
}) => {
  await signIn(page);
  const bookUrl = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");

  // A payee typed on a journal entry joins the list.
  await page.goto(`${bookUrl}/journal/new`);
  await expect(page.getByRole("heading", { name: "New journal entry" })).toBeVisible();
  await expect(async () => {
    await field(page, /^Payee/).fill("Corner Market");
    await expect(field(page, /^Payee/)).toHaveValue("Corner Market", { timeout: 1000 });
  }).toPass();
  await page.keyboard.press("Escape");
  await pickFrom(page, field(page, "Line 1 account"), "Groceries", /Groceries/);
  await field(page, "Line 1 debit").fill("23.40");
  await pickFrom(page, field(page, "Line 2 account"), "Checking", /Checking/);
  await page.getByRole("button", { name: "Post entry" }).click();
  await expect(page.getByText("Saved. This entry is in the ledger.")).toBeVisible();

  // The Payees page lists it; give it a usual category and a new name.
  await clickSetupLink(page, "Payees");
  await expect(page.getByRole("heading", { name: "Payees", exact: true })).toBeVisible();
  const list = page.getByRole("list", { name: "Payees" });
  const row = list.getByRole("listitem").filter({ hasText: "Corner Market" });
  await expect(row.getByRole("link", { name: "1 entry" })).toBeVisible();
  await pickFrom(
    page,
    row.getByLabel("Usual category for Corner Market"),
    "Groceries",
    /Groceries/,
  );
  await expect(row.getByLabel("Usual category for Corner Market")).toContainText("Groceries");
  await row.getByRole("button", { name: "Edit Corner Market" }).click();
  await row.getByLabel("Name", { exact: true }).fill("Corner Market Co.");
  await row.getByRole("button", { name: "Rename" }).click();
  await expect(list.getByText("Corner Market Co.", { exact: true })).toBeVisible();

  // Its entries, and the report, use the new name.
  await list.getByRole("link", { name: "1 entry" }).click();
  await expect(page.getByText(/for Corner Market Co\./)).toBeVisible();
  await page.goto(`${bookUrl}/reports/payees?range=all`);
  await expect(page.getByRole("heading", { name: "Spending by payee" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Corner Market Co." })).toBeVisible();
});
