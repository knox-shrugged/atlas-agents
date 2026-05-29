FROM --platform=linux/amd64 registry.fly.io/atlas-base:latest

RUN npm install -g @google/gemini-cli

# Bake settings: disable home dir warning, suppress compatibility warnings
RUN node -e " \
  const fs=require('fs'),os=require('os'); \
  const d=os.homedir()+'/.gemini'; \
  fs.mkdirSync(d,{recursive:true}); \
  fs.writeFileSync(d+'/settings.json',JSON.stringify({ \
    theme:'Default', \
    ui:{showHomeDirectoryWarning:false,showCompatibilityWarnings:false} \
  },null,2)); \
"

ENV AGENT_KIND=gemini-agent
ENV AGENT_EXEC=bash

COPY bin/gemini-agent /usr/local/bin/
RUN chmod +x /usr/local/bin/gemini-agent
