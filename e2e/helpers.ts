import { type Locator, type Page, expect } from "@playwright/test";

/** Clicks a link in the rail's folded Setup group, opening the group first if needed. */
export async function clickSetupLink(page: Page, name: string) {
  const nav = page.getByRole("navigation", { name: "Book" }).first();
  const link = nav.getByRole("link", { name, exact: true });
  // Clicks before the page is interactive are lost, so retry until the link shows.
  await expect(async () => {
    const setup = nav.getByRole("button", { name: "Setup" });
    if ((await setup.getAttribute("aria-expanded")) === "false") await setup.click();
    await expect(link).toBeVisible({ timeout: 1000 });
  }).toPass();
  await link.click();
}

/** Opens the account menu at the foot of the rail and picks an item. */
export async function accountMenu(page: Page, item: string) {
  const menuItem = page.getByRole("menuitem", { name: item });
  await expect(async () => {
    if (!(await menuItem.isVisible()))
      await page.getByRole("button", { name: /^Account:/ }).click();
    await expect(menuItem).toBeVisible({ timeout: 1000 });
  }).toPass();
  await menuItem.click();
}

/** Picks a category for a review row from its searchable list. */
export async function pickCategory(page: Page, row: Locator, search: string, option: RegExp) {
  await pickFrom(page, row.getByLabel(/Category for/), search, option);
}

/** Opens a searchable account list, searches it and picks the matching option. */
export async function pickFrom(page: Page, trigger: Locator, search: string, option: RegExp) {
  const box = page.getByPlaceholder(/^Search (categories|accounts)$/).filter({ visible: true });
  // Clicks before the page is interactive are lost, so retry until the list opens.
  await expect(async () => {
    if (!(await box.isVisible())) await trigger.click();
    await expect(box).toBeVisible({ timeout: 1000 });
  }).toPass();
  await box.fill(search);
  await page.getByRole("option", { name: option }).filter({ visible: true }).first().click();
  await expect(box).toBeHidden();
}
