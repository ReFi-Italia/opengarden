import { initEncoders } from "../src/schemas/encoders";

// Vitest setupFiles — runs in the same module graph as every test file,
// so the module-level `SchemaEncoderCtor` cache populated here is shared
// with tests that call `encodeX` / `decodeX` / `newSchemaEncoder`
// synchronously. Idempotent, so re-imports are free.
await initEncoders();
