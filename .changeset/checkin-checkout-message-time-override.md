---
"@refi-italia/opengarden": minor
---

Allow caller-supplied `message.time` on `checkin()` and `checkout()`.

`GardenerCheckinInput` and `GardenerCheckoutInput` now accept an optional `time: Date | bigint` field. When set, the value is written into the EIP-712 envelope's `message.time` (the signer's claim of *when* the event happened). Omit to keep the previous behavior of using the current wall-clock at sign time.

Motivation: when signing happens server-side on upload (not on the gardener's device at the moment of checkin/checkout), the previous default collapsed the claim moment into the upload moment. Passing the device-recorded timestamp preserves claim fidelity without restating the time in the schema data.
