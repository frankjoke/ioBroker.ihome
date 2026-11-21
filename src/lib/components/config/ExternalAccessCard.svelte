<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import {
    addExternalService,
    addExternalUser,
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
    setExternalServiceEnabled,
    setExternalUserEnabled,
    updateExternalService,
    validateExternalCaddy,
    webhookLink,
    writeExternalServicesSnippet,
    writeExternalSnippet,
    type ExternalServiceView,
  } from "$lib/stores/external-access.svelte";
  import {
    endpointToken,
    parseHttpInSettings,
  } from "$lib/config/http-in-endpoints";
  import { getPlugins, loadPlugins } from "$lib/stores/plugins.svelte";
  import { externalSessionSettings } from "$lib/config/locality";
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

  let openId = $state<string | null>(null);
  let draft = $state<ExternalServiceView | null>(null);
  let initial = $state("");
  let pendingAction: (() => void) | null = null;
  let askDiscard = $state(false);
  let pendingDelete = $state<ExternalServiceView | null>(null);
  let copied = $state("");
  let addServiceOpen = $state(false);
  let addKind = $state<"webhook" | "proxy">("webhook");
  let addEndpoint = $state("");
  let addPath = $state("");
  let addUpstream = $state("");
  let addStrip = $state(true);

  onMount(() => {
    void loadExternalAccess();
    if (getPlugins().length === 0) void loadPlugins();
  });

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
  const caddy = $derived(
    (status?.caddy as
      { importsSnippet?: boolean | null; config?: string } | undefined) ?? {},
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

  function linkFor(service: ExternalServiceView): string {
    const origin = publicUrl.url || location.origin;
    if (service.kind === "proxy") return proxyLink(origin, service.path);
    const token = tokenFor(service).token;
    return token ? webhookLink(origin, service.path, token) : "";
  }

  function maskToken(token: string): string {
    return token.length > 8
      ? `${token.slice(0, 4)}…${token.slice(-4)}`
      : "••••";
  }

  function serviceDirty(): boolean {
    return !!draft && JSON.stringify(draft) !== initial;
  }

  function begin(service: ExternalServiceView): void {
    openId = service.id;
    draft = { ...service };
    initial = JSON.stringify(draft);
  }

  function closeDraft(): void {
    openId = null;
    draft = null;
    initial = "";
  }

  function guard(action: () => void): void {
    if (openId && serviceDirty()) {
      pendingAction = action;
      askDiscard = true;
      return;
    }
    action();
  }

  function toggleService(service: ExternalServiceView): void {
    guard(() => {
      if (openId === service.id) closeDraft();
      else begin(service);
    });
  }

  function onServiceLine(
    event: MouseEvent,
    service: ExternalServiceView,
  ): void {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, label")) return;
    toggleService(service);
  }

  async function saveService(): Promise<void> {
    if (!draft) return;
    working = `save:${draft.id}`;
    try {
      await updateExternalService(
        $state.snapshot(draft) as ExternalServiceView,
      );
      initial = JSON.stringify(draft);
    } catch {
      /* problem */
    } finally {
      working = "";
    }
  }

  async function toggleServiceEnabled(
    service: ExternalServiceView,
    enabled: boolean,
  ): Promise<void> {
    if (openId === service.id && draft) {
      draft.enabled = enabled;
      return;
    }
    working = `toggle:${service.id}`;
    try {
      await setExternalServiceEnabled(service.id, enabled);
    } catch {
      /* problem */
    } finally {
      working = "";
    }
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

  async function deleteService(): Promise<void> {
    const service = pendingDelete;
    pendingDelete = null;
    if (!service) return;
    working = `delete:${service.id}`;
    try {
      await removeExternalService(service.id);
      if (openId === service.id) closeDraft();
    } catch {
      /* problem */
    } finally {
      working = "";
    }
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

  function draftEndpointChanged(): void {
    if (!draft) return;
    const endpoint = httpView.endpoints.find(
      (row) => row.path === draft?.endpoint,
    );
    if (endpoint) draft.path = endpoint.path;
  }

  function endpointChoices(service: ExternalServiceView) {
    return httpView.endpoints.filter(
      (endpoint) =>
        endpoint.path === service.endpoint ||
        !services.some(
          (other) =>
            other.id !== service.id &&
            other.kind === "webhook" &&
            other.endpoint === endpoint.path,
        ),
    );
  }

  async function createService(): Promise<void> {
    if (!addPath.trim() || !addUpstream.trim()) return;
    const service: ExternalServiceView = {
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
    <span class="label-mono">Import</span>
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
        {#if row.note}<span class="user-note text-muted">{row.note}</span>{/if}
        <label class="check">
          <input
            type="checkbox"
            checked={row.enabled}
            disabled={working === row.user}
            onchange={(e) => void toggleUser(row.user, e.currentTarget.checked)}
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
            disabled={working === "add" || !name.trim() || password.length < 8}
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

  <div class="services section-panel">
    <div class="section-head">
      <span class="label-mono">Services ({services.length})</span>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        disabled={addServiceOpen}
        onclick={startService}>+ Service</button
      >
    </div>

    {#each services as service (service.id)}
      {@const open = openId === service.id}
      {@const link = linkFor(service)}
      {@const token = tokenFor(service)}
      <div class="item" class:open>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="item-line" onclick={(e) => onServiceLine(e, service)}>
          <span class="badge badge-secondary">{service.kind}</span>
          <button
            type="button"
            class="name"
            aria-expanded={open}
            onclick={() => toggleService(service)}>{service.path}</button
          >
          <span class="mono upstream">{service.upstream}</span>
          <span class="badge">{service.auth}</span>
          {#if service.kind === "webhook"}
            <span
              class="badge"
              class:badge-warning={token.source === "none"}
              title="http.in token"
              >{token.source === "none"
                ? "no token"
                : token.source === "global"
                  ? "global token"
                  : "endpoint token"}</span
            >
          {/if}
          <label class="check">
            <input
              type="checkbox"
              checked={open && draft ? draft.enabled : service.enabled}
              disabled={working === `toggle:${service.id}`}
              onchange={(e) =>
                void toggleServiceEnabled(service, e.currentTarget.checked)}
            />
            <span>enabled</span>
          </label>
          <span class="item-actions">
            <IconButton
              icon="content_copy"
              label={`Copy link for ${service.path}`}
              title={copied === service.id ? "Copied." : "Copy link"}
              disabled={!link}
              onclick={() => void copyLink(service)}
            />
            <IconButton
              icon="delete"
              label={deleteTitle("service", service.path)}
              danger
              disabled={working === `delete:${service.id}`}
              onclick={() => (pendingDelete = service)}
            />
            {#if open}
              <button
                type="button"
                class="btn btn-primary btn-sm"
                disabled={!serviceDirty() || working === `save:${service.id}`}
                onclick={() => void saveService()}>Save</button
              >
            {/if}
          </span>
        </div>
        {#if copied === service.id}
          <p class="hint text-muted">Copied.</p>
        {/if}

        {#if open && draft}
          <div class="item-editor service-editor">
            <div class="fields">
              {#if draft.kind === "webhook"}
                <label class="field">
                  <span class="label-mono">http.in endpoint</span>
                  <select
                    bind:value={draft.endpoint}
                    onchange={draftEndpointChanged}
                  >
                    {#each endpointChoices(draft) as endpoint (endpoint.path)}
                      <option value={endpoint.path}>{endpoint.path}</option>
                    {/each}
                  </select>
                </label>
                <label class="field">
                  <span class="label-mono">Path</span>
                  <input value={draft.path} readonly tabindex="-1" />
                </label>
              {:else}
                <label class="field">
                  <span class="label-mono">Path</span>
                  <input type="text" bind:value={draft.path} />
                </label>
              {/if}
              <label class="field">
                <span class="label-mono">Upstream</span>
                <input type="text" bind:value={draft.upstream} />
              </label>
              {#if draft.kind === "proxy"}
                <label class="check">
                  <input type="checkbox" bind:checked={draft.stripPrefix} />
                  <span>strip prefix</span>
                </label>
              {/if}
            </div>

            {#if draft.kind === "webhook"}
              <div class="token-line">
                <span class="label-mono">Token</span>
                {#if token.source === "none"}
                  <span class="badge badge-warning">no token</span>
                  <span class="hint text-danger"
                    >This route is public until you set a token.</span
                  >
                {:else}
                  <code>{maskToken(token.token)}</code>
                  <span class="badge"
                    >{token.source === "endpoint"
                      ? "endpoint"
                      : "global token"}</span
                  >
                {/if}
                <IconButton
                  icon="key"
                  label={`Rotate the token for ${draft.path}`}
                  title="Rotate token"
                  disabled={working === `token:${draft.id}`}
                  onclick={() => void rotateToken(draft!)}
                />
                <span class="token-link">
                  {#if link}<code>{link}</code>{:else}
                    <span class="hint text-muted">No token — no link.</span>
                  {/if}
                </span>
              </div>
            {:else}
              <p class="hint text-muted">
                Basic Auth · <code>{linkFor(draft)}</code>
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <p class="hint text-muted">No services yet.</p>
    {/each}

    {#if addServiceOpen}
      <div class="card form-card service-form">
        <div class="fields">
          <label class="field">
            <span class="label-mono">Kind</span>
            <select bind:value={addKind}>
              <option value="webhook">webhook</option>
              <option value="proxy">proxy</option>
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
          {:else}
            <label class="field">
              <span class="label-mono">Path</span>
              <input type="text" bind:value={addPath} placeholder="/opencode" />
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
              !addPath.trim() ||
              !addUpstream.trim() ||
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
  {#if servicesSnippet.path}
    <p class="hint text-muted">
      Caddyfile imports:
      <code>{`import ${servicesSnippet.path}`}</code>
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

{#if askDiscard}
  <ConfirmModal
    title="Discard changes?"
    confirmLabel="Discard"
    onConfirm={() => {
      const action = pendingAction;
      pendingAction = null;
      askDiscard = false;
      closeDraft();
      action?.();
    }}
    onCancel={() => {
      pendingAction = null;
      askDiscard = false;
    }}
  >
    The service has unsaved changes. Closing discards them.
  </ConfirmModal>
{/if}

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
    onConfirm={() => void deleteService()}
    onCancel={() => (pendingDelete = null)}
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
  .upstream {
    font-size: var(--body-sm);
    overflow-wrap: anywhere;
  }
  .service-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
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
  .token-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
    min-width: 0;
  }
  .token-line code {
    font-family: var(--font-code);
    font-size: var(--body-sm);
    overflow-wrap: anywhere;
  }
  .token-link {
    flex: 1 1 14rem;
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
