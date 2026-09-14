// Rendering astro-code's commands and agents into each host's own format.
//
// The source of truth stays exactly where it is: `commands/*.md` and
// `agents/*.md`, authored once, in Claude Code's shape. A host adapter renders
// them on the way out. Nothing is authored per host, so a command can never
// drift between harnesses.
//
// The three hosts agree far more than they differ. All of them keep commands as
// markdown with `description` + `argument-hint` frontmatter and `$ARGUMENTS`
// expansion, so a command is very nearly a passthrough everywhere. What
// actually differs:
//
//   allowed-tools   Claude-only. Pi has a `tools` allowlist, Codex gates tools
//                   through its sandbox policy instead, so the key is dropped.
//   tool names      Claude's are capitalised (Read/Write/Edit/Bash/Grep/Glob);
//                   Pi and Codex use lowercase built-ins with different names.
//   agent format    Claude and Pi read a single markdown file with frontmatter.
//                   Codex reads a skill DIRECTORY: SKILL.md (same `name` +
//                   `description` frontmatter) plus an agents/openai.yaml
//                   sidecar carrying display metadata and invocation policy.
//                   Verified against the six agents shipped in ~/.codex/skills
//                   /.system on a real 0.154.0 install — earlier prose docs
//                   describing ~/.codex/agents/*.toml did NOT match reality.
//   colour          Claude-only cosmetic; dropped elsewhere.
//
// Everything here is pure string work — no filesystem, no host detection — so
// it is fully testable without any harness installed.

/** Split a markdown file into { frontmatter, body }. No YAML dependency: the
 *  frontmatter astro-code authors is flat `key: value`, one per line. Anything
 *  richer would be a silent mis-parse, so nested structures are left as raw
 *  strings rather than guessed at. */
export function parseFrontmatter(text) {
  const src = String(text ?? '');
  if (!src.startsWith('---')) return { frontmatter: {}, body: src };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: src };
  const block = src.slice(src.indexOf('\n') + 1, end);
  const body = src.slice(end + 4).replace(/^\r?\n/, '');
  const frontmatter = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    frontmatter[m[1]] = m[2].trim();
  }
  return { frontmatter, body };
}

/**
 * Re-emit a markdown file from { frontmatter, body }, preserving key order.
 *
 * Exact inverse of parseFrontmatter: that strips exactly one newline after the
 * closing `---`, so this re-adds exactly one. Getting this off by a newline
 * silently reformats every command on the way to a host, which shows up as a
 * whole-file diff the next time anyone compares them.
 */
export function toMarkdown(frontmatter, body) {
  const keys = Object.keys(frontmatter).filter((k) => frontmatter[k] !== undefined && frontmatter[k] !== '');
  if (!keys.length) return body;
  const lines = ['---', ...keys.map((k) => `${k}: ${frontmatter[k]}`), '---'];
  return `${lines.join('\n')}\n${body}`;
}

/**
 * Claude tool name -> each host's equivalent.
 *
 * Verified against the shipped tool definitions rather than guessed: Pi's
 * built-ins are read/write/edit/bash/grep/find/ls, and Codex gates filesystem
 * and shell access through its sandbox policy instead of a per-agent list.
 *
 * `null` means "this host has no equivalent" — the tool is dropped rather than
 * mapped to something approximate, because a wrong mapping silently grants or
 * denies a capability the agent was written to expect.
 */
export const TOOL_MAP = {
  pi: {
    Read: 'read', Write: 'write', Edit: 'edit', Bash: 'bash', Grep: 'grep',
    Glob: 'find', LS: 'ls',
    // No Pi built-in equivalent; extensions may provide them, but astro-code
    // must not assume an extension is installed.
    WebSearch: null, WebFetch: null, ToolSearch: null,
  },
};

/** Map a Claude `tools:` string for a host. Unknown names pass through
 *  unchanged — a server-qualified MCP tool id means the same thing on every
 *  host, and dropping it would quietly remove a capability. */
export function mapTools(toolsCsv, hostId) {
  const table = TOOL_MAP[hostId];
  const names = String(toolsCsv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!table) return names;
  const out = [];
  for (const n of names) {
    if (!(n in table)) { out.push(n); continue; }   // unknown → keep verbatim
    const mapped = table[n];
    if (mapped) out.push(mapped);                    // null → deliberately dropped
  }
  return out;
}

/**
 * Minimal YAML emitter for Codex's `agents/openai.yaml` sidecar.
 *
 * Only the nesting that file actually uses: one level of mappings holding
 * scalars. Deliberately not a general YAML writer — astro-code emits a fixed
 * shape, and a half-complete serialiser invited to handle arbitrary input is
 * how you get silently malformed config.
 */
export function toYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      out.push(`${pad}${k}:`);
      out.push(toYaml(v, indent + 2).replace(/\n$/, ''));
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      out.push(`${pad}${k}: ${v}`);
    } else {
      out.push(`${pad}${k}: ${JSON.stringify(String(v))}`);
    }
  }
  return out.join('\n') + '\n';
}
