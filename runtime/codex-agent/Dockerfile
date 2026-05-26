FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN npm install -g @openai/codex

# Bake codex config: OpenRouter as provider via the Responses API.
# wire_api = "responses" is required as of codex 0.134+ ("chat" was removed).
# OpenRouter supports POST /v1/responses, so this works without a proxy.
RUN mkdir -p /root/.codex && printf '\
model = "openai/o4-mini"\n\
model_provider = "openrouter"\n\
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
