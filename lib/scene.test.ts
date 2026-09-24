import { describe, expect, it } from "vitest";
import { DEFAULT_SCENE_PROMPT, fallbackSceneFromPrompt, parseSceneText } from "./scene";

describe("scene planner", () => {
  it("creates a deterministic browser scene without an API key", () => {
    const scene = fallbackSceneFromPrompt(DEFAULT_SCENE_PROMPT);
    expect(scene.environment).toBe("coast");
    expect(scene.objects.length).toBeGreaterThanOrEqual(4);
    expect(scene.source).toBe("fallback");
  });

  it("parses an AI JSON response wrapped in a code fence", () => {
    const scene = parseSceneText(
      '```json\n{"title":"星际花园","environment":"space","palette":{"background":"#000000"},"objects":[{"kind":"sphere","label":"星球","color":"#fff","position":[0,1,0],"scale":[1,1,1],"rotation":[0,0,0]}],"interactions":["拖拽"]}\n```',
      "一个星际花园"
    );
    expect(scene.title).toBe("星际花园");
    expect(scene.environment).toBe("space");
    expect(scene.objects[0]?.label).toBe("星球");
    expect(scene.source).toBe("ai");
  });

  it("falls back when the model returns malformed JSON", () => {
    const scene = parseSceneText("not json", "一片森林");
    expect(scene.environment).toBe("forest");
    expect(scene.objects.length).toBeGreaterThan(0);
    expect(scene.source).toBe("fallback");
  });
});
