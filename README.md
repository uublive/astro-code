# astro-code

```text
        PZÇP
       ääZPäP       4str0|ize · astro-code
      àääPPääà      lean, multi-developer planning for Claude Code
      PäP  PäP
     Pääà  àääP
    àääP ºº Pää¥
    Pää –²²– äää
        °²²°
```

Planning and execution for coding agents. It runs a
`discuss → plan → execute → verify → accept` loop over milestones and phases, kept as
plain files in your repo — so an agent can't wander off, and nothing is ever marked done
without a human saying so.

Works with **Claude Code** and **Codex CLI** from one install. Requires **Node ≥ 22**.

📘 **[Open the visual guide →](https://claude.ai/code/artifact/80291435-e40c-4029-a933-8fbdf2d69539)**
The fastest way in if you've never seen astro-code. For the full reference, read
[`MANUAL.md`](./MANUAL.md).

## Install

```bash
git clone git@github.com:uublive/astro-code.git
cd astro-code
npm install -g .     # puts `ac` on your PATH
ac install           # publishes commands to every agent harness it finds
```

Idempotent. `ac uninstall` reverses it, `/astro-update` keeps it current.

One-time Claude Code permission so the workflows can run from `~/.astro/code`: add the
output of `ac path` to `permissions.additionalDirectories` — see
[`MANUAL.md`](./MANUAL.md#letting-claude-code-run-the-shipped-workflows).

> **Windows:** use `astrocode install` — PowerShell's built-in `ac` alias shadows the CLI.
> See [`MANUAL.md`](./MANUAL.md#windows--powershell).

## Your first phase

Work inside the repo you're building. Give it an `origin` remote first — phase numbers are
claimed from a shared registry so two people can never grab the same one.

```bash
ac registry init          # once per project
```

Then, in Claude Code:

```
/astro-new-project        set up .astrocode/  (or /astro-adopt on existing code)
/astro-phase "Billing"    add a piece of work — claims its number
/astro-discuss 1          it asks, you answer → CONTEXT.md
/astro-plan 1             parallel research → PLAN.md
/astro-execute 1          builds it in parallel, then checks itself
/astro-accept 1           your sign-off — this is what closes it
```

Lost at any point? **`/astro-status`** tells you where you are and what to run next.

On Codex, type `$astro-plan 1` instead — it has no slash commands. Everything else is
identical.

## The five steps

| Step | What it produces |
|---|---|
| `/astro-discuss <n>` | `CONTEXT.md` — decisions settled *before* planning |
| `/astro-plan <n>` | `CRITERIA.md` (the bar, written first), then `PLAN.md` |
| `/astro-execute <n>` | the actual change — parallel tasks, one commit each |
| `/astro-verify <n>` | an adversarial, plan-blind check that the **goal** was met |
| `/astro-accept <n>` | human sign-off — the only thing that marks a phase complete |

`verified` means the machine checked it. `complete` means a human accepted it. They are
different claims and the tool refuses to conflate them.

Other ways in: **`/astro-autonomous <n>`** runs steps 1–4 unattended then stops,
**`/astro-fast "<prompt>"`** takes a long off-the-cuff request straight to execution, and
**`/astro-fix "<bug>"`** fixes a bug without burning a phase number.

## Three things not to do

- **Don't hand-edit `.astrocode/roadmap.json`, `state.json`, or the registry.** They're
  bookkeeping for the shared numbering; editing them corrupts it silently.
- **Don't write in `ROADMAP.md`** — it's generated. Use `ac phase note <n> "<text>"`.
- **Don't file a bug as a phase.** That's what `/astro-fix` is for.

## Found a bug?

Please open one — [**new issue**](https://github.com/uublive/astro-code/issues/new).
What helps most:

- the version — `cat ~/.astro/code/version`
- what you ran, and what it printed — **paste the console output verbatim**
- what you expected instead
- whether your project has an `origin` remote and a registry (`ac registry show`)

Small, reproducible reports are genuinely more useful than polished ones. If something is
merely confusing rather than broken, that's worth an issue too — confusing is a bug in the
docs.

## Docs

| | |
|---|---|
| [Visual guide](https://claude.ai/code/artifact/80291435-e40c-4029-a933-8fbdf2d69539) | interactive walkthrough — start here |
| [`MANUAL.md`](./MANUAL.md) | full reference: every command, every concept |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | why it's built this way |
| `/astro-help` · `ac help` | the same, in your terminal |

## Development

```bash
npm test     # engine units + a real bare-remote registry/canon integration test
```
