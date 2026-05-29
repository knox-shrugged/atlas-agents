FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN npm install -g @github/copilot

ENV AGENT_KIND=copilot-agent
ENV AGENT_EXEC=bash

COPY bin/copilot-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/copilot-agent
