# Demo Script

Use this short walkthrough when recording or presenting EchoPanel.

## 1. Open the app

- Start the frontend locally.
- Open `http://localhost:3000`.
- Point out that the frontend runs locally while the agent is deployed on LiveKit Cloud.

## 2. Start a voice session

- Click `Start Session`.
- Let the assistant greet first.
- Mention that the app supports live transcript for both the user and the assistant.

## 3. Ask a normal voice question

Example:

`How do APIs work?`

What to say while demoing:

- The browser streams audio into a LiveKit room.
- The cloud agent handles STT, LLM, and TTS through LiveKit Inference.
- The response is streamed back as voice and transcript.

## 4. Show interruption and latest-question priority

- Start asking one question.
- Quickly rephrase it before the assistant starts answering.

Example:

`How do AP...`

then immediately:

`How do APIs work?`

What to highlight:

- The pending reply is interrupted.
- The latest user question wins.
- This makes the conversation feel more natural for real-time voice use.

## 5. Show typed input

- Type a question into the text box and send it.

Example:

`Tell me a short joke.`

What to say while demoing:

- Typed questions skip speech-to-text.
- That usually makes typed input feel faster than voice input.
- Both typed and spoken questions stay in the same conversation flow.

## 6. Show the live transcript

- Point out the transcript panel.
- Show that both user messages and assistant responses appear there in real time.

## 7. Mention deployment and latency work

Call out the final production-style setup:

- Agent deployed to LiveKit Cloud
- Adaptive interruption enabled
- Typed and voice input supported
- General assistant flow with no tool-routing overhead

Suggested line:

`I started with a local voice pipeline, measured the bottlenecks, and then moved the agent to LiveKit Cloud, added typed input, tuned turn handling, and kept interruption behavior stable.`

## 8. Optional cloud proof

If you want to show deployment credibility:

- open LiveKit agent runtime logs
- show latency lines like:
  - `end_of_turn_delay`
  - `llm_node_ttft`
  - `tts_node_ttfb`

## 9. Strong closing

Suggested closing line:

`EchoPanel is a real-time browser voice assistant built with Next.js, Python, and LiveKit Cloud, with voice and typed input, live transcript, interruption handling, and a cloud-deployed low-latency response pipeline.`
