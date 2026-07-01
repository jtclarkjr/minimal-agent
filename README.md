# minimal-agent

An eve agent for coding assistance against local repositories on the host machine.

The agent uses eve's filesystem-first layout, exposes the built-in eve HTTP channel, and includes a custom read-only `host_repo` tool for accessing repositories under user path.

## Requirements

- Node.js `24.x`
- Bun `1.3.14`
- Model credentials for the configured model in [agent/agent.ts](agent/agent.ts)

For AI Gateway model IDs, set `AI_GATEWAY_API_KEY` or provide `VERCEL_OIDC_TOKEN` through a linked Vercel project. For direct provider models, set the provider-specific API key.

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

This starts the eve development runtime and interactive TUI. The built-in eve channel is configured in [agent/channels/eve.ts](agent/channels/eve.ts) with:

- `localDev()` for localhost development
- `vercelOidc()` for Vercel-hosted access

## Scripts

```bash
bun run dev        # start the local eve runtime
bun run build      # build the agent into .eve/
bun run start      # serve the built agent
bun run typecheck  # run TypeScript checks
bun run check      # run oxlint and TypeScript checks
bun run fmt        # format with oxfmt
```

## Project Layout

```text
agent/
  agent.ts             # runtime model/config
  instructions.md      # base system prompt
  channels/
    eve.ts             # built-in eve HTTP channel
  tools/
    host_repo.ts       # read-only host repository access
```

eve derives names from file paths. For example, [agent/tools/host_repo.ts](agent/tools/host_repo.ts) is exposed to the model as the `host_repo` tool.

## Host Repository Tool

The `host_repo` tool gives the agent read-only access to repositories outside the sandbox. It is intended for absolute local paths under `/Users/jamesclark/GitHub`, because the default sandbox file tools only see `/workspace`.

Supported actions:

- `list`: list a directory with bounded depth and entry count
- `read`: read a text file with line and byte limits

By default, paths are resolved under `/Users/jamesclark/GitHub`. Override that root with:

```bash
EVE_HOST_REPO_ROOT=/path/to/repos bun run dev
```

The tool resolves real paths and rejects anything outside the configured root.

## HTTP API

When the local runtime is running, create a session with:

```bash
curl -X POST http://127.0.0.1:3000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"Hello"}'
```

Use the returned `x-eve-session-id` header to stream events:

```bash
curl http://127.0.0.1:3000/eve/v1/session/<sessionId>/stream
```
