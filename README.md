# Prompt-to-World · AI 观场起卦

> 说出一个世界，走进一方卦境：把自然语言变成可交互的浏览器 3D 场景，再让场景中的对象成为可点击、可追问的观场入口。

Prompt-to-World 是 AI Builder Hackathon 2026 的参赛作品。当前版本已经打通“自然语言 → 结构化场景图 → Three.js 浏览器预览”的闭环；正式开发期将把场景上下文、对象语义和 LLM 连接起来，形成更有记忆点的体验：

**描述卦境 → 生成场景 → 点击对象 → 获得观场解读 → 继续追问。**

这里的“起卦”是创作式的场景解读，不把模型输出包装成事实或确定性预测。

## 当前能力

| 能力 | 状态 |
|---|---|
| 自然语言生成 3D 场景 | 已实现 |
| AI / 本地可复现场景规划 | 已实现 |
| 可检查的 Scene Graph | 已实现 |
| Three.js 浏览器预览 | 已实现 |
| 拖拽旋转视角、点击查看对象 | 已实现 |
| 场景 JSON 导出 | 已实现 |
| 点击对象后的上下文观场解读 | 正式开发期实现 |
| 对话式追问和增量修改 | 正式开发期实现 |

## 快速开始

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开场景入口：`http://localhost:3000/scene`

配置任意 OpenAI 兼容的 LLM Key 后，场景规划会优先调用模型；未配置时会使用本地确定性规划器，保证 Demo 仍然可以运行和导出。

原来的 AI 写作工作台仍保留在根路径 `/`，但本次比赛的主入口是 `/scene`。

## 场景工作流

```text
自然语言 Prompt
      ↓
POST /api/scene
      ↓
LLM 结构化场景图 / 本地 fallback
      ↓
SceneCanvas · Three.js 浏览器渲染
      ↓
对象检查、场景图查看、JSON 导出

正式开发期：点击对象 → 读取场景上下文 → LLM 生成观场解读 → 用户继续追问
```

场景图会暴露环境、色板、对象、坐标、缩放、旋转和交互意图。它不是只能观看的截图，而是可检查、可复现、可继续扩展的数据结构。

## 参赛链接

- Demo：<https://ai-builder-scene-studio.vercel.app/scene>
- GitHub：<https://github.com/Ninetailedcatfox/ai-builder-scene-studio>
- Kaggle：<https://www.kaggle.com/competitions/ai-builder-hackathon-2026>

## 开发计划

- [ ] 配置生产环境 LLM，并保持无 Key 时的稳定 fallback
- [ ] 增加点击对象后的上下文观场 / 起卦回应
- [ ] 支持针对当前对象和当前场景的连续追问
- [ ] 增加对象行为、触发器和简单 NPC 逻辑
- [ ] 录制一条 60–90 秒的完整演示视频
- [ ] 完成 Kaggle Writeup 并在 2026-11-11 前提交

## 测试

```bash
npm test
npm run lint
npm run build
```

Made for AI Builder Hackathon 2026 · 最终提交截止 2026-11-11
