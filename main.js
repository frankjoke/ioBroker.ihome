"use strict";

const utils = require("@iobroker/adapter-core");

// JSON documents the dashboard reads and writes. The adapter owns the objects;
// the SPA (served by the web adapter at /ihome/) edits the values.
const DOCS = ["pageList", "deviceList", "templateList", "formulaList"];

// Data of the pre-adapter test namespace; copied once, then left untouched.
const LEGACY_PREFIX = "0_userdata.0.Test.AiHome.";

class IHome extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
   */
  constructor(options) {
    super({ ...options, name: "ihome" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  async onReady() {
    for (const name of DOCS) {
      await this.setObjectNotExistsAsync(name, {
        type: "state",
        common: { name, type: "json", role: "json", read: true, write: true },
        native: {},
      });

      if ((await this.getStateAsync(name))?.val != null) continue;

      const legacy = await this.getForeignStateAsync(LEGACY_PREFIX + name);
      if (legacy?.val == null) continue;

      await this.setStateAsync(name, { val: legacy.val, ack: true });
      this.log.info(
        `Migrated ${LEGACY_PREFIX}${name} to ${this.namespace}.${name}`,
      );
    }
  }

  /**
   * @param {() => void} callback - Callback function
   */
  onUnload(callback) {
    callback();
  }
}

if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options) => new IHome(options);
} else {
  // Otherwise start the instance directly
  new IHome();
}
