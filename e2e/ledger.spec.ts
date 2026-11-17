import { type Page, expect, test } from "@playwright/test";

/**
 * Phase 2 flow on the install that first-run.spec.ts set up: opening balances,
 * then post, edit, and reverse a journal entry, and check the register.
 * Runs after first-run.spec.ts (files run in name order with one worker).
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

/**
 * Next.js keeps recently visited pages in the DOM (hidden) for instant back
 * navigation, so form controls are looked up among visible elements only.
 */
const field = (page: Page, label: string | RegExp, exact = false) =>
  page.getByLabel(label, { exact }).filter({ visible: true });

/** Picks an account in a select whose option text is the (possibly indented) name. */
async function pickAccount(page: Page, label: string, name: string) {
  const select = field(page, label);
  const value = await select
    .locator("option", { hasText: new RegExp(`^\\s*${name}$`) })
    .getAttribute("value");
  await select.selectOption(value!);
}

test("ledger: opening balances, post, edit, reverse, register", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Book" }).first();

  // Opening balances: the difference goes to Opening Balance Equity.
  await nav.getByRole("link", { name: "Opening balances" }).click();
  await expect(page.getByRole("heading", { name: "Opening balances" })).toBeVisible();
  await field(page, "Checking", true).fill("2,500");
  await field(page, "Credit Card", true).fill("400");
  await expect(page.getByText("$2,100.00")).toBeVisible();
  await page.getByRole("button", { name: "Save opening balances" }).click();
  await expect(page.getByText("Opening balances saved.")).toBeVisible();

  // Post an entry; the second line fills in the balancing amount.
  await nav.getByRole("link", { name: "Journal entries" }).click();
  await expect(page.getByRole("heading", { name: "Journal entries" })).toBeVisible();
  await page.getByRole("link", { name: /New entry/ }).click();
  await expect(page.getByRole("heading", { name: "New journal entry" })).toBeVisible();
  await field(page, /^Memo/).fill("Groceries run");
  await pickAccount(page, "Line 1 account", "Groceries");
  await field(page, "Line 1 debit").fill("54.20");
  await pickAccount(page, "Line 2 account", "Checking");
  await expect(field(page, "Line 2 credit")).toHaveValue("54.20");
  await expect(page.getByText("Balanced")).toBeVisible();
  await page.getByRole("button", { name: "Post entry" }).click();
  await expect(page.getByRole("heading", { name: "JE 2" })).toBeVisible();
  await expect(page.getByText("Saved. This entry is in the ledger.")).toBeVisible();

  // Edit: saves version 2 and keeps version 1 in the history.
  await page.getByRole("link", { name: "Edit" }).click();
  await field(page, "Line 1 debit").fill("60");
  await field(page, "Line 2 credit").fill("60");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByText("Edited, v2")).toBeVisible();
  await expect(page.getByRole("link", { name: "Version 1" })).toBeVisible();

  // Reverse: posts JE 3 that cancels JE 2.
  await page.getByRole("button", { name: "Reverse" }).click();
  await page.getByRole("button", { name: "Post reversal" }).click();
  await expect(page.getByRole("heading", { name: "JE 3" })).toBeVisible();
  await expect(page.getByText(/This entry reverses/)).toBeVisible();

  // The register shows Checking back at its opening balance.
  await nav.getByRole("link", { name: "Chart of accounts" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
  await page.getByRole("link", { name: "Checking", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Checking" })).toBeVisible();
  await expect(page.getByText("$2,500.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "JE 2" })).toBeVisible();

  // The activity log recorded the edit.
  await nav.getByRole("link", { name: "Activity" }).click();
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByText("Edited JE 2, now version 2")).toBeVisible();
});
