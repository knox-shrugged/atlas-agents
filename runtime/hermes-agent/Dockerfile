FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/hermes-venv \
  && /opt/hermes-venv/bin/pip install --no-cache-dir hermes-agent
RUN ln -s /opt/hermes-venv/bin/hermes /usr/local/bin/hermes

ENV AGENT_KIND=hermes-agent
ENV AGENT_EXEC=bash
ENV HERMES_ACCEPT_HOOKS=1

COPY bin/hermes-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/hermes-agent
