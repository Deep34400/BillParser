# Rebuild & Run

Docker Compose services: `db`, `api`, `web`.

> Important: after changing **frontend** code (`web/…`, e.g. `web/src/lib/summaryFromMarkdown.ts`)
> you MUST rebuild the **`web`** container — rebuilding only `api` leaves the browser on the old
> bundle and the UI will not match the API.

## Rebuild everything (api + web)

```bash
docker compose up -d --build api web
```

## Rebuild only the API (backend / parsing logic)

```bash
docker compose up -d --build api
```

## Rebuild only the Web (frontend / UI)

```bash
docker compose up -d --build web
```

## Full clean rebuild (no cache)

```bash
docker compose build --no-cache api web
docker compose up -d
```

## After rebuilding the web container

Hard-refresh the browser to drop the cached JS bundle:

- macOS: `Cmd + Shift + R`
- Windows/Linux: `Ctrl + Shift + R`

## Useful

```bash
# View running containers
docker compose ps

# Tail logs
docker compose logs -f api
docker compose logs -f web

# Stop everything
docker compose down
```
