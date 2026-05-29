FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN curl -fsSL https://bootstrap.pypa.io/get-pip.py | python3 - --break-system-packages \
  && python3 -m pip install --no-cache-dir --break-system-packages virtualenv \
  && python3 -m virtualenv /opt/hermes-venv \
  && /opt/hermes-venv/bin/pip install --no-cache-dir hermes-agent
RUN ln -s /opt/hermes-venv/bin/hermes /usr/local/bin/hermes

ENV AGENT_KIND=hermes-agent
ENV AGENT_EXEC=bash
ENV HERMES_ACCEPT_HOOKS=1

COPY bin/hermes-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/hermes-agent
