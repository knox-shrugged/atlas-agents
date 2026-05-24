# Fly Machines run amd64 — always build with --platform linux/amd64
FROM --platform=linux/amd64 debian:bookworm-slim

ARG TARGETARCH
ARG TTYD_VERSION=1.7.7

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    tmux \
    nodejs \
    npm \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH:-amd64}" in \
    amd64) ttyd_arch="x86_64" ;; \
    arm64) ttyd_arch="aarch64" ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${ttyd_arch}" -o /usr/local/bin/ttyd; \
  chmod +x /usr/local/bin/ttyd

RUN npm install -g opencode-ai

COPY bin/opencode-agent /usr/local/bin/opencode-agent
COPY bin/runtime-entrypoint /usr/local/bin/runtime-entrypoint

RUN chmod +x /usr/local/bin/opencode-agent /usr/local/bin/runtime-entrypoint

EXPOSE 7681

ENTRYPOINT ["/usr/local/bin/runtime-entrypoint"]
