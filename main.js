"use strict";

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
// const fs = require('fs');

class IHome extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options] - Adapter options
   */
  constructor(options) {
    super({
      ...options,
      name: "ihome",
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    // this.on('objectChange', this.onObjectChange.bind(this));
    // this.on('message', this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Initialize your adapter here

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // this.config:
    this.log.info("config width: ${this.config.width}");
    this.log.info("config height: ${this.config.height}");
    this.log.info("config backgroundColor: ${this.config.backgroundColor}");
    this.log.info("config refreshInterval: ${this.config.refreshInterval}");

    // Set up states for iHome
    await this.setupStates();

    // In order to get state updates, you need to subscribe to them
    this.subscribeStates("*");
  }

  /**
   * Sets up the necessary states for iHome
   */
  async setupStates() {
    // Connection status
    await this.setObjectNotExistsAsync("connection.status", {
      type: "state",
      common: {
        name: "Connection Status",
        type: "string",
        role: "indicator",
        read: true,
        write: false,
      },
      native: {},
    });

    // Last update timestamp
    await this.setObjectNotExistsAsync("connection.lastUpdate", {
      type: "state",
      common: {
        name: "Last Update Timestamp",
        type: "number",
        role: "value",
        read: true,
        write: false,
      },
      native: {},
    });

    // Initialize connection status
    await this.setState("connection.status", "connected", true);
    await this.setState("connection.lastUpdate", Date.now(), true);
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param {() => void} callback - Callback function
   */
  onUnload(callback) {
    try {
      // Clear any intervals or timeouts here
      this.log.info("iHome adapter stopped");
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }

  /**
   * Is called if a subscribed object changes
   * @param {string} id
   * @param {ioBroker.Object | null | undefined} obj
   */
  onObjectChange(id, obj) {
    if (obj) {
      // The object was changed
      this.log.debug(`object ${id} changed: ${JSON.stringify(obj)}`);
    } else {
      // The object was deleted
      this.log.debug(`object ${id} deleted`);
    }
  }

  /**
   * Is called if a subscribed state changes
   *
   * @param {string} id - State ID
   * @param {ioBroker.State | null | undefined} state - State object
   */
  onStateChange(id, state) {
    if (state) {
      // The state was changed
      this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

      if (state.ack === false) {
        // This is a command from the user (e.g., from the UI or other adapter)
        // and should be processed by the adapter
        this.log.debug(`User command received for ${id}: ${state.val}`);

        // Forward state changes to the web interface if needed
        // This could be done via WebSocket or HTTP endpoints
      }
    } else {
      // The object was deleted or the state value has expired
      this.log.debug(`state ${id} deleted`);
    }
  }
}

// If started as allInOne/compact mode, run function to create an instance
if (require.main !== module) {
  // Export the constructor in compact mode
  module.exports = (options) => new IHome(options);
} else {
  // Otherwise start the instance directly
  new IHome();
}
