---
description: Publish this kit to a hosted Astro instance — build the upload package (src/ + kit.json inside the zip) and POST it to the instance's kit registry
argument-hint: [astro instance URL]
allowed-tools: Bash, Read, AskUserQuestion
---

You are publishing **this kit** to a running Astro instance's hosted kit registry.
The instance takes ONE file — the kit zip **with `kit.json` (manifest v4) at its
root** — via `POST /api/kit-packages` (admin only). That differs from
`dist/kit.zip` (build_kit.sh ships only `src/`); the publisher builds the upload
package with the manifest inside. `download_url` and `sha256` are assigned by the
server. The catalog and hosted registry update immediately on success.

The publisher is `$(ac path templates)/kit/tools/publish_kit.py` — stdlib-only
(no deps), invoked from the installed astro-code templates so it works even for
kits scaffolded before this command existed. New kits also ship their own copy at
`tools/publish_kit.py`. Prefer the kit's local copy if present, else the templates one.

1. **Preflight.** Confirm the cwd is a kit repo: `src/CLAUDE.md` exists and at
   least one of `registry-entry.json` / `kit.json` is present. If not, tell the
   user to run this from the kit's root and stop. Show the kit id + version
   (`registry-entry.json`'s `id`, else `kit.json`'s `name`).

2. **Test offline first.** Run `python3 tools/kit_test.py` (or
   `$(ac path templates)/kit/tools/kit_test.py` for kits scaffolded before it
   existed). It is offline and takes about a second. If it fails, surface the
   failures and stop — publishing is the slowest possible way to discover that a
   recipe phase produces none of the declared artifacts. If the kit predates the
   checker and it cannot run, say so and continue rather than blocking.

3. **Build fresh (recommended).** If `./tools/build_kit.sh` exists, run it so
   `kit.json` / `registry-entry.json` carry the current version and sha, and the
   manifest passes local v4 validation. If it fails, surface the errors and stop —
   don't publish a kit that doesn't build.

4. **Dry run first.** Run the publisher with `--dry-run` to build the package and
   surface any manifest problems before touching the network:
   `python3 "$(ac path templates)/kit/tools/publish_kit.py" --kit-root . --dry-run`.
   It prints the kit id, version, file count, size, and sha256, and **warns** if
   the manifest still has `{{PLACEHOLDER}}` values or missing `tags`/`description`.
   If it warns about placeholders, tell the user the kit isn't finished and ask
   whether to continue anyway.

5. **Collect connection details.** You need the instance **base URL**, the **admin
   email**, and the **admin password** (upload requires the admin role). Take the
   base URL from `$ARGUMENTS` if given. For the rest, prefer environment variables
   so the password never lands in argv or the transcript — the publisher reads
   `$ASTRO_BASE_URL`, `$ASTRO_ADMIN_EMAIL`, `$ASTRO_ADMIN_PASSWORD` as fallbacks.
   If they aren't set, ask the user for them; when you run the publisher, pass the
   password by prefixing the single command with `ASTRO_ADMIN_PASSWORD='…'` rather
   than as a `--password` flag, so it isn't a separate argv entry.

6. **Publish.** Run the publisher once:
   ```
   ASTRO_ADMIN_PASSWORD='<password>' python3 "$(ac path templates)/kit/tools/publish_kit.py" \
     --kit-root . --base <URL> --email <admin-email> [--note "<what changed>"]
   ```
   Offer to include a short `--note` describing this version (stored on the upload).

7. **Interpret the result** (the publisher's exit code tells you which):
   - **0 / published** — report id, version, server sha256, size, and uploader.
     The kit is live immediately (`GET /api/kits` now lists it).
   - **5 / version already exists (HTTP 409)** — the instance already has this
     id+version. The registry never overwrites a version. Offer two paths and let
     the user pick: **(a)** bump `version` in `registry-entry.json`/`kit.json`
     (re-run `build_kit.sh`) and publish again — the clean, auditable choice; or
     **(b)** re-run the publisher with `--replace`, which **deletes** the existing
     version on the instance and re-uploads. Only use `--replace` on the user's
     explicit go-ahead — it is destructive to that hosted version.
   - **4 / rejected (422 manifest, 413 too big, 403 not admin, 400 bad zip)** —
     relay the specific message. 422 means the in-zip `kit.json` failed v4
     validation (the publisher echoes the dropped-field pointers); 403 means the
     account isn't an admin.
   - **3 / auth failed** — wrong credentials, disabled account, or auth not
     configured on the instance.
   - **6 / instance error** — unreachable host, or the hosted kit registry isn't
     enabled on that deployment (503).

Report exactly what happened — the id/version published and the instance it went
to — and mention any host command you ran. Never invent success: if the publisher
exits non-zero, say so and show its message.
