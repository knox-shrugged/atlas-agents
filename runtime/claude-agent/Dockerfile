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

RUN npm install -g @anthropic-ai/claude-code

# Pre-seed Claude Code config to skip first-run onboarding dialogs
RUN node -e " \
  const fs=require('fs'),os=require('os'); \
  const p=os.homedir()+'/.claude.json'; \
  const c={ \
    hasCompletedOnboarding:true, \
    lastOnboardingVersion:'2.1.150', \
    opusProMigrationComplete:true, \
    sonnet1m45MigrationComplete:true, \
    seenNotifications:{}, \
    migrationVersion:13, \
    projects:{'/data/workspace':{ \
      hasTrustDialogAccepted:true, \
      projectOnboardingSeenCount:1, \
      allowedTools:[], \
      mcpContextUris:[], \
      mcpServers:{}, \
      enabledMcpjsonServers:[], \
      disabledMcpjsonServers:[], \
      hasClaudeMdExternalIncludesApproved:false, \
      hasClaudeMdExternalIncludesWarningShown:false \
    }} \
  }; \
  fs.writeFileSync(p,JSON.stringify(c,null,2)); \
"

COPY bin/claude-agent /usr/local/bin/claude-agent
COPY bin/runtime-entrypoint /usr/local/bin/runtime-entrypoint
COPY bin/openrouter-proxy /usr/local/bin/openrouter-proxy
COPY bin/agent-register /usr/local/bin/agent-register
COPY bin/message-handler /usr/local/bin/message-handler
COPY bin/send-message /usr/local/bin/send-message
COPY bin/wait-for-reply /usr/local/bin/wait-for-reply
COPY bin/agent-lookup /usr/local/bin/agent-lookup

RUN chmod +x /usr/local/bin/claude-agent /usr/local/bin/runtime-entrypoint /usr/local/bin/agent-register /usr/local/bin/message-handler /usr/local/bin/send-message /usr/local/bin/wait-for-reply /usr/local/bin/agent-lookup

EXPOSE 7681

ENTRYPOINT ["/usr/local/bin/runtime-entrypoint"]
