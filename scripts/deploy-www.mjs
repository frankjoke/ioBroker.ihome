#!/usr/bin/env node
// Uploads the built SPA (www/) into the running broker's file storage over the
// ioBroker MCP endpoint, so the web adapter serves it at /ihome/ right away —
// no adapter install, no upload command. Adapter code (main.js) still ships as
// a tarball; this is for the UI only.
//
//   IOBROKER_MCP=http://host:8082/mcp/ node scripts/deploy-www.mjs
//
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BASE = process.env.IOBROKER_MCP || "http://localhost:8082/mcp/";
const ROOT = process.argv[2] || "www";
const NS = process.argv[3] || "ihome"; // file namespace the adapter's www lives in
const BINARY = new Set([".png", ".ico", ".jpg", ".jpeg", ".woff", ".woff2"]);

/** Local build tree, with paths relative to ROOT and POSIX slashes. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const isDir = statSync(abs).isDirectory();
    out.push({ rel: relative(ROOT, abs).split(sep).join("/"), abs, isDir });
    if (isDir) out.push(...walk(abs));
  }
  return out;
}

async function rpc(body, session) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(session ? { "mcp-session-id": session } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const msgs = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => {
      try {
        return JSON.parse(l.slice(6));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return {
    session: res.headers.get("mcp-session-id"),
    msgs,
    status: res.status,
  };
}

function makeClient(session) {
  let id = 0;
  return async (name, args) => {
    const res = await rpc(
      {
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      },
      session,
    );
    const payload = res.msgs[0]?.result?.content?.[0]?.text;
    if (!payload)
      throw new Error(`${name} failed: ${JSON.stringify(res).slice(0, 200)}`);
    const parsed = JSON.parse(payload);
    if (parsed.ok === false) throw new Error(`${name}: ${parsed.error}`);
    return parsed.data;
  };
}

async function listRemote(call, path) {
  const data = await call("list_files", { path });
  const files = [];
  const dirs = [];
  for (const f of data?.files ?? []) {
    const rel = `${path}/${f.file}`;
    if (f.isDir) {
      dirs.push(rel);
      const sub = await listRemote(call, rel);
      files.push(...sub.files);
      dirs.push(...sub.dirs);
    } else {
      files.push(rel);
    }
  }
  return { files, dirs };
}

const init = await rpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "ihome-deploy", version: "1" },
  },
});
if (init.status !== 200 || !init.session) {
  console.error(`no MCP session from ${BASE} (status ${init.status})`);
  process.exit(1);
}
const call = makeClient(init.session);

const local = walk(ROOT);
const localFiles = local.filter((f) => !f.isDir);
const localDirs = local.filter((f) => f.isDir).map((f) => `${NS}/${f.rel}`);
const localPaths = new Set(localFiles.map((f) => `${NS}/${f.rel}`));

// directories first (write_file does not create them implicitly)
const remote = await listRemote(call, NS);
for (const dir of localDirs) {
  if (!remote.dirs.includes(dir)) await call("mkdir", { path: dir });
}

let written = 0;
for (const file of localFiles) {
  const ext = file.rel.slice(file.rel.lastIndexOf(".")).toLowerCase();
  const buf = readFileSync(file.abs);
  await call("write_file", {
    path: `${NS}/${file.rel}`,
    content: BINARY.has(ext) ? buf.toString("base64") : buf.toString("utf8"),
    ...(BINARY.has(ext) ? { base64: true } : {}),
  });
  written++;
}

// Drop files the build no longer has (old hashed chunks). Files only — the
// file storage has no directory removal, so a stale directory just stays.
let removed = 0;
for (const path of remote.files) {
  if (localPaths.has(path)) continue;
  try {
    await call("delete_file", { path });
    removed++;
  } catch {
    // already gone — nothing to do
  }
}

console.log(
  `${BASE} → ${NS}: ${written} files written, ${removed} stale removed`,
);
