# Implementation Plan: GitHub Integration Spike

This plan details the changes required to implement the first follow-on spike: **GitHub repository cloning, branch creation, commit, and push continuity**.

---

## Goal

Provide the agent runtime with the capability to:
1. Accept a GitHub repository and access token at creation.
2. Clone the repository into the persistent `/data/workspace` directory on initial boot.
3. Keep the repository intact across VM suspensions/resumptions.
4. Allow full git operations (commit, branch creation, push) directly from the terminal.

---

## User Review Required

> [!WARNING]
> For the simplicity of this spike, the **GitHub Personal Access Token (PAT)** will be sent from the UI, stored in the local SQLite database, and passed as a cleartext environment variable to the Fly Machine's guest configuration.
> 
> This is highly insecure for production but acceptable for a local spike. In a hosted version, we will transition to OAuth and a secure secret manager.

---

## Open Questions

None at this stage. We will proceed with a standard GitHub Personal Access Token (PAT) authentication flow via HTTPS.

---

## Proposed Changes

We will modify the backend DB schema, the Fly client, the Fastify API route, the React UI, and the runtime agent initialization script.

### 1. Database Schema

#### [MODIFY] [db.mjs](file:///Users/mebert/Documents/BitBucket/altas-agents/server/db.mjs)
- Update the `agents` schema creation query to include three new nullable fields:
  - `github_repo TEXT` (stored as `username/repo`)
  - `github_token TEXT` (GitHub PAT)
  - `git_user_name TEXT`
  - `git_user_email TEXT`
- Update `createAgentRecord` and `updateAgent` functions to support these new fields.

### 2. Fly Client Integration

#### [MODIFY] [fly-client.mjs](file:///Users/mebert/Documents/BitBucket/altas-agents/server/fly-client.mjs)
- Update `provisionShellAgent` signature to accept optional configuration:
  ```javascript
  export async function provisionShellAgent({
    appName,
    volumeName,
    region,
    githubRepo,
    githubToken,
    gitUserName,
    gitUserEmail
  })
  ```
- Pass these variables inside the Machine's environment config under `config.env`:
  ```json
  "env": {
    "ATLAS_GITHUB_REPO": githubRepo || "",
    "ATLAS_GITHUB_TOKEN": githubToken || "",
    "ATLAS_GIT_USER_NAME": gitUserName || "",
    "ATLAS_GIT_USER_EMAIL": gitUserEmail || ""
  }
  ```

### 3. Backend REST API

#### [MODIFY] [index.mjs](file:///Users/mebert/Documents/BitBucket/altas-agents/server/index.mjs)
- Update the `POST /api/workspaces/:workspaceId/agents` route to parse the following body parameters:
  - `githubRepo`
  - `githubToken`
  - `gitUserName`
  - `gitUserEmail`
- Store these values in the database during database record insertion, and pass them directly to the `provisionShellAgent` function.

### 4. Agent UI

#### [MODIFY] [App.tsx](file:///Users/mebert/Documents/BitBucket/altas-agents/src/App.tsx)
- Add input elements to the **Agent** panel for:
  - **GitHub Repository** (placeholder: `username/repo`)
  - **GitHub Token** (type `password`)
  - **Git Username** (placeholder: `Atlas Agent`)
  - **Git Email** (placeholder: `agent@atlaslives.dev`)
- Update the `createAgent` call to gather and transmit these fields to the API.

---

### 5. Runtime Agent Behavior

#### [MODIFY] [atlas-agent](file:///Users/mebert/Documents/BitBucket/altas-agents/runtime/shell-agent/bin/atlas-agent)
Update the `start` command to:
1. Configure global Git identity:
   ```bash
   if [ -n "${ATLAS_GIT_USER_NAME:-}" ]; then
     git config --global user.name "$ATLAS_GIT_USER_NAME"
   fi
   if [ -n "${ATLAS_GIT_USER_EMAIL:-}" ]; then
     git config --global user.email "$ATLAS_GIT_USER_EMAIL"
   fi
   ```
2. Clone the repository into `/data/workspace` if a git repository is not already initialized:
   ```bash
   if [ -n "${ATLAS_GITHUB_REPO:-}" ] && [ ! -d "/data/workspace/.git" ]; then
     echo "Cloning repository: $ATLAS_GITHUB_REPO..."
     
     # Temporarily configure credentials helper or clone using token URL
     # Since git version might be old, cloning via authenticated HTTPS is robust:
     git clone "https://${ATLAS_GITHUB_TOKEN}@github.com/${ATLAS_GITHUB_REPO}.git" /data/workspace/temp_clone
     
     # Move files and .git to the workspace
     mv /data/workspace/temp_clone/* /data/workspace/temp_clone/.* /data/workspace/ 2>/dev/null || true
     rmdir /data/workspace/temp_clone
   fi
   ```
3. Re-build and push the Docker image to `registry.fly.io/atlaslives-runtime:latest` so that newly provisioned agents run this updated logic.

---

## Verification Plan

### Automated/Manual Tests
- Create a test repository on GitHub (e.g., a public repository or a private dummy repo).
- Generate a fine-grained GitHub PAT with read & write permissions for that repository.
- Provision a new Agent from the dashboard, filling in the GitHub repo details.
- Verify that the terminal boots inside the cloned repository.
- Run the following terminal verification commands:
  ```bash
  # Check if files cloned successfully
  ls -la
  
  # Create a branch and add a file
  git checkout -b atlas-spike-test
  echo "Spike verify" >> proof.txt
  git add proof.txt
  git commit -m "verify github spike push"
  
  # Push back to GitHub
  git push origin atlas-spike-test
  ```
- Check GitHub to verify that the branch `atlas-spike-test` was pushed successfully.
- Suspend and resume the agent, then ensure the repository and active git branch state survive completely.
