const path = require("node:path");
const { tests } = require("@iobroker/testing");

// Starts the adapter against a real JS-Controller and fails on startup errors.
tests.integration(path.join(__dirname, ".."), {
  // "once" adapters finish on their own
  allowedExitCodes: [0, 11],
});
