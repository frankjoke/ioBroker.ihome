<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import {
    addExternalUser,
    getExternalProblem,
    getExternalSnippet,
    getExternalStatus,
    getExternalUsers,
    loadExternalAccess,
    reloadExternalCaddy,
    removeExternalUser,
    setExternalUserEnabled,
    validateExternalCaddy,
    writeExternalSnippet,
  } from "$lib/stores/external-access.svelte";
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

  onMount(() => {
    void loadExternalAccess();
  });

  const users = $derived(getExternalUsers());
  const status = $derived(getExternalStatus());
  const snippet = $derived(getExternalSnippet());
  const problem = $derived(getExternalProblem());

  const folder = $derived(
    (status?.folder as { path?: string; writable?: boolean } | undefined) ?? {},
  );
  const snippetState = $derived(
    (status?.snippet as
      { exists?: boolean; current?: boolean; path?: string } | undefined) ?? {},
  );
  const publicUrl = $derived(
    (status?.publicUrl as
      | { url?: string; status?: number; ok?: boolean; error?: string }
      | undefined) ?? {},
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

  async function toggle(user: string, enabled: boolean): Promise<void> {
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
</script>

<section class="external">
  <p class="hint text-muted">
    The Caddy logins for iHome's external access. Passwords are stored as
    hashes; the snippet below is what your Caddyfile imports. Caddy is only
    reloaded when you press the button.
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
    <span class="label-mono">Snippet</span>
    <span
      class="badge"
      class:badge-success={snippetState.current}
      class:badge-warning={!snippetState.current}
      >{snippetState.current ? "current" : "stale"}</span
    >
    {#if publicUrl.url}
      <span class="label-mono">Public</span>
      <span
        class="badge"
        class:badge-success={publicUrl.ok}
        class:badge-warning={!publicUrl.ok}
        >{publicUrl.status ?? publicUrl.error ?? "unchecked"}</span
      >
    {/if}
  </div>

  <div class="users">
    {#each users as row (row.user)}
      <div class="user-row">
        <span class="user-name">{row.user}</span>
        {#if row.note}<span class="user-note text-muted">{row.note}</span>{/if}
        <label class="check">
          <input
            type="checkbox"
            checked={row.enabled}
            disabled={working === row.user}
            onchange={(e) => void toggle(row.user, e.currentTarget.checked)}
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
  </div>

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
        <button type="button" class="btn btn-outline btn-sm" onclick={generate}
          >Generate</button
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
  {:else}
    <button
      type="button"
      class="btn btn-outline btn-sm new"
      onclick={() => (addOpen = true)}>New login</button
    >
  {/if}

  {#if added}
    <p class="hint added">
      Created. The password is shown once — copy it now:
      <code>{added}</code>
    </p>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="btn btn-outline btn-sm"
      disabled={!!working}
      onclick={() => run("snippet", writeExternalSnippet)}>Write snippet</button
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

  {#if outputs}<pre class="output">{outputs}</pre>{/if}
  {#if problem}<p class="text-danger hint">{problem}</p>{/if}
  {#if snippet?.path ?? snippetState.path}
    <p class="hint text-muted">
      Caddyfile import:
      <code
        >{`basic_auth { import ${snippet?.path ?? snippetState.path} }`}</code
      >
    </p>
  {/if}
  <p class="hint text-muted">
    Setup guide:
    <a href="{base}/#/plugins">Advanced → Plugins → External access</a>.
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
  .users {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .user-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.25rem 0;
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
  .add-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .add-actions {
    grid-column: 1 / -1;
    display: flex;
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
  .new {
    align-self: flex-start;
  }
</style>
