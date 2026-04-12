---
"@refi-italia/opengarden": minor
---

Allow overriding the GraphQL and off-chain store endpoints.

`OpenGardenConfig` gains two optional fields: `graphqlUrl` and `storeUrl`. When set, the SDK uses them for read queries and indexer submissions respectively, falling back to the EASScan defaults derived from the chain ID only when the override is absent. This unblocks self-hosted indexers and makes the SDK usable on chains where EAS is deployed but EASScan is not — callers can point the client at any EAS-compatible GraphQL endpoint without patching the SDK.
