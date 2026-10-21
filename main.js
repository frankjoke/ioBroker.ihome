"use strict";

const utils = require("@iobroker/adapter-core");

// JSON documents the dashboard reads and writes. The adapter owns the objects;
// the SPA (served by the web adapter at /ihome/) edits the values. Everything
// lives in a subfolder so the instance root stays free for adapter logic.
const CONFIG_FOLDER = "config";
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
      const target = `${CONFIG_FOLDER}.${name}`;
      await this.setObjectNotExistsAsync(target, {
        type: "state",
        common: { name, type: "json", role: "json", read: true, write: true },
        native: {},
      });

      if ((await this.getStateAsync(target))?.val == null) {
        // oldest first: the test namespace, then the plain state in the root
        const fromLegacy = await this.getForeignStateAsync(
          LEGACY_PREFIX + name,
        );
        const fromRoot = await this.getStateAsync(name);
        const source = fromLegacy?.val != null ? fromLegacy : fromRoot;
        if (source?.val != null) {
          await this.setStateAsync(target, { val: source.val, ack: true });
          this.log.info(`Copied ${name} to ${this.namespace}.${target}`);
        }
      }

      // the documents belong to config.* — drop the old state in the root
      if (await this.getObjectAsync(name)) {
        if (
          (await this.getStateAsync(target))?.val == null &&
          (await this.getStateAsync(name))?.val != null
        ) {
          this.log.warn(
            `Keeping ${this.namespace}.${name}: ${target} is empty`,
          );
        } else {
          await this.delObjectAsync(name);
          this.log.info(`Removed the old root state ${this.namespace}.${name}`);
        }
      }
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
