# EchoPanel Voice Agent Demo

Browser-only voice copilot demo built with Next.js on the frontend and a Python LiveKit Agent on the backend. The browser joins a LiveKit room only after the user clicks connect, publishes microphone audio, receives the agent's audio response, renders synchronized transcripts, and exposes safe frontend tools over LiveKit RPC.

## What this demo does

- Connects a browser client to LiveKit Cloud with a server-generated token.
- Dispatches one Python voice agent into the same room.
- Uses LiveKit Inference for:
  - `openai/gpt-5-nano`
  - Deepgram Flux STT with `flux-general-en`
  - Cartesia Sonic 3 TTS with voice `9626c31c-bec5-4cca-baa8-f8ba9e84c8bc`
- Uses Silero VAD plus the LiveKit turn detector for quicker but smarter turn-taking.
- Enables preemptive generation so the agent can start responding earlier when the transcript is ready.
- Lets the agent:
  - explain the current page from frontend context
  - answer questions from local mock JSON data
  - apply safe UI actions through forwarded frontend tools

## Project structure

```text
project-root/
  apps/
    web/
      app/
      components/
      lib/
      public/
      data/
      package.json
    agent/
      src/
        agent.py
        tools.py
        prompts.py
        mock_data.py
      requirements.txt
  .env.example
  README.md
```

## Requirements

- Node.js 20+
- npm 10+ or another package manager that can install from `package.json`
- Python 3.11 or 3.12 recommended
- A LiveKit Cloud project with:
  - project URL
  - API key
  - API secret

## Environment setup

Create local env files and keep the real credentials there only.

### Root reference

The project expects these variables:

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

### Frontend env

Create `apps/web/.env.local`:

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

### Agent env

Create `apps/agent/.env`:

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

## Install steps

### Web app

```bash
cd apps/web
npm install
```

### Python agent

```bash
cd apps/agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python src/agent.py download-files
```

`download-files` pulls the Silero VAD model weights once before the first run.

## How to run the web app

```bash
cd apps/web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How to run the agent

In a second terminal:

```bash
cd apps/agent
.venv\Scripts\activate
python src/agent.py dev
```

The agent registers under the explicit dispatch name `echo-browser-copilot`.

## How the token endpoint works

The Next.js API route at `apps/web/app/api/livekit-token/route.ts`:

1. Reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from server-side env vars.
2. Creates a room-scoped participant token for the browser.
3. Adds an explicit room agent dispatch entry for `echo-browser-copilot`.
4. Returns:
   - `token`
   - `wsUrl`
   - `roomName`
   - `participantIdentity`
   - `agentName`

The browser uses `NEXT_PUBLIC_LIVEKIT_URL` or the returned `wsUrl` to connect. The API secret never goes to the browser.

## How the frontend connects to the agent

1. User clicks `Connect`.
2. The web app calls `/api/livekit-token`.
3. The browser connects to LiveKit with the returned token.
4. The browser publishes the microphone track.
5. LiveKit dispatches the Python agent into the same room.
6. The frontend renders:
   - connection state
   - agent state from `lk.agent.state`
   - synchronized transcriptions
   - recent forwarded tool actions

## Frontend tools exposed to the agent

The frontend registers these LiveKit RPC handlers:

- `getCurrentPageContext`
- `applyFilter`
- `openPanel`
- `highlightWidget`

They let the agent inspect current UI state and perform safe, reversible interface actions.

## Backend tools exposed to the model

The Python agent exposes:

- `query_data(question_or_filter)`
- `get_items()`
- `summarize_page_data()`

These load local mock JSON from `apps/web/data`.

## Manual LiveKit Cloud setup steps

1. Create or open a LiveKit Cloud project.
2. Copy the project WebSocket URL into:
   - `LIVEKIT_URL`
   - `NEXT_PUBLIC_LIVEKIT_URL`
3. Copy the project API key and API secret into your local env files.
4. Start the local Python agent with those credentials.
5. Start the local Next.js app.
6. Allow microphone access in the browser.

No extra OpenAI, Deepgram, or Cartesia keys are required here because the agent uses LiveKit Inference.

## Notes

- This repo intentionally does not hardcode real credentials in source control.
- The agent reads structured frontend context, not raw pixels. For a portfolio demo, that still gives a strong "understands the current screen" experience with lower complexity.
- The design keeps UI actions safe: filters, panel open, and temporary highlighting only.
