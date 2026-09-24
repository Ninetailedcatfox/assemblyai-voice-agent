# Prompt-to-World · AI 观场起卦

## One-line summary

Prompt-to-World turns a natural-language description into an explorable browser 3D scene, then uses the scene itself as the interface for contextual interpretation and follow-up questions.

## What we built

Most prompt-to-3D demos stop after generating a scene. Prompt-to-World treats the generated world as the beginning of the interaction: the user describes a place, the browser renders a structured scene, and each object can become a semantic entry point for the next AI response.

The current public demo supports:

- natural-language scene descriptions;
- AI scene planning through an OpenAI-compatible provider;
- deterministic local fallback when no API key is configured;
- primitive scene objects such as houses, trees, buildings, planets, crystals and rings;
- drag-to-rotate camera interaction;
- click-to-inspect object labels;
- a visible, inspectable scene graph;
- export of the generated scene graph as JSON.

## The distinctive interaction

The formal development direction is **AI 观场起卦**: a creative, context-aware interpretation layer for the generated scene.

When the user clicks an object, the system can send the original prompt, scene environment, object identity and object position to an LLM. The LLM responds in the voice of an atmospheric guide or oracle, relating the selected object to the world that was just created. The user can then ask a follow-up question or request a change to the scene.

This gives the demo a short, memorable loop:

```text
describe a world → enter the scene → click an object → receive an interpretation → ask again
```

The interpretation is framed as creative narrative, not factual prediction or professional advice.

## Why this matters

The value is not only generating primitive 3D assets. The project makes the AI output inspectable and turns the scene into an interface for continued interaction. The scene plan exposes the environment, palette, objects, coordinates, scale, rotation and intended interactions, so a creator can understand what the agent decided and keep shaping the world.

## How it works

1. The user enters a natural-language prompt.
2. The scene agent asks an LLM for a constrained JSON scene graph.
3. The server validates and normalizes the response.
4. If the provider is unavailable or returns malformed JSON, the same prompt goes through a deterministic local planner so the demo remains reproducible.
5. Three.js maps the scene graph to browser-native meshes, lighting, a ground plane and interaction handlers.
6. The next interaction layer sends selected-object context back to the LLM for an in-scene interpretation and follow-up dialogue.

The app is built with Next.js App Router, TypeScript, React and Three.js. API keys stay server-side in the Next.js route handler; the browser only receives the normalized scene graph and the generated response.

## Demo walkthrough

1. Open the Demo URL and start with the default coastal cabin prompt.
2. Click “生成 / 重新生成卦境”.
3. Drag the scene to rotate the view.
4. Click the glowing sign, cabin or another object.
5. Read the contextual interpretation and ask a follow-up question.
6. Export the scene JSON to show that the result is a structured, reusable scene rather than a screenshot.

## Links

- Demo: <https://ai-builder-scene-studio.vercel.app/scene>
- Public source: <https://github.com/Ninetailedcatfox/ai-builder-scene-studio>
- Competition: <https://www.kaggle.com/competitions/ai-builder-hackathon-2026>

## Next build priorities

- configure the production LLM provider while preserving the local fallback;
- add the selected-object context endpoint and response panel;
- support follow-up questions and incremental scene edits;
- add lightweight object behaviors and trigger zones;
- record a 60–90 second demo video;
- finalize the Kaggle Writeup before the 2026-11-11 deadline.
