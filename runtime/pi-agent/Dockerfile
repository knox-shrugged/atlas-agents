FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# Install pi-mcp-tools extension for MCP server support
RUN PI_TELEMETRY=0 PI_SKIP_VERSION_CHECK=1 pi install npm:@zhafron/pi-mcp-tools

# Bake pi settings with OpenRouter as the provider
RUN mkdir -p /root/.pi/agent && node -e " \
  const fs=require('fs'); \
  const c={ \
    provider:'openrouter', \
    model:'google/gemini-2.5-flash' \
  }; \
  fs.writeFileSync('/root/.pi/agent/settings.json',JSON.stringify(c,null,2)); \
"

# AGENT_KIND drives registration + the tmux startup command
# AGENT_EXEC=bash tells message-handler to run payloads as shell commands
ENV AGENT_KIND=pi-agent
ENV AGENT_EXEC=bash
ENV PI_TELEMETRY=0
ENV PI_SKIP_VERSION_CHECK=1

COPY bin/pi-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/pi-agent
