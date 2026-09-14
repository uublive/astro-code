// Host adapter: OpenAI Codex CLI.
//
// Verified against codex-cli 0.154.0 on a real install, not against docs:
//
//   config dir     $CODEX_HOME, else ~/.codex
//   commands       ~/.codex/prompts/*.md   — markdown + frontmatter, top level
//                  only; invoked as `/prompts:<name>`
//   agents         ~/.codex/skills/<name>/  — a DIRECTORY, not a file:
//                    SKILL.md            markdown, `name` + `description`
//                                        frontmatter; the body is the prompt
//                    agents/openai.yaml  display metadata + invocation policy
//                  Invoked as `$<name>`. This was read off the six agents Codex
//                  ships in ~/.codex/skills/.system on a real 0.154.0 install.
//                  Prose docs describing ~/.codex/agents/*.toml did NOT match
//                  what the binary actually has on disk, so the shipped shape
//                  wins — an invented schema produces agents Codex silently
//                  ignores, which is the worst possible failure here.
//   instructions   AGENTS.md  (astro-code already ships one)
//   headless       codex exec, which carries every flag the workflow layer
//                  needs, several of them natively:
//                    -C/--cd <DIR>          working root
//                    --worktree             managed git worktree  (= isolation)
//                    --output-schema <FILE> JSON Schema for the final response
//                    -o <FILE>              write the final message out
//                    -m/--model, -s/--sandbox, --json
//
// Codex is in some ways a better fit than Claude Code for astro-code's
// execution model: `--worktree` and `--output-schema` are exactly the Workflow
// tool's `isolation: 'worktree'` and `schema:`, available from the CLI.
//
// NOT yet wired: hooks. Codex has a hook system (`hooks.json` + `[features]
// hooks = true`), but each hook must be registered in config.toml under
// `[hooks.state]` with a `trusted_hash` sha256 of its source. Writing a hook
// without that trust entry silently does nothing; forging one on the user's
// behalf would defeat a security control that exists on purpose. So the status
// line and session hooks stay Claude-only until that is designed deliberately.
//
// Stateless about the astro home for the same reason as the Claude adapter:
// see lib/hosts/index.mjs.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter, toMarkdown, toYaml } from './render.mjs';

export const id = 'codex';
export const label = 'Codex CLI';

/** Commands are markdown under prompts/; agents are skill directories under
 *  skills/. Copied, not symlinked — Codex scans only top-level prompt files,
 *  and a symlink farm is harder to reason about in a dir users hand-edit. */
export const placement = { commands: 'prompts', agents: 'skills', ext: '.md', mode: 'copy' };

export function baseConfigDir() {
  return process.env.CODEX_HOME || join(homedir(), '.codex');
}

/** Codex has a single config dir — no profile fan-out like jean-claude. */
export function configTargets() {
  return new Map([[baseConfigDir(), 'base']]);
}

export function detect() {
  return existsSync(baseConfigDir());
}

/**
 * A command becomes a Codex custom prompt.
 *
 * Both formats are markdown with `description` + `argument-hint` frontmatter
 * and `$ARGUMENTS`, so the body is untouched. Only `allowed-tools` is dropped:
 * Codex has no per-prompt tool allowlist, it gates tools through the sandbox
 * policy, and leaving an unrecognised key in would be noise at best.
 */
export function renderCommand(name, source) {
  const { frontmatter, body } = parseFrontmatter(source);
  const { 'allowed-tools': _dropped, ...keep } = frontmatter;
  return [{ path: `${name}.md`, content: toMarkdown(keep, body) }];
}

/**
 * An agent becomes a Codex skill directory.
 *
 * SKILL.md keeps the same `name` + `description` frontmatter astro-code already
 * authors, and the markdown body — the agent's system prompt — carries over
 * untouched. `tools` and `color` are dropped: Codex governs tool access through
 * its sandbox policy, not a per-agent list, and emitting Claude's capitalised
 * tool names into a file Codex does not read them from would assert a
 * capability contract that isn't enforced anywhere.
 *
 * `allow_implicit_invocation: false` mirrors the shipped review-agent: an
 * astro-code agent is dispatched deliberately by the loop, never picked up
 * opportunistically mid-conversation.
 */
export function renderAgent(name, source) {
  const { frontmatter, body } = parseFrontmatter(source);
  const agentName = frontmatter.name || name;
  const description = frontmatter.description || '';
  return [
    {
      path: `${agentName}/SKILL.md`,
      content: toMarkdown({ name: agentName, description }, body),
    },
    {
      path: `${agentName}/agents/openai.yaml`,
      content: toYaml({
        interface: {
          display_name: agentName,
          short_description: description.split(/(?<=\.)\s/)[0] || description,
          default_prompt: `Use $${agentName} for this task.`,
        },
        policy: { allow_implicit_invocation: false },
      }),
    },
  ];
}

/**
 * The one-shot headless invocation the workflow layer drives.
 *
 * Returns argv rather than spawning, so it is pure and testable and the caller
 * owns process handling, concurrency and abort.
 */
export function execCommand({ prompt, model, cwd, worktree, schemaFile, outFile, sandbox, json } = {}) {
  const args = ['exec'];
  if (model) args.push('--model', model);
  if (cwd) args.push('--cd', cwd);
  if (worktree) args.push('--worktree');
  if (schemaFile) args.push('--output-schema', schemaFile);
  if (outFile) args.push('--output-last-message', outFile);
  if (sandbox) args.push('--sandbox', sandbox);
  if (json) args.push('--json');
  args.push('--skip-git-repo-check');
  if (prompt) args.push(prompt);
  return { command: 'codex', args };
}

export const codexHost = {
  id, label, placement, detect, baseConfigDir, configTargets,
  renderCommand, renderAgent, execCommand,
  // Hooks are deliberately absent — see the note at the top of this file.
  registerHooks: () => false,
  unregisterHooks: () => {},
};
export default codexHost;
