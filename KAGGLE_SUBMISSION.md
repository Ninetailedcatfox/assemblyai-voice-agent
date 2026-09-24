# AI Builder Hackathon 2026 · Kaggle 提交准备

## 参赛主线

本次提交的主线是 **Prompt-to-World · AI 观场起卦**，而不是原来的 AI 写作工作台。

用户先用自然语言描述一个世界，系统在浏览器中生成可交互的 3D 卦境；正式开发期再加入“点击对象、读取场景上下文、生成观场解读、继续追问”的单点特色。

当前项目已经覆盖：

```text
自然语言 → 结构化场景图 → Three.js 浏览器预览 → 对象检查 / JSON 导出
```

正式目标是扩展为：

```text
生成卦境 → 点击对象 → 上下文观场解读 → 对话式追问 / 增量修改
```

## 时间线

- 报名截止：2026-09-08，已完成
- 正式开发期：2026-09-11 – 2026-11-11
- 最终提交：2026-11-11（Kaggle 页面显示为北京时间 07:00）
- 结果公布：2026-11-25
- 官方 Kaggle 页面：<https://www.kaggle.com/competitions/ai-builder-hackathon-2026>

## 当前链接

- Demo：<https://ai-builder-scene-studio.vercel.app/scene>
- GitHub：<https://github.com/Ninetailedcatfox/ai-builder-scene-studio>

## 本地演示

```bash
npm install
npm run dev
```

打开 `http://localhost:3000/scene`：

1. 输入自然语言描述；
2. 点击“生成 / 重新生成卦境”；
3. 拖拽 3D 画布旋转视角；
4. 点击对象查看标签和场景结构；
5. 导出 `ai-builder-scene.json`。

正式开发期需要把第 4 步扩展为：点击对象后由 LLM 根据 Prompt、对象名称、对象位置和环境生成观场解读。

## 提交状态

- [x] Solo 报名表
- [x] Participant Confirmation Form
- [x] 公开 GitHub 仓库
- [x] 公开浏览器 Demo
- [ ] 生产环境 LLM / 稳定 fallback 策略最终确认
- [ ] 点击对象后的观场起卦交互
- [ ] 连续追问和增量修改
- [ ] 60–90 秒演示视频
- [ ] Kaggle Writeup
- [ ] 2026-11-11 前完成最终提交

## 提交叙事

Prompt-to-World 不把 3D 生成停留在“一次输入、一次输出”。它先把自然语言变成可检查的场景图，再把场景中的对象变成下一轮交互的入口。用户不只是生成一个世界，而是在世界里继续观察、提问和修改。

“观场起卦”是产品叙事和交互主题；模型输出属于创作式解读，不应被表述为事实、诊断或确定性预测。
