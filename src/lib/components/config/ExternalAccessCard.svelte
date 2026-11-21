<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import SchemaSettingsEditor from "$lib/components/settings/SchemaSettingsEditor.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import {
    addExternalService,
    addExternalUser,
    createSitePairing,
    getExternalProblem,
    getExternalServices,
    getExternalSnippet,
    getExternalStatus,
    getExternalUsers,
    loadExternalAccess,
    proxyLink,
    reloadExternalCaddy,
    removeExternalService,
    removeExternalUser,
    rotateWebhookToken,
    setExternalUserEnabled,
    updateExternalService,
    validateExternalCaddy,
    webhookLink,
    writeExternalServicesSnippet,
    writeExternalSnippet,
    type ExternalServiceView,
    type SitePairing,
  } from "$lib/stores/external-access.svelte";
  import {
    endpointToken,
    parseHttpInSettings,
  } from "$lib/config/http-in-endpoints";
  import {
    getPlugins,
    loadPlugins,
    savePlugin,
  } from "$lib/stores/plugins.svelte";
  import type { PluginView } from "$adapter/plugin-admin";
  import { externalSessionSettings } from "$lib/config/locality";
  import { servicesSchema } from "$lib/config/caddy-services-schema";
  import type { ArrayHooks } from "$lib/config/schema-values";
  import {
    getSettings,
    initSettings,
    updateSettings,
  } from "$lib/stores/settings.svelte";
  import { onMount } from "svelte";
  import { base } from "$app/paths";

  let name = $state("");
  let password = $state("");
  let note = $state("");
  let addOpen = $state(false);
  let added = $state("");
  let outputs = $state("");
  let pendingRemove = $state<string | null>(null);
  let working = $state("");
  let externalNote = $state("");
  const tabs = [
    { id: "services", label: "Services", hint: "Public webhooks and proxies" },
    { id: "users", label: "Users", hint: "Basic-Auth logins" },
    {
      id: "settings",
      label: "Settings",
      hint: "Folder, Caddyfile and public URL",
    },
    { id: "help", label: "Help", hint: "Setup guide" },
  ];
  let tab = $state("services");
  let settingsDraft = $state<Record<string, unknown>>({});
  let settingsInitial = $state("{}");
  let settingsValid = $state(true);
  let settingsSaving = $state(false);
  let settingsError = $state("");
  const pluginView = $derived(
    getPlugins().find((plugin) => plugin.id === "external-access"),
  );
  const settingsDirty = $derived(
    JSON.stringify(settingsDraft) !== settingsInitial,
  );

  let pendingDelete = $state<ExternalServiceView | null>(null);
  let deleteResolve: (() => void) | null = null;
  let deleteReject: ((error: Error) => void) | null = null;
  let copied = $state("");
  let pairing = $state<({ id: string } & SitePairing) | null>(null);
  let addServiceOpen = $state(false);
  let addKind = $state<"webhook" | "proxy" | "site">("webhook");
  let addEndpoint = $state("");
  let addPath = $state("");
  let addPort = $state(8444);
  let addAuth = $state<"basic" | "none">("basic");
  let addUpstream = $state("");
  let addStrip = $state(true);

  onMount(() => {
    void loadExternalAccess();
    if (getPlugins().length === 0) void loadPlugins();
  });

  function settingsOf(view: PluginView): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const def of view.settingsSchema ?? []) {
      if (def.default !== undefined) next[def.name] = def.default;
    }
    return { ...next, ...(view.settings ?? {}) };
  }

  $effect(() => {
    const view = pluginView;
    if (!view) return;
    const next = settingsOf(view);
    const text = JSON.stringify(next);
    if (text === settingsInitial || settingsDirty) return;
    settingsDraft = next;
    settingsInitial = text;
  });

  async function saveSettings(): Promise<void> {
    settingsError = "";
    settingsSaving = true;
    try {
      await savePlugin({
        id: "external-access",
        settings: $state.snapshot(settingsDraft) as Record<string, unknown>,
      });
      await loadExternalAccess();
      settingsInitial = JSON.stringify(settingsDraft);
    } catch (failure) {
      settingsError =
        failure instanceof Error ? failure.message : String(failure);
    } finally {
      settingsSaving = false;
    }
  }

  const users = $derived(getExternalUsers());
  const services = $derived(getExternalServices());
  const status = $derived(getExternalStatus());
  const snippet = $derived(getExternalSnippet());
  const problem = $derived(getExternalProblem());
  const httpView = $derived(
    parseHttpInSettings(
      getPlugins().find((plugin) => plugin.id === "http.in")?.settings,
    ),
  );

  const folder = $derived(
    (status?.folder as { path?: string; writable?: boolean } | undefined) ?? {},
  );
  const snippetState = $derived(
    (status?.snippet as
      { exists?: boolean; current?: boolean; path?: string } | undefined) ?? {},
  );
  const servicesSnippet = $derived(
    (status?.servicesSnippet as
      | { exists?: boolean; current?: boolean; path?: string; blocks?: number }
      | undefined) ?? {},
  );
  const sitesSnippet = $derived(
    (status?.sitesSnippet as
      | { exists?: boolean; current?: boolean; path?: string; blocks?: number }
      | undefined) ?? {},
  );
  const caddy = $derived(
    (status?.caddy as
      | {
          importsSnippet?: boolean | null;
          importsSites?: boolean | null;
          config?: string;
        }
      | undefined) ?? {},
  );
  const publicUrl = $derived(
    (status?.publicUrl as
      | { url?: string; status?: number; ok?: boolean; error?: string }
      | undefined) ?? {},
  );

  const availableEndpoints = $derived(
    httpView.endpoints.filter(
      (endpoint) =>
        !services.some(
          (service) =>
            service.kind === "webhook" && service.endpoint === endpoint.path,
        ),
    ),
  );
  const servicesValues = $derived({
    services: services.map((service) => ({ ...service })),
  });
  const siteServices = $derived(
    services.filter((service) => service.kind === "site"),
  );

  function generate(): void {
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    password = Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  }

  async function run(
    label: string,
    action: () => Promise<unknown>,
  ): Promise<void> {
    working = label;
    outputs = "";
    try {
      const reply = (await action()) as
        | {
            ok?: boolean;
            changed?: boolean;
            command?: string;
            output?: string;
            code?: unknown;
          }
        | undefined;
      if (reply && "changed" in reply) {
        outputs = reply.changed
          ? "Snippet written."
          : "Snippet is already current.";
      } else if (reply && "ok" in reply) {
        outputs =
          `${reply.ok ? "ok" : `failed (${String(reply.code ?? "")})`}\n$ ${reply.command ?? ""}\n${reply.output ?? ""}`.trim();
      }
      await loadExternalAccess();
    } catch {
      /* problem is shown below */
    } finally {
      working = "";
    }
  }

  async function useAsExternal(): Promise<void> {
    if (!publicUrl.url) return;
    await initSettings();
    const host = new URL(publicUrl.url).hostname.toLowerCase();
    const cur = externalSessionSettings(getSettings().externalSession);
    if (!cur.externalHosts.includes(host)) {
      await updateSettings({
        externalSession: {
          ...cur,
          externalHosts: [...cur.externalHosts, host],
        },
      });
    }
    externalNote = `${host} added to External hosts`;
  }

  async function add(): Promise<void> {
    added = "";
    working = "add";
    try {
      await addExternalUser(name, password, note);
      added = password;
      name = "";
      password = "";
      note = "";
      addOpen = false;
      await loadExternalAccess();
    } catch {
      /* problem is shown below */
    } finally {
      working = "";
    }
  }

  async function toggleUser(user: string, enabled: boolean): Promise<void> {
    working = user;
    try {
      await setExternalUserEnabled(user, enabled);
    } catch {
      /* problem */
    } finally {
      working = "";
    }
  }

  async function remove(user: string): Promise<void> {
    pendingRemove = null;
    working = user;
    try {
      await removeExternalUser(user);
    } catch {
      /* problem */
    } finally {
      working = "";
    }
  }

  function endpointFor(service: ExternalServiceView) {
    return httpView.endpoints.find(
      (endpoint) => endpoint.path === service.endpoint,
    );
  }

  function tokenFor(service: ExternalServiceView) {
    return endpointToken(endpointFor(service), httpView.globalToken);
  }

  function publicHost(): string {
    const url = publicUrl.url;
    if (!url) return "";
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  function linkFor(service: ExternalServiceView): string {
    if (service.kind === "site") {
      const host = publicHost();
      return host && service.port ? `https://${host}:${service.port}/` : "";
    }
    const origin = publicUrl.url || location.origin;
    if (!service.path) return "";
    if (service.kind === "proxy") return proxyLink(origin, service.path);
    const token = tokenFor(service).token;
    return token ? webhookLink(origin, service.path, token) : "";
  }

  function sitePortValid(): boolean {
    const port = Number(addPort);
    return (
      Number.isInteger(port) &&
      port >= 1 &&
      port <= 65_535 &&
      port !== 80 &&
      port !== 443
    );
  }

  async function rotateToken(service: ExternalServiceView): Promise<void> {
    if (!service.endpoint) return;
    working = `token:${service.id}`;
    outputs = "";
    try {
      await rotateWebhookToken(service.endpoint);
      outputs = "Token rotated — copy the link.";
    } catch {
      /* problem */
    } finally {
      working = "";
    }
  }

  async function copyLink(service: ExternalServiceView): Promise<void> {
    const link = linkFor(service);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      copied = service.id;
      setTimeout(() => {
        if (copied === service.id) copied = "";
      }, 1500);
    } catch {
      /* clipboard may be blocked on plain http */
    }
  }

  async function pairDevice(service: ExternalServiceView): Promise<void> {
    working = `pair:${service.id}`;
    pairing = null;
    try {
      pairing = { id: service.id, ...(await createSitePairing(service.id)) };
    } catch {
      /* problem */
    } finally {
      working = "";
    }
  }

  async function copyText(text: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
      setTimeout(() => {
        if (copied === key) copied = "";
      }, 1500);
    } catch {
      /* clipboard may be blocked on plain http */
    }
  }

  async function confirmDelete(): Promise<void> {
    const service = pendingDelete;
    pendingDelete = null;
    if (!service) {
      deleteResolve?.();
      deleteResolve = null;
      deleteReject = null;
      return;
    }
    working = `delete:${service.id}`;
    try {
      await removeExternalService(service.id);
      deleteResolve?.();
    } catch (error) {
      deleteReject?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      deleteResolve = null;
      deleteReject = null;
      working = "";
    }
  }

  function cancelDelete(): void {
    pendingDelete = null;
    deleteResolve?.();
    deleteResolve = null;
    deleteReject = null;
  }

  function serviceId(path: string): string {
    const base =
      path
        .replace(/^\//, "")
        .replace(/[^A-Za-z0-9._-]/g, "-")
        .slice(0, 32) || "service";
    let id = base;
    let next = 2;
    while (services.some((row) => row.id === id)) {
      id = `${base.slice(0, 30)}-${next++}`;
    }
    return id;
  }

  function startService(): void {
    addServiceOpen = true;
    addKind = "webhook";
    const first = availableEndpoints[0];
    addEndpoint = first?.path ?? "";
    addPath = first?.path ?? "";
    addPort = 8444;
    addAuth = "basic";
    addUpstream = first
      ? `127.0.0.1:${first.port ?? httpView.defaultPort}`
      : "";
    addStrip = true;
  }

  function endpointChanged(): void {
    const endpoint = httpView.endpoints.find((row) => row.path === addEndpoint);
    addPath = endpoint?.path ?? "";
    if (endpoint)
      addUpstream = `127.0.0.1:${endpoint.port ?? httpView.defaultPort}`;
  }

  async function createService(): Promise<void> {
    if (!addUpstream.trim()) return;
    if (addKind === "site" && !sitePortValid()) return;
    if (addKind !== "site" && !addPath.trim()) return;
    if (addKind === "webhook" && !addEndpoint) return;
    const service: ExternalServiceView =
      addKind === "site"
        ? {
            id: serviceId(`site-${addPort}`),
            kind: "site",
            port: Number(addPort),
            upstream: addUpstream.trim(),
            auth: addAuth,
            enabled: true,
          }
        : {
            id: serviceId(addPath.trim()),
            kind: addKind,
            path: addPath.trim(),
            upstream: addUpstream.trim(),
            auth: addKind === "webhook" ? "token" : "basic",
            enabled: true,
            ...(addKind === "webhook"
              ? { endpoint: addEndpoint }
              : addStrip
                ? { stripPrefix: true }
                : {}),
          };
    working = "add-service";
    outputs = "";
    try {
      await addExternalService(service);
      addServiceOpen = false;
    } catch {
      /* problem */
    } finally {
      working = "";
    }
  }

  function asService(row: Record<string, unknown>): ExternalServiceView {
    return row as unknown as ExternalServiceView;
  }

  const serviceHooks: Record<string, ArrayHooks> = {
    services: {
      managed: true,
      createRow: () => {
        startService();
        return null;
      },
      saveRow: async (row) => {
        const service = asService(row);
        const next: ExternalServiceView = { ...service };
        if (service.kind === "site") {
          delete next.path;
          delete next.endpoint;
          delete next.stripPrefix;
        } else if (service.kind === "webhook") {
          next.path = service.endpoint ?? service.path;
          delete next.stripPrefix;
        } else {
          delete next.endpoint;
        }
        await updateExternalService(
          $state.snapshot(next) as ExternalServiceView,
        );
      },
      removeRow: (row) =>
        new Promise<void>((resolve, reject) => {
          pendingDelete = asService(row);
          deleteResolve = resolve;
          deleteReject = reject;
        }),
      rowNote: (row) => {
        const service = asService(row);
        if (service.kind === "site") {
          return service.auth === "basic" ? "Basic Auth" : "upstream auth";
        }
        if (service.kind !== "webhook") return "";
        const source = tokenFor(service).source;
        return source === "none"
          ? "no token"
          : source === "global"
            ? "global token"
            : "endpoint token";
      },
      rowActions: (row) => {
        const service = asService(row);
        const link = linkFor(service);
        return [
          ...(service.kind === "webhook" && service.endpoint
            ? [
                {
                  icon: "key",
                  label: `Rotate the token for ${service.path ?? ""}`,
                  title: "Rotate token",
                  disabled: working !== "",
                  onclick: () => void rotateToken(service),
                },
              ]
            : []),
          ...(service.kind === "site"
            ? [
                {
                  icon: "key",
                  label: `Pair a device with ${service.id}`,
                  title: "Pair device",
                  disabled: working !== "",
                  onclick: () => void pairDevice(service),
                },
              ]
            : []),
          {
            icon: "content_copy",
            label: `Copy link for ${service.path ?? `site ${service.port ?? ""}`}`,
            title: copied === service.id ? "Copied." : "Copy link",
            disabled: !link,
            onclick: () => void copyLink(service),
          },
        ];
      },
      validateItem: (row) => {
        const service = asService(row);
        if (!service.upstream?.trim()) return "Upstream is required.";
        if (service.kind === "site") {
          const port = service.port;
          if (
            !Number.isInteger(port) ||
            (port ?? 0) < 1 ||
            (port ?? 0) > 65_535 ||
            port === 80 ||
            port === 443
          ) {
            return "The port must be 1-65535 (not 80 or 443).";
          }
          if (service.auth !== "basic" && service.auth !== "none") {
            return "Choose Basic Auth or upstream auth.";
          }
          return null;
        }
        if (service.kind === "proxy" && !service.path?.trim()) {
          return "Path is required.";
        }
        if (service.kind === "webhook" && !service.endpoint) {
          return "Choose an http.in endpoint.";
        }
        return null;
      },
    },
  };
</script>

<section class="external">
  <p class="hint text-muted">
    Caddy logins and the public routes that use them. Passwords are stored as
    hashes, services as a generated snippet your Caddyfile imports once. Caddy
    reloads only when you press the button.
  </p>

  <div class="status-line">
    <span class="label-mono">Folder</span>
    <code>{folder.path ?? "not set"}</code>
    <span
      class="badge"
      class:badge-success={folder.writable}
      class:badge-warning={!folder.writable}
      >{folder.writable ? "writable" : "not writable"}</span
    >
    <span class="label-mono">Users snippet</span>
    <span
      class="badge"
      class:badge-success={snippetState.current}
      class:badge-warning={!snippetState.current}
      >{snippetState.current ? "current" : "stale"}</span
    >
    <span class="label-mono">Services snippet</span>
    <span
      class="badge"
      class:badge-success={servicesSnippet.current}
      class:badge-warning={!servicesSnippet.current}
      >{servicesSnippet.current ? "current" : "stale"}</span
    >
    <span class="label-mono">Sites snippet</span>
    <span
      class="badge"
      class:badge-success={sitesSnippet.current}
      class:badge-warning={!sitesSnippet.current}
      >{sitesSnippet.current ? "current" : "stale"}</span
    >
    <span class="label-mono">Services import</span>
    <span
      class="badge"
      class:badge-success={caddy.importsSnippet === true}
      class:badge-warning={caddy.importsSnippet === false}
      class:badge-secondary={caddy.importsSnippet == null}
      >{caddy.importsSnippet === true
        ? "current"
        : caddy.importsSnippet === false
          ? "missing"
          : "unknown"}</span
    >
    <span class="label-mono">Sites import</span>
    <span
      class="badge"
      class:badge-success={caddy.importsSites === true}
      class:badge-warning={caddy.importsSites === false}
      class:badge-secondary={caddy.importsSites == null}
      >{caddy.importsSites === true
        ? "current"
        : caddy.importsSites === false
          ? "missing"
          : "unknown"}</span
    >
    {#if publicUrl.url}
      <span class="label-mono">Public</span>
      <span
        class="badge"
        class:badge-success={publicUrl.ok}
        class:badge-warning={!publicUrl.ok}
        >{publicUrl.status ?? publicUrl.error ?? "unchecked"}</span
      >
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={() => void useAsExternal()}>Use as external host</button
      >
    {/if}
  </div>

  {#if externalNote}
    <p class="hint text-muted">{externalNote}</p>
  {/if}
  {#if !publicUrl.url}
    <p class="hint text-muted">
      Public URL not set — links use the current origin. Set it under Advanced →
      Plugins → Caddy services.
    </p>
  {/if}

  <OptionTabs
    bind:value={tab}
    label="Caddy services"
    {tabs}
    collapsible={false}
    showHint={false}
  />

  {#if tab === "users"}
    <div class="users section-panel">
      <div class="section-head">
        <span class="label-mono">Users ({users.length})</span>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          onclick={() => (addOpen = true)}>New login</button
        >
      </div>
      {#each users as row (row.user)}
        <div class="user-row">
          <span class="user-name">{row.user}</span>
          {#if row.note}<span class="user-note text-muted">{row.note}</span
            >{/if}
          <label class="check">
            <input
              type="checkbox"
              checked={row.enabled}
              disabled={working === row.user}
              onchange={(e) =>
                void toggleUser(row.user, e.currentTarget.checked)}
            />
            <span>enabled</span>
          </label>
          <span class="user-actions">
            <IconButton
              icon="delete"
              label={deleteTitle("login", row.user)}
              danger
              disabled={working === row.user}
              onclick={() => (pendingRemove = row.user)}
            />
          </span>
        </div>
      {:else}
        <p class="hint text-muted">No external logins yet.</p>
      {/each}

      {#if addOpen}
        <div class="add-form">
          <label class="field">
            <span class="label-mono">User</span>
            <input type="text" bind:value={name} autocomplete="off" />
          </label>
          <label class="field">
            <span class="label-mono">Password</span>
            <input
              type="password"
              bind:value={password}
              autocomplete="new-password"
            />
          </label>
          <label class="field">
            <span class="label-mono">Note</span>
            <input type="text" bind:value={note} placeholder="optional" />
          </label>
          <div class="add-actions">
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={generate}>Generate</button
            >
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={working === "add" ||
                !name.trim() ||
                password.length < 8}
              onclick={() => void add()}>Add</button
            >
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => {
                addOpen = false;
                password = "";
              }}>Cancel</button
            >
          </div>
        </div>
      {/if}

      {#if added}
        <p class="hint added">
          Created. The password is shown once — copy it now:
          <code>{added}</code>
        </p>
      {/if}
    </div>
  {/if}

  {#if tab === "services"}
    <div class="services section-panel">
      <SchemaSettingsEditor
        schema={servicesSchema(
          httpView.endpoints.map((endpoint) => endpoint.path),
        )}
        values={servicesValues}
        hooks={serviceHooks}
      />

      {#each siteServices as site (site.id)}
        <p class="hint text-muted">
          Site {site.port}: <code>{linkFor(site) || "set the public URL"}</code>
          · forward this port in the router.
        </p>
      {/each}

      {#if pairing}
        {@const external = pairing.external}
        {@const internal = pairing.internal}
        <p class="hint text-muted">
          Pairing link for {pairing.id} — one-time, expires in {Math.max(
            1,
            Math.round(pairing.expiresIn / 60),
          )} minutes.
        </p>
        <p class="hint text-muted">
          <code>{external}</code>
          <IconButton
            icon="content_copy"
            label="Copy external pairing link"
            title={copied === "pair:external" ? "Copied." : "Copy link"}
            onclick={() => void copyText(external, "pair:external")}
          />
        </p>
        {#if internal}
          <p class="hint text-muted">
            LAN (plain HTTP): <code>{internal}</code>
            <IconButton
              icon="content_copy"
              label="Copy LAN pairing link"
              title={copied === "pair:internal" ? "Copied." : "Copy link"}
              onclick={() => void copyText(internal, "pair:internal")}
            />
          </p>
        {/if}
      {/if}

      {#if addServiceOpen}
        <div class="card form-card service-form">
          <div class="fields">
            <label class="field">
              <span class="label-mono">Kind</span>
              <select bind:value={addKind}>
                <option value="webhook">webhook</option>
                <option value="proxy">proxy</option>
                <option value="site">site</option>
              </select>
            </label>
            {#if addKind === "webhook"}
              <label class="field">
                <span class="label-mono">http.in endpoint</span>
                <select bind:value={addEndpoint} onchange={endpointChanged}>
                  <option value="">choose…</option>
                  {#each availableEndpoints as endpoint (endpoint.path)}
                    <option value={endpoint.path}>{endpoint.path}</option>
                  {/each}
                </select>
              </label>
              <label class="field">
                <span class="label-mono">Path</span>
                <input value={addPath} readonly tabindex="-1" />
              </label>
              {#if availableEndpoints.length === 0}
                <p class="hint text-muted">
                  Every http.in endpoint is already exposed.
                </p>
              {/if}
            {:else if addKind === "proxy"}
              <label class="field">
                <span class="label-mono">Path</span>
                <input
                  type="text"
                  bind:value={addPath}
                  placeholder="/opencode"
                />
              </label>
            {:else}
              <label class="field">
                <span class="label-mono">Port</span>
                <input type="number" min="1" max="65535" bind:value={addPort} />
              </label>
              <label class="field">
                <span class="label-mono">Auth</span>
                <select bind:value={addAuth}>
                  <option value="basic">Basic Auth</option>
                  <option value="none">upstream auth</option>
                </select>
              </label>
            {/if}
            <label class="field">
              <span class="label-mono">Upstream</span>
              <input
                type="text"
                bind:value={addUpstream}
                placeholder="127.0.0.1:49374"
              />
            </label>
            {#if addKind === "proxy"}
              <label class="check">
                <input type="checkbox" bind:checked={addStrip} />
                <span>strip prefix</span>
              </label>
            {/if}
          </div>
          <div class="add-actions">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={working === "add-service" ||
                !addUpstream.trim() ||
                (addKind === "site" && !sitePortValid()) ||
                (addKind !== "site" && !addPath.trim()) ||
                (addKind === "webhook" && !addEndpoint)}
              onclick={() => void createService()}>Add</button
            >
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => (addServiceOpen = false)}>Cancel</button
            >
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if tab === "settings"}
    {#if pluginView}
      {#if pluginView.settingsSchema?.length}
        <SchemaSettingsEditor
          schema={pluginView.settingsSchema}
          bind:values={settingsDraft}
          bind:valid={settingsValid}
        />
      {:else}
        <p class="hint text-muted">This plugin has no settings.</p>
      {/if}
      {#if settingsError}
        <p class="hint text-danger">{settingsError}</p>
      {/if}
      <div class="actions">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          disabled={!settingsDirty || !settingsValid || settingsSaving}
          onclick={() => void saveSettings()}
          >{settingsSaving ? "Saving…" : "Save settings"}</button
        >
      </div>
    {:else}
      <p class="hint text-muted">Plugin settings are not loaded yet.</p>
    {/if}
  {/if}

  {#if tab === "help"}
    {#if pluginView?.usage}
      <HelpSection help={pluginView.usage} static plain />
    {:else}
      <p class="hint text-muted">No setup guide is stored for this plugin.</p>
    {/if}
    <p class="hint text-muted">
      Technical settings and import/export:
      <a href="{base}/#/plugins">Advanced → Plugins → Caddy services</a>.
    </p>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="btn btn-outline btn-sm"
      disabled={!!working}
      onclick={() => run("snippet", writeExternalSnippet)}
      >Write users snippet</button
    >
    <button
      type="button"
      class="btn btn-outline btn-sm"
      disabled={!!working}
      onclick={() => run("services", writeExternalServicesSnippet)}
      >Write services snippet</button
    >
    <button
      type="button"
      class="btn btn-outline btn-sm"
      disabled={!!working}
      onclick={() => run("validate", validateExternalCaddy)}>Validate</button
    >
    <button
      type="button"
      class="btn btn-primary btn-sm"
      disabled={!!working || !snippetState.exists}
      onclick={() => run("reload", reloadExternalCaddy)}>Reload Caddy</button
    >
    {#if working}<span class="hint text-muted">working…</span>{/if}
  </div>
  <p class="hint text-muted">Changes apply after Reload Caddy.</p>

  {#if outputs}<pre class="output">{outputs}</pre>{/if}
  {#if problem}<p class="text-danger hint">{problem}</p>{/if}
  {#if servicesSnippet.path || sitesSnippet.path}
    <p class="hint text-muted">
      Caddyfile imports:
      {#if servicesSnippet.path}
        <code>{`import ${servicesSnippet.path}`}</code> (inside the site)
      {/if}
      {#if sitesSnippet.path}
        <code>{`import ${sitesSnippet.path}`}</code> (top level)
      {/if}
    </p>
  {/if}
  {#if snippet?.path ?? snippetState.path}
    <p class="hint text-muted">
      Users: <code
        >{`basic_auth { import ${snippet?.path ?? snippetState.path} }`}</code
      >
    </p>
  {/if}
  <p class="hint text-muted">
    Setup guide:
    <a href="{base}/#/plugins">Advanced → Plugins → Caddy services</a>.
  </p>
</section>

{#if pendingRemove}
  <ConfirmModal
    title={deleteTitle("login", pendingRemove)}
    confirmLabel="Delete"
    onConfirm={() => void remove(pendingRemove!)}
    onCancel={() => (pendingRemove = null)}
  >
    The Caddy login is removed on the next reload. Sessions already open stay
    open.
  </ConfirmModal>
{/if}

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle("service", pendingDelete.path)}
    confirmLabel="Delete"
    onConfirm={() => void confirmDelete()}
    onCancel={cancelDelete}
  >
    The route is removed from the snippet on the next write; reload Caddy to
    close it.
  </ConfirmModal>
{/if}

<style>
  .external {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .status-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem;
  }
  .status-line code {
    font-family: var(--font-code);
    font-size: var(--body-sm);
    overflow-wrap: anywhere;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }
  .users,
  .services {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .user-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.25rem 0;
    min-width: 0;
  }
  .user-name {
    min-width: 7rem;
    font-weight: 600;
  }
  .user-note {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--body-sm);
  }
  .user-actions {
    margin-left: auto;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
    align-items: end;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .add-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
  }
  .add-actions {
    grid-column: 1 / -1;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .service-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .output {
    margin: 0;
    padding: 0.5rem;
    max-height: 10rem;
    overflow: auto;
    border-radius: var(--border-radius);
    background: var(--surface-container-high);
    font-family: var(--font-code);
    font-size: var(--body-sm);
    white-space: pre-wrap;
  }
  .added {
    margin: 0;
  }
</style>
