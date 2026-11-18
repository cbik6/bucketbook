import { type Page, expect, test } from "@playwright/test";

/**
 * Phase 5 flow: record a balance on a manual account (cash), then reconcile
 * it against a statement. Runs after the buckets spec (name order).
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

const label = (page: Page, text: string) =>
  page.getByLabel(text, { exact: true }).filter({ visible: true });

test("reconcile: record a cash balance, then reconcile it", async ({ page }) => {
  await signIn(page);
  await page
    .getByRole("link", { name: "Cash on Hand", exact: true })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole("heading", { name: "Cash on Hand" })).toBeVisible();
  await page.getByRole("button", { name: "Record a new balance" }).click();
  await label(page, "New balance").fill("80");
  const offset = label(page, "Difference goes to");
  const obe = await offset
    .locator("option", { hasText: /Opening Balance Equity$/ })
    .getAttribute("value");
  await offset.selectOption(obe!);
  await page.getByRole("button", { name: "Record balance" }).click();
  await expect(page.getByText("Balance recorded.")).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Book" }).first();
  await nav.getByRole("link", { name: "Reconcile" }).click();
  await expect(page.getByRole("heading", { name: "Reconcile", exact: true })).toBeVisible();
  await label(page, "Account").selectOption({ label: "Cash on Hand" });
  await label(page, "Ending balance").fill("80");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("heading", { name: "Reconcile Cash on Hand" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish" })).toBeDisabled();
  await page.getByLabel("Check all").check();
  await expect(page.getByText("Matches the statement.")).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Reconciled Cash on Hand" })).toBeVisible();
});
