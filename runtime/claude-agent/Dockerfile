FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN npm install -g @anthropic-ai/claude-code

# Bake Claude config: skip onboarding + wire up the Atlas MCP server
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
    mcpServers:{ \
      atlas:{ \
        command:'node', \
        args:['/usr/local/lib/atlas-mcp/index.js'], \
        type:'stdio' \
      } \
    }, \
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

# AGENT_KIND drives registration + the tmux startup command
# AGENT_EXEC tells message-handler to run payloads via claude -p
ENV AGENT_KIND=claude-agent
ENV AGENT_EXEC=claude
# OpenRouter proxy runs on 8082; claude-agent start sets ANTHROPIC_BASE_URL
ENV ANTHROPIC_BASE_URL=http://127.0.0.1:8082

COPY bin/claude-agent bin/openrouter-proxy /usr/local/bin/
RUN chmod +x /usr/local/bin/claude-agent /usr/local/bin/openrouter-proxy
