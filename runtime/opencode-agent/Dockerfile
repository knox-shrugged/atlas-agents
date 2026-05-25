FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN npm install -g opencode-ai

# Bake opencode config with the Atlas MCP server
RUN mkdir -p /root/.config/opencode && node -e " \
  const fs=require('fs'); \
  const c={ \
    '\$schema':'https://opencode.ai/config.json', \
    model:'openrouter/google/gemini-2.5-flash', \
    mcp:{ \
      atlas:{ \
        type:'local', \
        command:['node','/usr/local/lib/atlas-mcp/index.js'] \
      } \
    } \
  }; \
  fs.writeFileSync('/root/.config/opencode/config.json',JSON.stringify(c,null,2)); \
"

# AGENT_KIND drives registration + the tmux startup command
# AGENT_EXEC=bash tells message-handler to run payloads as shell commands
ENV AGENT_KIND=opencode-agent
ENV AGENT_EXEC=bash

COPY bin/opencode-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/opencode-agent
