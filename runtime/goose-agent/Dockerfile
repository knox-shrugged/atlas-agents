FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

# Install Goose binary (CONFIGURE=false skips interactive first-run setup)
RUN apt-get update && apt-get install -y --no-install-recommends bzip2 libgomp1 \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh \
    | CONFIGURE=false bash \
  && ln -sf /root/.local/bin/goose /usr/local/bin/goose

# Bake default config: OpenRouter + Gemini 2.5 Flash
# GOOSE_MODEL env var overrides model at runtime
RUN mkdir -p /root/.config/goose && printf '\
GOOSE_PROVIDER: openrouter\n\
GOOSE_MODEL: google/gemini-2.5-flash\n\
GOOSE_TELEMETRY_ENABLED: false\n\
' > /root/.config/goose/config.yaml

ENV AGENT_KIND=goose-agent
ENV AGENT_EXEC=bash

COPY bin/goose-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/goose-agent
