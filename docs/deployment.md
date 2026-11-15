# Deployment and operations

Commands below are run from the repository root unless a block changes directory.
Release `v1.1.0` includes the interface, private proof storage and password reset
shown in the [README](../README.md). Choose the source Docker configuration or
the matching published API and web images.

## Local development

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 22.12+ or 24, and npm.
SQLite below is a disposable local-development option; deployment uses PostgreSQL.
Run the API and frontend in separate terminals.

```bash
cd api
uv sync --frozen --python 3.12
export DATABASE_URL=sqlite:///./development.db
export COOKIE_SECURE=false
uv run alembic upgrade head
uv run python -m app.bootstrap
uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

The bootstrap command prompts for your own household username/password. It refuses
to replace an existing account and creates exactly two profiles: Traveller A and
Traveller B. Profile names are editable and saved in the database.

```bash
cd web
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` to the loopback API; no CORS
exception is needed. `COOKIE_SECURE=false` is only for this loopback HTTP setup.
Never use this setting for the Tailscale HTTPS deployment.

## Checks

```bash
cd api
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
cd ../web
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests start disposable API/database and Vite processes, test desktop and
320px mobile flows, and stop them afterwards. They use ports 18080 and 15173.
To use an existing Chrome installation instead of downloading Chromium:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome npm run test:e2e
```

## Release containers

Release [`v1.1.0`](https://github.com/wrightwells/Schengen-Travel-Planner/releases/tag/v1.1.0)
is named **produstion v1.1**. GitHub Actions tests the app, compiles the frontend,
and publishes the API and web images to GitHub Container Registry. Images target
Linux amd64. The release includes the compiled frontend archive and Compose files.
The frontend archive needs the API proxy in `web/nginx.conf`; it is not a standalone app.

For a loopback deployment using the release images:

```bash
cp .env.example .env
chmod 600 .env
# Set a random URL-safe DB_PASSWORD in .env.
# For private packages, first authenticate with a token with read:packages access:
# export GHCR_TOKEN=...  # supply securely; do not commit it
# printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
docker compose -f compose.example.yaml config --quiet
docker compose -f compose.example.yaml pull
docker compose -f compose.example.yaml up -d
docker compose -f compose.example.yaml exec api /app/.venv/bin/python -m app.bootstrap
```

Open <http://localhost:9067>. The example binds to loopback and keeps its data in
`schengen-planner-example_pgdata`. It uses HTTP cookies for local access; set
`PLANNER_COOKIE_SECURE=true` and `PLANNER_TAILSCALE_HOST` when placing it behind
Tailscale HTTPS. `compose.yaml` provides the private Tailscale topology using the
same release images; `compose.local.yaml` continues to build from source.
Back up existing data before upgrading, run the migration service, then recreate
the API and web services. Keep the same Compose project name and volume when
upgrading an existing deployment. Do not use `down -v` to upgrade.

To publish another version, update the app versions and image tags in the release
Compose files, commit, and push a matching `vX.Y.Z` tag. The release workflow only
publishes the GitHub Release after checks and both container builds succeed.

## Container deployment foundation

### Local Docker on port 9067

The local configuration runs independently of Tailscale and persists PostgreSQL
data in the `schengen-planner-local_pgdata` Docker volume. It binds to loopback.
Set a random `DB_PASSWORD` in a protected `.env.local` file, then run:

```bash
docker compose --env-file .env.local -f compose.local.yaml up --build -d
docker compose --env-file .env.local -f compose.local.yaml exec api /app/.venv/bin/python -m app.bootstrap
```

Open <http://localhost:9067>. For an already-provisioned account, skip bootstrap.
The initial local deployment credentials are stored in the ignored, owner-only
`.local-credentials.local` file when provisioned by the development assistant.

#### Reset the household password

Run the reset command in the API container and enter your chosen password twice
at the hidden prompts (at least 12 characters):

```bash
docker compose --env-file .env.local -f compose.local.yaml exec api /app/.venv/bin/python -m app.reset_password
```

After adding this command to an existing source deployment, rebuild the API first:

```bash
docker compose --env-file .env.local -f compose.local.yaml up --build -d api
```

For scripts, `--password-stdin` reads the chosen password from the first line of
standard input. For example, in Bash:

```bash
read -r -s -p 'New household password: ' planner_password
printf '\n'
printf '%s\n' "$planner_password" | docker compose --env-file .env.local -f compose.local.yaml exec -T api /app/.venv/bin/python -m app.reset_password --password-stdin
unset planner_password
```

The reset keeps the username and travel data, clears any login lockout, and signs
out existing sessions. It requires an existing household account; use
`app.bootstrap` for initial setup. It does not update `.local-credentials.local`;
update your saved credentials separately. For other Compose deployments, substitute
their Compose file and environment options and use an API image containing this
command. For local development without Docker, run `uv run python -m app.reset_password`
from `api` with `DATABASE_URL` set.

To stop without deleting data:

```bash
docker compose --env-file .env.local -f compose.local.yaml down
```

#### Private proof documents for travel history

In **History**, save a journey, then select **Proof documents** on its card (or open
the journey's details). Upload a PDF, JPEG or PNG document, download an existing
proof, or remove an incorrect attachment. Each file must be non-empty and no larger
than 10 MiB; each history entry can hold up to 20 documents. Filenames and file
signatures must agree. Plans must be confirmed as history before attaching proof.
Editing a history entry keeps its proofs; deleting the entry removes its documents.
Uploading proof does not change travel dates, day counts or history completeness.

Document bytes **and metadata** live in file storage, not PostgreSQL. The API's
`PROOF_STORAGE_PATH` defaults to `./proofs` for development. Docker sets it to
`/app/proofs` and persists it in the `proofdata` named volume (for the local project,
`schengen-planner-local_proofdata`). Rebuild both source images to install this
feature in the local deployment:

```bash
docker compose --env-file .env.local -f compose.local.yaml up --build -d api web
```

The volume is mounted only in the API container, outside the web server's document
root. No static route, public file URL or directory listing exposes the documents.
Every list/download request checks the household session and that the history
entry still exists. Upload/removal also require the existing CSRF protection.
Downloads are attachments with `application/octet-stream`, `nosniff`, a restrictive
content security policy and `Cache-Control: no-store`; the app never renders uploaded
documents inline. The web proxy streams these requests without writing proof bodies
to its upload/download cache.

Storage directories use mode `0700` and files use `0600`, owned by the API process
(UID/GID `10001` in Docker). User filenames never determine filesystem paths:
generated UUIDs identify entries and files, metadata stays with each document, and
writes publish atomically after flushing to disk. Filesystem access rejects symlinks,
hard-linked document files and unsafe ownership or permissions. The API container
uses a read-only root filesystem, drops Linux capabilities and disallows privilege
escalation. Only its private proof volume is writable. A bind mount or restored
volume must retain this ownership and these modes; unsafe storage fails closed with
a generic error rather than exposing paths. Host administrators can still read the
volume; filesystem permissions do not encrypt it or replace host access controls.
File checks restrict supported formats; they do not provide malware scanning.

Database-only backups do not include proof documents. Back up the volume as well,
keeping the archive private, for example while the local API is running:

```bash
mkdir -p backups
chmod 700 backups
(umask 077; docker compose --env-file .env.local -f compose.local.yaml exec -T api tar -C /app/proofs -czf - . > backups/local-proofs.tar.gz)
```

For a consistent database-and-files snapshot, pause household changes during both
backups. Restore the database and proof volume together, preserving ownership and
permissions. Do not use `down -v` when retaining documents. Release-image deployments must use the matching `v1.1.0` API and web images
for proof support; earlier `v1.0.0` images do not contain it.

Before upgrading, back up the database. For example, with a private `backups/`
directory (ignored by Git):

```bash
mkdir -p backups
chmod 700 backups
docker compose --env-file .env.local -f compose.local.yaml exec -T db pg_dump -U planner -d planner -Fc > backups/local.dump
chmod 600 backups/local.dump
docker compose --env-file .env.local -f compose.local.yaml up --build -d
```

The one-shot migration service upgrades existing data before starting the API.
Never use `down -v` when you intend to preserve household data.

For mobile testing of the existing local database through the host's Tailscale
connection, set `PLANNER_TAILSCALE_HOST` to the host's exact `*.ts.net` name and
`PLANNER_COOKIE_SECURE=true` in `.env.local`, then recreate the local API service.
Run `tailscale serve --bg --https=8443 http://127.0.0.1:9067` and open
`https://<PLANNER_TAILSCALE_HOST>:8443/` from a device connected to the same tailnet.
This preserves existing Serve routes on port 443. Disable this route with
`tailscale serve --https=8443 off`. Secure cookies require HTTPS for authenticated
remote access; to return to plain local HTTP testing, restore
`PLANNER_COOKIE_SECURE=false` and recreate the API service.

### Store proofs in a host directory

The default `proofdata` named volume is persistent storage on the Docker host;
it is separate from the container's writable layer. For a directly managed host
folder, combine any base Compose file with `compose.proofs-host.yaml`. Compose
merges volume mounts by container target, so the override replaces the mount at
`/app/proofs` while preserving PostgreSQL's volume and all API security settings.
The web container receives no proof mount.

For a new installation on a Linux host:

```bash
sudo install -d -o 10001 -g 10001 -m 0700 /srv/schengen-planner/proofs
```

Set the following in `.env` (or `.env.local` for the local source configuration):

```dotenv
PROOF_HOST_PATH=/srv/schengen-planner/proofs
```

Use an absolute path. The override sets `create_host_path: false` so a missing
folder causes startup to fail rather than creating a folder with unsuitable
ownership. The API still requires directories owned by UID `10001` with `0700`
permissions and document files with `0600` permissions. Use a filesystem that
supports these Unix ownership and permission checks. Do not use symlinks or a
web server's public directory as the storage location.

For the Tailscale Compose configuration:

```bash
docker compose -f compose.yaml -f compose.proofs-host.yaml config --quiet
docker compose -f compose.yaml -f compose.proofs-host.yaml up -d
```

The pinned `v1.1.0` API and web images include the proof feature. For a source build:

```bash
docker compose --env-file .env.local -f compose.local.yaml -f compose.proofs-host.yaml config --quiet
docker compose --env-file .env.local -f compose.local.yaml -f compose.proofs-host.yaml up --build -d
```

Always include the same override on future starts, restarts through Compose,
upgrades and container-based backup commands. Omitting it can remount the old named
volume. `PROOF_STORAGE_PATH` stays `/app/proofs` inside the API; `PROOF_HOST_PATH`
selects the corresponding directory on the host.

#### Move existing uploads before switching

Changing the mount does not copy existing documents. For an existing local source
installation, first prepare an **empty** destination as above, back up PostgreSQL
and the original proof volume, then stop the web and API services to prevent
changes during the copy. Keep the old volume until you have verified downloads.

The following Bash commands copy the complete storage layout, including the
file-based metadata, preserving numeric ownership and permissions. These examples
assume the default named volume is still selected before the copy:

```bash
docker compose --env-file .env.local -f compose.local.yaml stop web api
set -o pipefail
docker compose --env-file .env.local -f compose.local.yaml run --rm --no-deps -T --entrypoint tar api -C /app/proofs -cpf - . | sudo tar --numeric-owner -xpf - -C /srv/schengen-planner/proofs
```

Only continue after the copy succeeds. If it fails, restart the original
installation using its base Compose file and correct the copy before switching.
After setting `PROOF_HOST_PATH` in `.env.local`, recreate the services with the
override and verify existing proofs in the signed-in app:

```bash
docker compose --env-file .env.local -f compose.local.yaml -f compose.proofs-host.yaml up -d --no-build
```

For another base Compose configuration, substitute its filename and environment
options consistently. Docker must map the API's UID/GID `10001` to the owner of
the host folder; adjust host ownership to the mapped IDs if using user namespaces.
Back up the chosen host directory together with PostgreSQL. Container-based tar
backups still work at `/app/proofs` when the override is included. Host folder
contents survive container/volume removal, so deletion and retention of those files
must be managed on the host. Do not delete the old volume until the migration and
backups have been checked.

### Private Tailscale deployment

This topology is under development and is not yet a release deployment. Do not
load real travel data until backups/restore and the remaining workflows are ready.

1. Copy `.env.example` to `.env`, restrict it with `chmod 600 .env`, and set a
   random **URL-safe** `DB_PASSWORD` (e.g. `openssl rand -hex 32`).
2. Set the exact tailnet hostname in `ALLOWED_HOSTS`. Configure the
   `tag:schengen-planner` tag, household-only grants and tailnet HTTPS first.
3. Supply a Tailscale enrolment key in `TS_AUTHKEY`. Persisted node state allows
   removing the key after successful enrolment.
4. Authenticate to GHCR if needed (as above), pull and start the release containers,
   then provision the account interactively:

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose run --rm api /app/.venv/bin/python -m app.bootstrap
```

Open the node's `https://schengen-planner.<your-tailnet>.ts.net` address from an
authorised household device. There are **no published host ports**. Tailscale Serve
terminates HTTPS and forwards to the web container in its shared network namespace.
Only Tailscale has an egress network; API and PostgreSQL use the internal backend.
Funnel is disabled. This uses the supported
[Tailscale Docker Serve configuration](https://tailscale.com/docs/features/containers/docker).

Migrations run in a separate one-shot service before the API starts. The API never
creates its own schema at startup. On upgrade, back up the database and run
`docker compose run --rm migrate` before recreating the API. Image digest pinning,
end-to-end tailnet checks and documented backup/restore are release gates still
to complete; see the development status document.
