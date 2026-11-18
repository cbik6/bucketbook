import { type Page, expect, test } from "@playwright/test";

/**
 * Phase 6 flow: set a budget, then read the reports and export one to CSV.
 * Runs after the other workflow specs (name order).
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

test("reports: budget, Profit and Loss, Balance Sheet, CSV", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Book" }).first();

  await nav.getByRole("link", { name: "Budget" }).click();
  await expect(page.getByRole("heading", { name: "Budget", exact: true })).toBeVisible();
  await page.getByLabel("Groceries", { exact: true }).filter({ visible: true }).fill("400");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget saved.")).toBeVisible();

  await nav.getByRole("link", { name: "Reports" }).click();
  await page.getByRole("link", { name: /Budget vs\. Actuals/ }).click();
  const groceries = page.getByRole("row").filter({ hasText: /^Groceries/ });
  await expect(groceries).toContainText("$400.00");

  await nav.getByRole("link", { name: "Reports" }).click();
  await page.getByRole("link", { name: /Profit and Loss/ }).click();
  await expect(page.getByRole("row", { name: /Net income/ })).toBeVisible();

  await nav.getByRole("link", { name: "Reports" }).click();
  await page.getByRole("link", { name: /Balance Sheet/ }).click();
  await expect(page.getByRole("row", { name: /Total liabilities and equity/ })).toBeVisible();
  await expect(page.getByText(/This should never happen/)).toHaveCount(0);

  const href = await page
    .getByRole("link", { name: "Export CSV" })
    .filter({ visible: true })
    .getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain("Total assets");
});
