# Publish The Runtime Image

The Fly Machines API needs a container image reachable from Fly. The local backend reads that image from `FLY_RUNTIME_IMAGE`.

## Option A: Fly Registry

This requires a Fly registry login. If `flyctl` is installed, the usual flow is:

```bash
fly auth docker
docker build --platform linux/amd64 -t registry.fly.io/<runtime-image-app>:latest runtime/shell-agent
docker push registry.fly.io/<runtime-image-app>:latest
```

Then set:

```bash
FLY_RUNTIME_IMAGE=registry.fly.io/<runtime-image-app>:latest
```

## Option B: Any Registry

Push the image to Docker Hub, GitHub Container Registry, or another registry Fly can pull from:

```bash
docker build --platform linux/amd64 -t <registry>/<namespace>/atlas-shell-agent:latest runtime/shell-agent
docker push <registry>/<namespace>/atlas-shell-agent:latest
```

Then set:

```bash
FLY_RUNTIME_IMAGE=<registry>/<namespace>/atlas-shell-agent:latest
```

