export type SceneEnvironment = "coast" | "forest" | "space" | "city" | "room";
export type SceneKind =
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "tree"
  | "house"
  | "crystal"
  | "ring";

export interface SceneObject {
  kind: SceneKind;
  label: string;
  color: string;
  position: [number, number, number];
  scale: [number, number, number];
  rotation: [number, number, number];
}

export interface SceneSpec {
  title: string;
  description: string;
  environment: SceneEnvironment;
  palette: {
    background: string;
    primary: string;
    accent: string;
    ground: string;
  };
  objects: SceneObject[];
  interactions: string[];
  source?: "ai" | "fallback";
}

export const DEFAULT_SCENE_PROMPT =
  "一座黄昏海边小屋，门前有发光的路标和几棵随风摆动的树，用户可以拖拽观察场景";

const COLORS = {
  coast: { background: "#081525", primary: "#f5a65b", accent: "#68d4e8", ground: "#102a3f" },
  forest: { background: "#071813", primary: "#73c991", accent: "#f7c873", ground: "#102c20" },
  space: { background: "#09071c", primary: "#9d8cff", accent: "#55d6ff", ground: "#161335" },
  city: { background: "#101522", primary: "#ffb86b", accent: "#7dd3fc", ground: "#202b41" },
  room: { background: "#171321", primary: "#f0b37e", accent: "#c7a3ff", ground: "#30233b" },
};

function object(
  kind: SceneKind,
  label: string,
  color: string,
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
  rotation: [number, number, number] = [0, 0, 0]
): SceneObject {
  return { kind, label, color, position, scale, rotation };
}

function environmentForPrompt(prompt: string): SceneEnvironment {
  const text = prompt.toLowerCase();
  if (/太空|宇宙|星球|银河|space|planet|galaxy/.test(text)) return "space";
  if (/城市|街道|高楼|都市|city|street|skyscraper/.test(text)) return "city";
  if (/房间|书房|工作室|室内|room|studio|interior/.test(text)) return "room";
  if (/森林|树林|山谷|森林|forest|woods|valley/.test(text)) return "forest";
  return "coast";
}

export function fallbackSceneFromPrompt(prompt: string): SceneSpec {
  const environment = environmentForPrompt(prompt);
  const palette = COLORS[environment];
  const objects: SceneObject[] = [];

  if (environment === "space") {
    objects.push(
      object("sphere", "主星球", palette.primary, [0, 1.1, 0], [1.55, 1.55, 1.55]),
      object("ring", "轨道环", palette.accent, [0, 1.1, 0], [2, 2, 2], [0.6, 0.1, 0.2]),
      object("crystal", "信号晶体", "#f58cff", [-2, 0.45, 0.6], [0.65, 1.4, 0.65]),
      object("crystal", "信号晶体", palette.accent, [2.1, 0.3, -0.2], [0.55, 1.1, 0.55])
    );
  } else if (environment === "city") {
    objects.push(
      object("box", "蓝色高楼", palette.accent, [-1.9, 1.25, 0], [1.1, 2.5, 1.1]),
      object("box", "暖光高楼", palette.primary, [0, 0.85, -0.6], [1.2, 1.7, 1.1]),
      object("box", "紫色高楼", "#b69cff", [1.9, 1.6, 0.35], [1.1, 3.2, 1.1]),
      object("ring", "城市广场", palette.accent, [0, 0.06, 1.8], [1.4, 1.4, 1.4], [Math.PI / 2, 0, 0])
    );
  } else if (environment === "room") {
    objects.push(
      object("house", "创作工作室", palette.primary, [0, 1.05, -0.2], [1.6, 1.6, 1.6]),
      object("box", "工作桌", palette.accent, [-2, 0.45, 1.1], [1.7, 0.45, 0.8]),
      object("crystal", "灵感灯", "#f7e28b", [1.8, 1.35, 1], [0.45, 1.1, 0.45])
    );
  } else if (environment === "forest") {
    objects.push(
      object("tree", "古树", palette.primary, [-2.3, 1.5, -0.4], [1.2, 1.7, 1.2]),
      object("tree", "古树", "#54ad86", [0, 1.2, -0.9], [0.95, 1.35, 0.95]),
      object("tree", "古树", "#8bd6a3", [2.2, 1.35, -0.2], [1.1, 1.5, 1.1]),
      object("crystal", "萤光石", palette.accent, [-0.6, 0.35, 1.2], [0.45, 0.7, 0.45]),
      object("crystal", "萤光石", palette.accent, [1.1, 0.35, 1.4], [0.35, 0.55, 0.35])
    );
  } else {
    objects.push(
      object("house", "海边小屋", palette.primary, [0, 1.15, -0.4], [1.65, 1.65, 1.65]),
      object("tree", "海风树", "#6fc2a6", [-2.4, 1.3, -0.25], [1, 1.5, 1]),
      object("tree", "海风树", "#91d8bb", [2.25, 1.1, 0], [0.85, 1.25, 0.85]),
      object("crystal", "发光路标", palette.accent, [0, 0.6, 1.75], [0.35, 1.2, 0.35]),
      object("ring", "潮汐光圈", palette.accent, [0, 0.08, 1.5], [1.5, 1.5, 1.5], [Math.PI / 2, 0, 0])
    );
  }

  return {
    title: environment === "coast" ? "潮汐边界" : `${environment} 灵感场景`,
    description: `根据“${prompt.trim() || DEFAULT_SCENE_PROMPT}”生成的可交互浏览器场景。拖拽画布旋转视角。`,
    environment,
    palette,
    objects,
    interactions: ["拖拽旋转视角", "点击物体查看标签", "重新输入自然语言生成新布局"],
    source: "fallback",
  };
}

function vector(input: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(input) || input.length !== 3) return fallback;
  const values = input.map(Number);
  return values.every(Number.isFinite) ? (values as [number, number, number]) : fallback;
}

function normalizeScene(candidate: unknown, prompt: string): SceneSpec | null {
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  const environment = ["coast", "forest", "space", "city", "room"].includes(String(value.environment))
    ? (String(value.environment) as SceneEnvironment)
    : environmentForPrompt(prompt);
  const paletteValue = value.palette as Record<string, unknown> | undefined;
  const palette = {
    ...COLORS[environment],
    background: typeof paletteValue?.background === "string" ? paletteValue.background : COLORS[environment].background,
    primary: typeof paletteValue?.primary === "string" ? paletteValue.primary : COLORS[environment].primary,
    accent: typeof paletteValue?.accent === "string" ? paletteValue.accent : COLORS[environment].accent,
    ground: typeof paletteValue?.ground === "string" ? paletteValue.ground : COLORS[environment].ground,
  };
  const rawObjects = Array.isArray(value.objects) ? value.objects : [];
  const allowedKinds: SceneKind[] = ["box", "sphere", "cylinder", "cone", "tree", "house", "crystal", "ring"];
  const objects = rawObjects
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => ({
      kind: allowedKinds.includes(String(item.kind) as SceneKind) ? (String(item.kind) as SceneKind) : "box",
      label: typeof item.label === "string" ? item.label.slice(0, 40) : `场景物体 ${index + 1}`,
      color: typeof item.color === "string" ? item.color : palette.primary,
      position: vector(item.position, [0, 0.5, 0]),
      scale: vector(item.scale, [1, 1, 1]),
      rotation: vector(item.rotation, [0, 0, 0]),
    }))
    .slice(0, 16);
  if (!objects.length) return null;
  return {
    title: typeof value.title === "string" ? value.title.slice(0, 60) : "AI 场景",
    description: typeof value.description === "string" ? value.description.slice(0, 240) : "由自然语言生成的交互式场景。",
    environment,
    palette,
    objects,
    interactions: Array.isArray(value.interactions)
      ? value.interactions.filter((item): item is string => typeof item === "string").slice(0, 6)
      : ["拖拽旋转视角", "点击物体查看标签"],
    source: "ai",
  };
}

export function parseSceneText(raw: string, prompt: string): SceneSpec {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(cleaned);
    return normalizeScene(parsed, prompt) ?? fallbackSceneFromPrompt(prompt);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return normalizeScene(JSON.parse(match[0]), prompt) ?? fallbackSceneFromPrompt(prompt);
      } catch {
        /* fall through to the deterministic local scene */
      }
    }
    return fallbackSceneFromPrompt(prompt);
  }
}

export function sceneMessages(prompt: string) {
  return [
    {
      role: "system" as const,
      content:
        "你是一个浏览器 3D 场景编排 Agent。把用户的自然语言转换成严格 JSON，不要输出 Markdown。坐标 y 向上，场景物体最多 10 个。",
    },
    {
      role: "user" as const,
      content: `用户描述：${prompt}\n\n只返回符合以下结构的 JSON：\n${JSON.stringify(
        {
          title: "场景标题",
          description: "一句话说明",
          environment: "coast | forest | space | city | room",
          palette: { background: "#081525", primary: "#f5a65b", accent: "#68d4e8", ground: "#102a3f" },
          objects: [
            {
              kind: "box | sphere | cylinder | cone | tree | house | crystal | ring",
              label: "物体名称",
              color: "#ffffff",
              position: [0, 0.5, 0],
              scale: [1, 1, 1],
              rotation: [0, 0, 0],
            },
          ],
          interactions: ["拖拽旋转视角", "点击物体查看标签"],
        },
        null,
        2
      )}`,
    },
  ];
}
