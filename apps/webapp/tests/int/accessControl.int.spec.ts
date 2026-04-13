import { getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@/collections/Users";
import config from "@/payload.config";

let payload: Payload;

const ROLES: UserRole[] = [
	"admin",
	"manager",
	"validator",
	"assessor",
	"authoring",
	"viewer",
];

const uniqueId = (prefix: string) =>
	`${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const seedUser = async (role: UserRole) => {
	const email = `${role}-${uniqueId("user")}@test.local`;
	const user = await payload.create({
		collection: "users",
		data: {
			email,
			password: "test1234",
			displayName: `${role} user`,
			roles: [role],
		},
	});
	// Re-fetch to make sure roles are present on the returned object exactly as
	// saved (Payload strips password by default).
	return payload.findByID({ collection: "users", id: user.id, depth: 0 });
};

interface AccessExpectation {
	collection:
		| "sponsors"
		| "staff"
		| "gardeners"
		| "areas"
		| "adminValidations"
		| "healthchecks";
	data: Record<string, unknown>;
	allowedRoles: UserRole[];
}

const cases: AccessExpectation[] = [
	{
		collection: "sponsors",
		data: {
			displayName: "AccessTest sponsor",
			kind: "volunteer",
		},
		allowedRoles: ["admin", "manager"],
	},
	{
		collection: "staff",
		data: {
			displayName: "AccessTest staff",
			staffId: "",
		},
		allowedRoles: ["admin", "manager"],
	},
	{
		collection: "gardeners",
		data: {
			displayName: "AccessTest gardener",
			status: "active",
		},
		allowedRoles: ["admin", "manager"],
	},
	{
		collection: "areas",
		data: {
			areaId: "",
			name: "AccessTest area",
			municipality: "Roma",
			areaType: "1",
			latitude: 0,
			longitude: 0,
		},
		allowedRoles: ["admin", "manager", "authoring"],
	},
];

describe("Access control role matrix", () => {
	beforeAll(async () => {
		payload = await getPayload({ config: await config });
	});

	it.each(cases)("enforces create access on $collection", async ({
		collection,
		data,
		allowedRoles,
	}) => {
		for (const role of ROLES) {
			const user = await seedUser(role);
			const payloadData = { ...data };
			// Inject unique values for fields that need uniqueness.
			if ("staffId" in payloadData) payloadData.staffId = uniqueId("STAFF");
			if ("areaId" in payloadData) payloadData.areaId = uniqueId("AREA");

			const attempt = payload.create({
				collection,
				data: payloadData as never,
				user,
				overrideAccess: false,
			});

			if (allowedRoles.includes(role)) {
				await expect(attempt).resolves.toBeTruthy();
			} else {
				await expect(attempt).rejects.toThrow();
			}
		}
	});

	it("lets a viewer read but not create sponsors", async () => {
		const viewer = await seedUser("viewer");
		const reads = await payload.find({
			collection: "sponsors",
			user: viewer,
			overrideAccess: false,
		});
		expect(reads.docs).toBeDefined();

		await expect(
			payload.create({
				collection: "sponsors",
				data: { displayName: "viewer-cannot", kind: "volunteer" },
				user: viewer,
				overrideAccess: false,
			}),
		).rejects.toThrow();
	});
});
