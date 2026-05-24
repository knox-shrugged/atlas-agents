# AtlasLives Spike

Minimal Vite + Fastify spike for proving persistent browser terminals on Fly Machines.

## Current Flow

1. Create a workspace in the browser UI.
2. Create a `shell-agent`.
3. Backend provisions a Fly app, shared IPv4, IPv6, volume, and Machine.
4. Runtime starts `tmux` and exposes it through `ttyd`.
5. Browser opens the terminal at `https://<agent-app>.fly.dev`.
6. UI can suspend and resume the Machine.

The first agent is intentionally not an LLM agent. It is a deterministic shell runtime for proving terminal and lifecycle continuity.

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env`:

```bash
FLY_API_TOKEN=FlyV1 ...
FLY_ORG_SLUG=personal
ATLAS_DEFAULT_REGION=den
FLY_RUNTIME_IMAGE=registry.fly.io/YOUR_RUNTIME_APP:latest
PORT=4000
```

Run the app:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

## Runtime Image

The runtime image lives in:

```text
runtime/shell-agent
```

Build locally:

```bash
docker build -t atlaslives-shell-agent:local runtime/shell-agent
```

Publish it to a registry Fly can pull from, then set `FLY_RUNTIME_IMAGE`. See:

```text
docs/runtime-publish.md
```

## Demo Commands

In the opened browser terminal:

```bash
echo "hello from atlas" > /data/workspace/proof.txt
export ATLAS_PROOF=still-here
```

After suspend/resume:

```bash
cat /data/workspace/proof.txt
echo "$ATLAS_PROOF"
tmux ls
```

`proof.txt` surviving proves volume persistence. `$ATLAS_PROOF` surviving proves true process/session continuity from Fly suspend/resume.

