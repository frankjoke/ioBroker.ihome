const path = require("node:path");
const { tests } = require("@iobroker/testing");

// Validates package.json, io-package.json and the files they reference.
tests.packageFiles(path.join(__dirname, ".."));
