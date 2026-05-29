# Fly Machines run amd64 — always build with --platform linux/amd64
FROM --platform=linux/amd64 debian:bookworm-slim

ARG TARGETARCH
ARG TTYD_VERSION=1.7.7

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    python3-minimal \
    tmux \
    unzip \
    woff2 \
  && rm -rf /var/lib/apt/lists/*

# Fonts for ttyd terminal:
#   JetBrains Mono NF — primary font with Nerd Font glyphs for powerline/icons
#   DejaVu Sans Mono  — fallback with comprehensive Unicode (Misc Symbols, Dingbats, etc.)
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-dejavu-core python3-fonttools \
  && rm -rf /var/lib/apt/lists/*

# Build AtlasNF: JetBrains Mono NF merged with DejaVu glyphs for full Unicode coverage.
# Canvas font fallback ignores @font-face unicode-range, so a merged single font is required.
RUN mkdir -p /usr/local/share/fonts \
  && curl -fsSL "https://github.com/ryanoasis/nerd-fonts/releases/download/v3.3.0/JetBrainsMono.zip" -o /tmp/JetBrainsMono.zip \
  && unzip -j /tmp/JetBrainsMono.zip "JetBrainsMonoNLNerdFontMono-Regular.ttf" -d /tmp/ \
  && python3 - /tmp/JetBrainsMonoNLNerdFontMono-Regular.ttf /usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf /tmp/AtlasNF.ttf <<'PYEOF'
import sys
from fontTools.ttLib import TTFont

base_path, fill_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
base = TTFont(base_path)
fill = TTFont(fill_path)

# Get codepoints already in JetBrains Mono NF
base_cmap = base.getBestCmap()
fill_cmap = fill.getBestCmap()
base_cmap_table = None
for table in base['cmap'].tables:
    if table.format == 4:
        base_cmap_table = table
        break

# Find glyphs in DejaVu not in JetBrains Mono (missing/replacement glyphs)
to_add = {}
for cp, name in fill_cmap.items():
    if cp not in base_cmap:
        to_add[cp] = name

# Add missing codepoint mappings to base font's cmap
if base_cmap_table and to_add:
    for cp, name in to_add.items():
        base_cmap_table.cmap[cp] = name

    # Also copy the glyph outlines from DejaVu into base font
    base_glyph_set = set(base.getGlyphOrder())
    glyf_base = base.get('glyf')
    glyf_fill = fill.get('glyf')
    hmtx_base = base['hmtx'].metrics
    hmtx_fill = fill['hmtx'].metrics

    for cp, name in to_add.items():
        if name not in base_glyph_set and glyf_fill and name in glyf_fill.glyphs:
            if glyf_base:
                glyf_base.glyphs[name] = glyf_fill.glyphs[name]
            if name in hmtx_fill:
                hmtx_base[name] = hmtx_fill[name]
            base.getGlyphOrder().append(name)
            base_glyph_set.add(name)

print(f"Added {len(to_add)} codepoints from DejaVu to JetBrainsMono NF")
base.save(out_path)
PYEOF
  && woff2_compress /tmp/AtlasNF.ttf \
  && mv /tmp/AtlasNF.woff2 /usr/local/share/fonts/ \
  && rm -f /tmp/JetBrainsMono.zip /tmp/JetBrainsMonoNLNerdFontMono-Regular.ttf /tmp/AtlasNF.ttf

# Node.js 22 — required by claude-agent, opencode-agent, codex-agent, pi-agent
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  case "${TARGETARCH:-amd64}" in \
    amd64) ttyd_arch="x86_64" ;; \
    arm64) ttyd_arch="aarch64" ;; \
    *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.${ttyd_arch}" -o /usr/local/bin/ttyd; \
  chmod +x /usr/local/bin/ttyd

COPY generate-ttyd-index.py /usr/local/share/ttyd/generate-ttyd-index.py
COPY bin/atlas-agent /usr/local/bin/atlas-agent
COPY bin/agent-register /usr/local/bin/agent-register
COPY bin/message-handler /usr/local/bin/message-handler
COPY bin/runtime-entrypoint /usr/local/bin/runtime-entrypoint
COPY bin/send-message /usr/local/bin/send-message
COPY bin/wait-for-reply /usr/local/bin/wait-for-reply
COPY bin/agent-lookup /usr/local/bin/agent-lookup

RUN chmod +x /usr/local/bin/atlas-agent /usr/local/bin/agent-register /usr/local/bin/message-handler /usr/local/bin/runtime-entrypoint /usr/local/bin/send-message /usr/local/bin/wait-for-reply /usr/local/bin/agent-lookup

# Bake ttyd HTML with embedded Nerd Font at build time (avoids runtime timing issues)
RUN ttyd --port 7680 bash >/dev/null 2>&1 & TTYD_PID=$! \
  && for i in $(seq 1 20); do sleep 1; curl -sf http://127.0.0.1:7680/ >/usr/local/share/ttyd/base.html 2>/dev/null && break; done \
  && kill $TTYD_PID 2>/dev/null || true \
  && python3 /usr/local/share/ttyd/generate-ttyd-index.py \
  && rm /usr/local/share/ttyd/base.html /usr/local/share/ttyd/generate-ttyd-index.py

ENV AGENT_KIND=shell-agent
ENV AGENT_EXEC=bash

EXPOSE 7681

ENTRYPOINT ["/usr/local/bin/runtime-entrypoint"]
