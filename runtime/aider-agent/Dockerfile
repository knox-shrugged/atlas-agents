FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Install aider into an isolated venv so it doesn't conflict with system pip
RUN python3 -m venv /opt/aider-venv \
  && /opt/aider-venv/bin/pip install --no-cache-dir aider-chat
RUN ln -s /opt/aider-venv/bin/aider /usr/local/bin/aider

# Bake default config: OpenRouter + Qwen2.5-Coder-32B.
# AIDER_MODEL env var overrides model at runtime (e.g. moonshotai/kimi-k2).
RUN mkdir -p /root && printf '\
model: openrouter/qwen/qwen-2.5-coder-32b-instruct\n\
dark-mode: true\n\
git: true\n\
' > /root/.aider.conf.yml

# AGENT_KIND drives registration + tmux startup command
# AGENT_EXEC=bash: message-handler runs payloads as shell commands
ENV AGENT_KIND=aider-agent
ENV AGENT_EXEC=bash

COPY bin/aider-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/aider-agent
