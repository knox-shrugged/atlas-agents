FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

# bubblewrap: codex sandbox prerequisite
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex

# Pre-install Composio MCP so npx doesn't download it at startup (avoids MCP handshake timeout)
RUN npm install -g @composio/mcp

# Bake codex config: OpenRouter as provider via the Responses API.
# wire_api = "responses" is required as of codex 0.134+ ("chat" was removed).
# OpenRouter supports POST /v1/responses, so this works without a proxy.
# model_context_window suppresses the "model metadata not found" warning for openai/o4-mini via OpenRouter.
RUN mkdir -p /root/.codex && printf '\
model = "openai/o4-mini"\n\
model_provider = "openrouter"\n\
model_context_window = 200000\n\
\n\
[model_providers.openrouter]\n\
name = "OpenRouter"\n\
base_url = "https://openrouter.ai/api/v1"\n\
env_key = "OPENAI_API_KEY"\n\
wire_api = "responses"\n\
' > /root/.codex/config.toml

# AGENT_KIND drives registration + tmux startup command
# AGENT_EXEC=bash tells message-handler to run payloads as shell commands
ENV AGENT_KIND=codex-agent
ENV AGENT_EXEC=bash

COPY bin/codex-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/codex-agent
