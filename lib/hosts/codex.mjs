// Host adapter: OpenAI Codex CLI.
//
// Verified against codex-cli 0.154.0 on a real install, not against docs:
//
//   config dir     $CODEX_HOME, else ~/.codex
//   commands       ~/.codex/skills/<name>/  — same skill shape as agents.
//                  NOT ~/.codex/prompts/*.md: the published docs describe that
//                  directory with a `/prompts:<name>` invocation, and 0.154.0
//                  does not read it. Verified three ways — Codex had never
//                  created the dir, the binary's only `prompts` strings are MCP
//                  protocol (prompts/list, prompts/get), and typing `/ast` in
//                  the TUI after installing 22 files there returns "no matches".
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

/** Commands AND agents are skill directories under skills/. Copied, not
 *  symlinked — a symlink farm is harder to reason about in a dir users also
 *  hand-edit, and Codex's own shipped skills are plain directories. */
export const placement = { commands: 'skills', agents: 'skills', ext: '.md', mode: 'copy' };

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
 * Build the skill-directory pair Codex actually reads.
 *
 * Shape taken from the six skills Codex ships in ~/.codex/skills/.system:
 * SKILL.md carries `name` + `description` frontmatter with the body as the
 * prompt, and agents/openai.yaml carries display metadata and invocation
 * policy. Invoked as `$<name>`.
 *
 * `allow_implicit_invocation: false` on everything astro-code publishes. These
 * are deliberate steps in a loop the user drives — 28 skills that the model
 * could fire opportunistically mid-conversation would be actively harmful, and
 * Codex's own review-agent sets the same flag for the same reason.
 */
function skillFiles(name, source, { argumentHint } = {}) {
  const { frontmatter, body } = parseFrontmatter(source);
  const skillName = frontmatter.name || name;
  const description = frontmatter.description || '';
  const hint = argumentHint || frontmatter['argument-hint'];
  return [
    {
      path: `${skillName}/SKILL.md`,
      content: toMarkdown({ name: skillName, description }, body),
    },
    {
      path: `${skillName}/agents/openai.yaml`,
      content: toYaml({
        interface: {
          display_name: skillName,
          short_description: description.split(/(?<=\.)\s/)[0] || description,
          default_prompt: hint
            ? `Use $${skillName} ${hint}`
            : `Use $${skillName} for this task.`,
        },
        policy: { allow_implicit_invocation: false },
      }),
    },
  ];
}

/**
 * A command becomes a skill.
 *
 * `allowed-tools` is dropped — Codex gates tools through its sandbox policy,
 * not a per-unit list. `argument-hint` is folded into the skill's default
 * prompt, which is the only place Codex surfaces "what does this take".
 */
export function renderCommand(name, source) {
  return skillFiles(name, source);
}

/**
 * An agent becomes a skill too — same shape, same directory. Commands and
 * agents never collide because astro-code's names differ (astro-plan vs
 * astro-planner), and a clash would be a naming bug worth failing on anyway.
 */
export function renderAgent(name, source) {
  return skillFiles(name, source);
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

/** Codex enforces both natively, so the runner delegates rather than emulating. */
export const capabilities = { worktree: true, outputSchema: true };

export const codexHost = {
  id, label, placement, detect, baseConfigDir, configTargets,
  renderCommand, renderAgent, execCommand, capabilities,
  // Hooks are deliberately absent — see the note at the top of this file.
  registerHooks: () => false,
  unregisterHooks: () => {},
};
export default codexHost;
