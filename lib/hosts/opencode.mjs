// Host adapter: OpenCode (sst/opencode, `opencode` CLI + TUI).
//
// Verified live against opencode 2.0.29 (V2) on macOS — the model was asked to
// list its own tools and dispatchable agents after an install, and a published
// command (`/astro-status`) was run end to end via `opencode run`:
//
//   config dir     $OPENCODE_CONFIG_DIR, else $XDG_CONFIG_HOME/opencode, else
//                  ~/.config/opencode
//   commands       <config>/commands/<name>.md — markdown, `description`
//                  frontmatter, `$ARGUMENTS` expanded natively. Invoked as
//                  `/astro-plan 1`, same as Claude Code.
//   agents         <config>/agents/<name>.md — markdown with `description`,
//                  `mode: subagent` and an optional `model: <provider>/<id>`.
//                  These ARE registered subagents: the `subagent` tool (V2;
//                  `task` on V1) accepts `astro-executor` etc. as its `agent`,
//                  unlike Cursor where they are only prompt text.
//   tools          V2: subagent{agent, description, prompt, model?, sessionID?},
//                  question{questions[{question, header, options, multiple?}]},
//                  shell, read, write, edit, grep, glob, webfetch, websearch,
//                  skill. No Workflow, no ToolSearch, no todo tool.
//                  V1 names differ (task/subagent_type, bash, todowrite) — the
//                  note below names both so one rendering serves both flavors.
//
// Models. OpenCode serves models as `<provider>/<id>` (e.g.
// `openrouter/anthropic/claude-opus-5.5`), never as the `opus`/`sonnet`/`haiku`
// tiers astro-code stores, and which provider a user has is unknowable from
// here. So the tier → id translation is the user's, in ~/.astro/config.json:
//
//   "opencode": { "models": { "opus": "...", "sonnet": "...", "haiku": "..." } }
//
// and a user may pin any role to any model outright, whatever its tier:
//
//   "opencode": { "roles": { "executor": "deepseek/deepseek-v4-flash" } }
//
// Per role: the `opencode.roles` pin, else the role's tier (project
// .astrocode/config.json, then the user default) through `opencode.models`, else
// nothing — the session's model. `ac opencode models` prints the result and
// `ac opencode map|set|unset` writes both keys (user-level only: the project
// config is committed and shared with Claude teammates, who must never receive a
// provider id).
//
// Like obra/superpowers ("always specify the model explicitly when dispatching a
// subagent"), the model is chosen at DISPATCH time: OpenCode's `subagent` tool
// takes a `model`, and OPENCODE_NOTE tells the controller to pass the resolved
// one for each role. That is what makes per-project tiers and `--fast` work. The
// agent files are also stamped with the user-level result, as the fallback for a
// dispatch that omits `model`.
//
// Hooks / status line are not wired: OpenCode's equivalent is a JS plugin
// (see obra/superpowers' .opencode/plugins), a separate piece of work. That also
// means canon-guard (VERDICT.json) and git-guard never run here; the read-only
// agents are held read-only by their `permission:` block instead.
//
// Stateless about HOME/env, like every adapter: see lib/hosts/index.mjs.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter, toMarkdown } from './render.mjs';
import { withUserRoleDefaults, loadConfig } from '../config.mjs';
import { profileModels } from '../models.mjs';
import { isReadonly } from './cursor.mjs';

export const id = 'opencode';
export const label = 'OpenCode';

/** Commands AND agents are flat markdown, copied — OpenCode must work with no
 *  Claude Code install to symlink from, exactly like Cursor. */
export const placement = { commands: 'commands', agents: 'agents', ext: '.md', mode: 'copy' };

export function baseConfigDir() {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR;
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdg, 'opencode');
}

/** OpenCode has a single global config dir. */
export function configTargets() {
  return new Map([[baseConfigDir(), 'base']]);
}

function onPath(bin) {
  const dirs = String(process.env.PATH || '').split(delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [bin, `${bin}.exe`, `${bin}.cmd`] : [bin];
  return dirs.some((d) => names.some((n) => existsSync(join(d, n))));
}

/** Present when its config dir exists or `opencode` is on PATH. */
export function detect() {
  return existsSync(baseConfigDir()) || onPath('opencode');
}

/**
 * Prepended to every rendered command. The bodies are authored once, against
 * Claude Code's tool names; this maps them onto OpenCode's without rewriting
 * the body.
 */
export const OPENCODE_NOTE = `> **Running on OpenCode.** These steps were written for Claude Code; map its tools like this:
> - **Workflow tool** — not available here. Take the next tier the step offers (subagents, else inline).
> - **Agent tool** — use \`subagent\` (OpenCode 2.x) with \`agent: "<name>"\`, or \`task\` with \`subagent_type: "<name>"\` (1.x). The astro agents (\`astro-planner\`, \`astro-researcher\`, \`astro-executor\`, \`astro-verifier\`, \`astro-criteria-author\`, \`astro-mapper\`) are registered subagents here — dispatch them by name; **always pass \`model\`**: run \`ac opencode models --json\` once (add \`--fast\` when this command was given \`--fast\`) and use the entry for the dispatch's role — \`planner\` for astro-planner/astro-criteria-author, \`researcher\` for astro-researcher/astro-mapper/explore, \`executor\`, \`verifier\`, \`discover\`, \`integrator\` as the step names it; a \`null\` entry means omit \`model\`. \`Explore\` → \`explore\`; \`general-purpose\` → \`general\`. Independent subagents go in one message so they run in parallel.
> - **AskUserQuestion** — use the \`question\` tool (same questions, headers and options; \`multiSelect\` → \`multiple\`).
> - **Bash** → \`shell\` (2.x) or \`bash\` (1.x). Run every \`ac …\` from the project root that holds \`.astrocode/\`.
> - **TodoWrite / ToolSearch / hooks / status line / \`allowed-tools\`** — Claude Code only; skip them.

`;

/**
 * A command renders as one file: the source's `description` (`allowed-tools`
 * and `argument-hint` are Claude-only and dropped), OPENCODE_NOTE, then the
 * source body verbatim — `$ARGUMENTS` is left for OpenCode to substitute.
 */
export function renderCommand(name, source) {
  const { frontmatter, body } = parseFrontmatter(source);
  const content = toMarkdown({ description: frontmatter.description }, OPENCODE_NOTE + body);
  return [{ path: `${name}.md`, content }];
}

/** Which astro role's tier an agent runs at — mirrors the workflows' dispatch
 *  (criteria-author runs at the planner's tier in plan-phase.mjs). */
export const AGENT_ROLE = {
  'astro-planner': 'planner',
  'astro-criteria-author': 'planner',
  'astro-researcher': 'researcher',
  'astro-mapper': 'researcher',
  'astro-executor': 'executor',
  'astro-verifier': 'verifier',
};

const userConfigFile = (home) => join(home, '.astro', 'config.json');
const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** The user's `opencode` block: `{ models: {tier: id}, roles: {role: id} }`, each `{}` when absent. */
export function readOpencodeConfig(home = homedir()) {
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(userConfigFile(home), 'utf8')); } catch { /* none / not JSON */ }
  const oc = isObject(cfg) && isObject(cfg.opencode) ? cfg.opencode : {};
  const strings = (o) => Object.fromEntries(Object.entries(isObject(o) ? o : {}).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v));
  return { models: strings(oc.models), roles: strings(oc.roles) };
}

export const TIERS = ['opus', 'sonnet', 'haiku'];
export const ROLES = Object.keys(profileModels('balanced'));

/**
 * Write one key of the user's `opencode` block — `models.<tier>` or `roles.<role>` —
 * or delete it (`id` null). Every other key in the shared file is preserved, the write is
 * atomic, and a file that is not a JSON object is refused rather than overwritten.
 */
export function setOpencodeModel({ home = homedir(), kind, key, id }) {
  if (kind === 'models' && !TIERS.includes(key)) return { ok: false, error: `unknown tier "${key}" — use one of: ${TIERS.join(', ')}` };
  if (kind === 'roles' && !ROLES.includes(key)) return { ok: false, error: `unknown role "${key}" — use one of: ${ROLES.join(', ')}` };
  if (id != null && !/^[^\s/]+\/\S+$/.test(id)) return { ok: false, error: `"${id}" is not an OpenCode model id — expected <provider>/<model>, as \`opencode models\` lists them` };
  const file = userConfigFile(home);
  let cfg = {};
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch {
      return { ok: false, error: `${file} is not valid JSON — fix it first; nothing was changed` };
    }
    if (!isObject(cfg)) return { ok: false, error: `${file} is not a JSON object — fix it first; nothing was changed` };
  }
  const oc = isObject(cfg.opencode) ? { ...cfg.opencode } : {};
  const block = isObject(oc[kind]) ? { ...oc[kind] } : {};
  if (id == null) delete block[key]; else block[key] = id;
  oc[kind] = block;
  cfg.opencode = oc;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  renameSync(tmp, file);
  return { ok: true, file };
}

/**
 * Every role's OpenCode model id (or null = the session's model), with where it came from.
 *
 * @param {{ root?: string|null, home?: string, fast?: boolean }} o
 *   root  a project root, so its own tiers count; null → user defaults only
 *   fast  the one-off fast preset's tiers instead of the configured ones (`--fast`)
 * @returns {{ models: Record<string,string|null>, sources: Record<string,string> }}
 */
export function resolveRoleModels({ root = null, home = homedir(), fast = false } = {}) {
  const tiers = fast ? profileModels('fast') : (withUserRoleDefaults(root ? loadConfig(root) : {}, home).cfg.models || {});
  const oc = readOpencodeConfig(home);
  const models = {};
  const sources = {};
  for (const role of ROLES) {
    const tier = tiers[role];
    if (oc.roles[role]) { models[role] = oc.roles[role]; sources[role] = 'opencode.roles'; }
    else if (tier && tier.includes('/')) { models[role] = null; sources[role] = `"${tier}" in the project config is ignored — a provider id is user-level only (ac opencode set ${role} ${tier})`; }
    else if (tier && tier !== 'inherit' && oc.models[tier]) { models[role] = oc.models[tier]; sources[role] = `${tier} → opencode.models`; }
    else { models[role] = null; sources[role] = !tier || tier === 'inherit' ? 'unset — session model' : `${tier} has no opencode.models entry — session model`; }
  }
  return { models, sources };
}

/**
 * The OpenCode model id stamped into one agent file, or undefined to inherit the
 * session's. User-level only — the files are global, not per project. Read at call
 * time (never module load) so a fake $HOME in tests is honoured.
 */
export function resolveAgentModel(name, home = homedir()) {
  const role = AGENT_ROLE[name];
  if (!role) return undefined;
  return resolveRoleModels({ home }).models[role] || undefined;
}

/**
 * An agent renders as one file: `description`, `mode: subagent` (so it is
 * dispatchable but not offered as a primary agent), `permission: edit: deny` for
 * the read-only roles (derived from the source `tools:` by Cursor's `isReadonly`,
 * never a name list — the verifier's independence depends on it), and `model`
 * only when the user's mapping resolves one. Claude's `tools`, `color` and
 * `experimental` keys are dropped; the body is the prompt, verbatim.
 */
export function renderAgent(name, source) {
  const { frontmatter, body } = parseFrontmatter(source);
  const fm = { description: frontmatter.description, mode: 'subagent' };
  if (isReadonly(frontmatter.tools)) fm.permission = { edit: 'deny' };
  const model = resolveAgentModel(name);
  if (model) fm.model = model;
  return [{ path: `${name}.md`, content: toMarkdown(fm, body) }];
}

export const opencodeHost = {
  id, label, placement, detect, baseConfigDir, configTargets,
  renderCommand, renderAgent,
  // Hooks are not wired on this host yet — see the note at the top of this file.
  registerHooks: () => false,
  unregisterHooks: () => {},
};
export default opencodeHost;
