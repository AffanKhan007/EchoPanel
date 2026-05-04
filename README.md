# EchoPanel

EchoPanel is a real-time browser voice assistant built with Next.js, Python, and LiveKit Cloud. It supports both voice and typed questions, streams live transcript for the user and assistant, supports interruption/barge-in, and can run either with a local Python agent or a deployed LiveKit Cloud agent.

## Highlights

- Real-time voice assistant in the browser
- Voice input and typed input in the same session
- Live transcript for both user and assistant
- Interruption handling with latest-question priority
- LiveKit Cloud token generation from a secure server route
- Python LiveKit agent using LiveKit Inference
- Optional cloud deployment for more stable latency than local laptop runtime

## Tech Stack

- Frontend: Next.js App Router + TypeScript
- Backend: Python + LiveKit Agents SDK
- Transport: LiveKit Cloud
- STT: AssemblyAI via LiveKit Inference
- LLM: OpenAI via LiveKit Inference
- TTS: Cartesia Sonic 3 via LiveKit Inference

## Current Voice Pipeline

Voice question:

`speech -> STT -> LLM -> TTS -> spoken answer`

Typed question:

`text -> LLM -> TTS -> spoken answer`

Typed questions are usually faster because they skip speech-to-text and end-of-turn detection.

## Project Structure

```text
EchoPanel/
  apps/
    agent/
      src/
        agent.py
        prompts.py
      .env
      .dockerignore
      Dockerfile
      requirements.txt
    web/
      app/
        api/livekit-token/
        globals.css
        layout.tsx
        page.tsx
      components/
        assistant-shell.tsx
        voice-assistant-panel.tsx
      lib/
        livekit.ts
        types.ts
      .env.local
      next.config.ts
      package.json
      tsconfig.json
  .env.example
  README.md
```

## Requirements

- Node.js 20+
- npm 10+
- Python 3.12 recommended
- A LiveKit Cloud project

## Environment Variables

Use local env files only. Do not commit real credentials.

### Frontend: `apps/web/.env.local`

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
NEXT_PUBLIC_LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

### Agent: `apps/agent/.env`

```bash
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
```

### Example placeholders

See [.env.example](C:/Users/affan.khan/Desktop/EchoPanel/.env.example).

## Install

### Frontend

```powershell
cd C:\Users\affan.khan\Desktop\EchoPanel\apps\web
npm install
```

### Agent

```powershell
cd C:\Users\affan.khan\Desktop\EchoPanel\apps\agent
python -m venv .venv312
.\.venv312\Scripts\Activate.ps1
pip install -r requirements.txt
python src/agent.py download-files
```

## Run Modes

### 1. Cloud Agent Mode

Use this when the backend agent is already deployed to LiveKit Cloud.

Run only the frontend:

```powershell
cd C:\Users\affan.khan\Desktop\EchoPanel\apps\web
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

In this mode:
- frontend runs locally
- agent runs on LiveKit Cloud
- no local Python agent process is needed

### 2. Local Agent Mode

Use this for faster backend development/testing before redeploying.

Frontend:

```powershell
cd C:\Users\affan.khan\Desktop\EchoPanel\apps\web
npm run dev
```

Agent:

```powershell
cd C:\Users\affan.khan\Desktop\EchoPanel\apps\agent
.\.venv312\Scripts\Activate.ps1
python src/agent.py start
```

In this mode:
- frontend runs locally
- agent runs locally from `.venv312`

## Cloud Deployment

The agent can be deployed to LiveKit Cloud so it runs on LiveKit infrastructure instead of your laptop.

### Create the cloud agent

Run from [apps/agent](C:/Users/affan.khan/Desktop/EchoPanel/apps/agent):

```powershell
Remove-Item Env:ALL_PROXY,Env:GIT_HTTPS_PROXY,Env:GIT_HTTP_PROXY,Env:HTTPS_PROXY,Env:HTTP_PROXY -ErrorAction SilentlyContinue
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\LiveKit.LiveKitCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\lk.exe" agent create --silent --region eu-central .
```

### Deploy backend changes to the cloud agent

```powershell
Remove-Item Env:ALL_PROXY,Env:GIT_HTTPS_PROXY,Env:GIT_HTTP_PROXY,Env:HTTPS_PROXY,Env:HTTP_PROXY -ErrorAction SilentlyContinue
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\LiveKit.LiveKitCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\lk.exe" agent deploy .
```

### Check deployment status

```powershell
Remove-Item Env:ALL_PROXY,Env:GIT_HTTPS_PROXY,Env:GIT_HTTP_PROXY,Env:HTTPS_PROXY,Env:HTTP_PROXY -ErrorAction SilentlyContinue
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\LiveKit.LiveKitCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\lk.exe" agent status .
```

### View runtime logs

```powershell
Remove-Item Env:ALL_PROXY,Env:GIT_HTTPS_PROXY,Env:GIT_HTTP_PROXY,Env:HTTPS_PROXY,Env:HTTP_PROXY -ErrorAction SilentlyContinue
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\LiveKit.LiveKitCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\lk.exe" agent logs .
```

### View build logs

```powershell
Remove-Item Env:ALL_PROXY,Env:GIT_HTTPS_PROXY,Env:GIT_HTTP_PROXY,Env:HTTPS_PROXY,Env:HTTP_PROXY -ErrorAction SilentlyContinue
& "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\LiveKit.LiveKitCLI_Microsoft.Winget.Source_8wekyb3d8bbwe\lk.exe" agent logs --log-type=build .
```

## How It Works

1. The user opens the frontend and starts a session.
2. The frontend calls `/api/livekit-token`.
3. The server generates a LiveKit token.
4. The browser joins the room.
5. The LiveKit agent joins the same room.
6. The user can speak or type.
7. The assistant responds with spoken output and live transcript.

## Notable Behavior

- The assistant greets first.
- The latest user question is prioritized when interruptions happen.
- Typed questions usually respond faster than spoken questions.
- The deployed cloud agent usually performs better than the local laptop agent for latency consistency.

## Demo Ideas

Try these:

- `How do APIs work?`
- `Tell me a short joke.`
- `What can you help me with?`
- Type a question and compare how fast it feels versus voice.
- Ask a question, then quickly rephrase it before the assistant answers.

For a presentation walkthrough, see [DEMO_SCRIPT.md](C:/Users/affan.khan/Desktop/EchoPanel/DEMO_SCRIPT.md).

## Notes

- This project uses LiveKit Inference, so no separate OpenAI, AssemblyAI, or Cartesia API keys are required for the current setup.
- The local Python virtual environment is for development/testing only. The cloud deployment does not use your local `.venv312`.
- Browser extensions like Grammarly can inject DOM attributes and cause harmless hydration warnings in development.
