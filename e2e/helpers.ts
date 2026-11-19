import { type Page, expect } from "@playwright/test";

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
