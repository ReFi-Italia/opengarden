import { expect, type Page, test } from "@playwright/test";
import { getPayload } from "payload";
import config from "../../src/payload.config.js";
import { login } from "../helpers/login";
import { cleanupTestUser, seedTestUser, testUser } from "../helpers/seedUser";
import { createArea, createGardener, createIntervention, createSponsor } from "../helpers/fixtures";

// Stable IDs so beforeAll can clean up leftovers from prior runs.
const E2E_AREA_ID = "E2E-AREA-001";
const E2E_SPONSOR_NAME = "E2E Test Sponsor";
const E2E_INT_ID = "E2E-INT-001";

test.describe("Admin Panel", () => {
	let page: Page;
	let interventionId: string | number;

	test.beforeAll(async ({ browser }) => {
		await seedTestUser();

		// Seed a minimal intervention so we can test the InterventionWorkflow view.
		// Delete-then-create so reruns don't hit uniqueness violations.
		const payload = await getPayload({ config: await config });
		await payload.delete({
			collection: "interventions",
			where: { interventionId: { equals: E2E_INT_ID } },
		});
		await payload.delete({
			collection: "areas",
			where: { areaId: { equals: E2E_AREA_ID } },
		});
		await payload.delete({
			collection: "sponsors",
			where: { displayName: { equals: E2E_SPONSOR_NAME } },
		});

		const area = await createArea(payload, { areaId: E2E_AREA_ID, name: "E2E Test Garden" });
		const sponsor = await createSponsor(payload, {
			displayName: E2E_SPONSOR_NAME,
			kind: "corporate",
			canonicalKey: { sponsorId: "E2E-SP-001" },
		});
		const gardener = await createGardener(payload, { displayName: "E2E Gardener" });
		const intervention = await createIntervention(payload, {
			areaId: area.id,
			sponsorId: sponsor.id,
			interventionId: E2E_INT_ID,
			description: "E2E test intervention",
			crew: [{ gardener: gardener.id, isCrewLead: true }],
		});
		interventionId = intervention.id;

		const context = await browser.newContext();
		page = await context.newPage();
		await login({ page, user: testUser });
	});

	test.afterAll(async () => {
		await cleanupTestUser();
	});

	test("can navigate to dashboard", async () => {
		await page.goto("http://localhost:3000/admin");
		await expect(page).toHaveURL("http://localhost:3000/admin");
		const dashboardArtifact = page.locator('span[title="Dashboard"]').first();
		await expect(dashboardArtifact).toBeVisible();
	});

	test("can navigate to collection list view", async () => {
		await page.goto("http://localhost:3000/admin/collections/sponsors");
		await expect(page).toHaveURL(
			"http://localhost:3000/admin/collections/sponsors",
		);
		// Payload renders the collection name as h1 in the list view.
		const heading = page.getByRole("heading", { name: "Sponsors", level: 1 });
		await expect(heading).toBeVisible();
	});

	test("can navigate to collection create view", async () => {
		await page.goto("http://localhost:3000/admin/collections/sponsors/create");
		// displayName is the useAsTitle field — its input must be present.
		const titleInput = page.locator('input[name="displayName"]');
		await expect(titleInput).toBeVisible();
	});

	test("renders the intervention workflow view", async () => {
		await page.goto(
			`http://localhost:3000/admin/collections/interventions/${interventionId}`,
		);
		// The custom InterventionWorkflow component replaces Payload's default edit view.
		// Assert the Lifecycle rail section is visible as proof the component mounted.
		const lifecycleSection = page
			.locator(".iw__section-label", { hasText: "Lifecycle" })
			.first();
		await expect(lifecycleSection).toBeVisible();
	});
});
