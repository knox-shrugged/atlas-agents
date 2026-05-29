FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

# Download agy binary via manifest (skip `agy install` to avoid AES-NI crash during build)
RUN MANIFEST=$(curl -fsSL https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/linux_amd64.json) \
  && URL=$(echo "$MANIFEST" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])") \
  && curl -fsSL "$URL" -o /tmp/agy.tar.gz \
  && tar -xzf /tmp/agy.tar.gz -C /usr/local/bin/ antigravity \
  && ln -s /usr/local/bin/antigravity /usr/local/bin/agy \
  && chmod +x /usr/local/bin/antigravity \
  && rm /tmp/agy.tar.gz

# Pre-create the token dir so agy detects container mode immediately
RUN mkdir -p /root/.gemini/antigravity-cli

ENV AGENT_KIND=antigravity-agent
ENV AGENT_EXEC=bash

COPY bin/antigravity-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/antigravity-agent
