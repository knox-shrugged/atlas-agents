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
    jq \
    tmux \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH:-amd64}" in \
    amd64) ttyd_arch="x86_64" ;; \
    arm64) ttyd_arch="aarch64" ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${ttyd_arch}" -o /usr/local/bin/ttyd; \
  chmod +x /usr/local/bin/ttyd

COPY bin/atlas-agent /usr/local/bin/atlas-agent
COPY bin/agent-register /usr/local/bin/agent-register
COPY bin/message-handler /usr/local/bin/message-handler
COPY bin/runtime-entrypoint /usr/local/bin/runtime-entrypoint
COPY bin/send-message /usr/local/bin/send-message
COPY bin/wait-for-reply /usr/local/bin/wait-for-reply
COPY bin/agent-lookup /usr/local/bin/agent-lookup

RUN chmod +x /usr/local/bin/atlas-agent /usr/local/bin/agent-register /usr/local/bin/message-handler /usr/local/bin/runtime-entrypoint /usr/local/bin/send-message /usr/local/bin/wait-for-reply /usr/local/bin/agent-lookup

EXPOSE 7681

ENTRYPOINT ["/usr/local/bin/runtime-entrypoint"]
