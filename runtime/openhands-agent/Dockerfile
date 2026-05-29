FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

# Install uv, then use it to install openhands with Python 3.12
RUN curl -fsSL https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"
RUN uv tool install openhands --python 3.12
ENV PATH="/root/.local/share/uv/tools/openhands/bin:$PATH"

ENV AGENT_KIND=openhands-agent
ENV AGENT_EXEC=bash

COPY bin/openhands-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/openhands-agent
