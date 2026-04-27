import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [tsconfigPaths(), react()],
	test: {
		environment: "jsdom",
		setupFiles: ["./vitest.setup.ts"],
		include: ["tests/int/**/*.int.spec.ts"],
		// Payload's SQLite schema push is not idempotent across processes and the
		// SQLite file allows only one writer. Run every integration spec in a
		// single fork, share the module graph (so every file references the same
		// payload.config import and thus the same getPayload cache key), and
		// serialize files so concurrent SQLite writes never overlap.
		pool: { type: "forks", singleFork: true },
		isolate: false,
		fileParallelism: false,
	},
});
