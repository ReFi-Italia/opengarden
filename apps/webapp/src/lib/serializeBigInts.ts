/**
 * Recursively walks a value and converts any `bigint` to a string so the
 * result can be safely passed to `JSON.stringify` / drizzle's JSON column
 * serializer.
 *
 * The SDK's `TimestampedOffChainResult.signedAttestation` contains EAS
 * `time` / `expirationTime` fields encoded as bigints. Storing the
 * attestation in a Payload `json` field crashes drizzle's serializer
 * unless those bigints are flattened first.
 */
export function serializeBigInts<T>(value: T): T {
	if (typeof value === "bigint") {
		return value.toString() as unknown as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => serializeBigInts(item)) as unknown as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = serializeBigInts(v);
		}
		return out as unknown as T;
	}
	return value;
}
