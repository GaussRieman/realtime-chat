# Audio Anything 暂停与结束会话实施计划

## 目标

在不改变现有实时语音协议对外行为、不新增依赖的前提下，为实时会话增加“暂停 / 继续”能力，并与既有“主动结束”“断线重连”严格区分：`CONNECTION PAUSED` 只在真实断线时出现，主动暂停与主动结束都不得触发它。

设计依据：`docs/superpowers/specs/2026-07-16-conversation-pause-and-end-design.md`

## 实施原则

- 复用既有机制：`ResponseGate`（响应代次失效）、`AudioPlaybackQueue.invalidate()`（清空播放）、`interrupted` 字幕状态，不新增协议/网关类。
- “抑制迟到响应”通过不调用 `gate.begin()` 天然实现——`currentResponseId` 保持 `null`，已有的空值检查会自动丢弃后续 delta/transcript。
- 暂停不得关闭 WebSocket、不得轮换 `conversationId`、不得清空字幕。
- 暂停与结束重复点击必须幂等，通过 phase 判断而非额外锁。
- 只在浏览器环境依赖的模块（`MicrophoneCapture`、`RealtimeClient`、`AudioPlaybackQueue`、`useRealtimeConversation` 本身）维持现状——项目现有测试边界止于纯逻辑模块（`ResponseGate`、`conversationLifecycle`、`transcripts`、`errors`、`protocol`），本次改动同样遵循该边界，浏览器相关改动通过 `npm run dev` 手动验证。

## 阶段 1：麦克风暂停/恢复原语

### 文件

- 修改 `src/audio/MicrophoneCapture.js`

### 工作

1. 增加内部 `paused` 标志与 `applyTrackState()` 帮助方法，统一 `muted` 与 `paused` 两个独立开关对轨道 `enabled` 的影响（`enabled = !muted && !paused`）。
2. `pause()`：停止音频上传（`handleSamples` 提前返回）并禁用轨道，不修改 `muted` 偏好。
3. `resume()`：清除 `paused`，按原有 `muted` 偏好恢复轨道。
4. `setMuted()` 复用 `applyTrackState()`。

### 验证

- 手动验证：暂停时说话不再有音频包发送；恢复后麦克风电平恢复；暂停前静音的情况下，恢复后仍保持静音。

## 阶段 2：会话生命周期状态机

### 文件

- 修改 `src/hooks/useRealtimeConversation.js`

### 工作

1. 新增 `responseSuppressedRef`（响应抑制门闩）与 `speechOpenRef`（当前用户回合是否仍开放）。
2. 新增 `pause()`：仅在 `listening/generating/speaking/interrupted` 时可执行；依次停止计时、停止麦克风上传并禁用轨道、清空本地播放、按需失效当前响应代次并发送 `response.cancel`、按需提交未完成的用户回合（`input_audio_buffer.commit`）、置位抑制门闩、把在途流式字幕标记为 `interrupted`、切换到 `paused` 状态。
3. 新增 `resume()`：仅在 `paused` 时可执行；恢复麦克风（按暂停前静音偏好）、重新开始计时、切换到 `listening`；抑制门闩留给下一次真实的 `speech_started` 解除。
4. `handleEvent` 改动：
   - `input_audio_buffer.speech_started`：若仍处于 `paused` 直接丢弃（不得被迟到 VAD 改变状态）；否则维护 `speechOpenRef`，若抑制门闩打开则先失效再解除门闩，再走原有插话逻辑。
   - `input_audio_buffer.speech_stopped`：同样在 `paused` 时丢弃；否则维护 `speechOpenRef`。
   - `response.created`：抑制门闩打开时只发送 `response.cancel` 并直接返回，不调用 `gate.begin()`。
   - `response.audio.delta` / `response.audio_transcript.delta` / `response.audio_transcript.done` / `response.done`：无需改动，已有的 `currentResponseId` 空值检查天然拦截暂停期间的迟到事件。
   - `conversation.item.input_audio_transcription.completed`：无需改动，暂停期间在途的用户最终字幕继续合并。
5. `start()` 中与 `gateRef` 重置一起，重置 `responseSuppressedRef`/`speechOpenRef`（覆盖 fresh start 与 reconnect）。
6. 计时与心跳拆分为两个 `useEffect`：计时保持仅在 `listening/generating/speaking/interrupted` 运行；心跳新增 `paused`，暂停期间维持 WebSocket 传输层探测与延迟展示，且服务端心跳应答不转发上游（已有行为）。
7. `end()` 不改动——已天然支持从任意已连接 phase（含 `paused`）触发。
8. 返回值新增 `pause`、`resume`。

### 验证

- `npm test` 覆盖既有回归；暂停/恢复逻辑本身遵循项目现状不做浏览器级单测，改为手动走查（见验收章节）。

## 阶段 3：控件与视觉状态

### 文件

- 修改 `src/App.jsx`
- 修改 `src/styles.css`

### 工作

1. 引入 `Pause`/`Play` 图标，新增“暂停/继续”圆按钮，复用 `round-button`（44×44）与 `round-button--active` 样式。
2. 按钮可用性：暂停/继续在 `listening/generating/speaking/interrupted/paused` 可用；结束在此基础上恒可用（含 `paused`）；静音沿用现状（`paused` 不在 `ACTIVE_PHASES` 中，天然禁用）。
3. `connectionLabel` 增加 `paused` 分支，显示“会话已暂停”，避免落入“链路中断”或“等待连接”文案。
4. 新增 `.connection-state--paused` 圆点样式（复用 `--amber`，不使用 `--red`）；`.waveform` 静止透明度选择器加入 `--paused`（`Waveform.jsx` 判定逻辑已天然覆盖，无需改代码）。

### 验证

- 手动走查 §7 验收场景对应的 UI 表现。

## 阶段 4：协议允许列表

### 文件

- 修改 `server/protocol.js`
- 修改 `server/protocol.test.js`

### 工作

1. `CLIENT_EVENTS` 增加 `input_audio_buffer.commit`（阿里云文档已确认支持，`docs/api.md` 中已有先例，事件不带载荷，无需额外校验）。
2. 心跳无需改动：`client.ping` 已在代理侧直接应答，不转发上游。

### 验证

- 新增测试：`parseClientMessage` 接受 `{ type: "input_audio_buffer.commit" }`。

## 验收（对应设计规格 §7）

- 正常会话点击暂停后，输入、输出和计时立即停止，字幕与连接保留。
- 点击继续后使用同一 `conversationId` 恢复聆听，暂停时间不计时。
- 暂停前静音时，继续后仍保持静音。
- 用户说话中暂停时，暂停前内容可以形成一条不完整字幕，但恢复后的语音不会与其拼接。
- 从 generating 或 speaking 暂停后，迟到响应不会在暂停期间或刚恢复时播放。
- 长时间暂停时 WebSocket 心跳保持连接；暂停期间断线仍进入重连。
- 暂停与结束并发点击保持幂等，不会重复关闭或重复分析。
- 暂停期间点击结束，最终进入待开始并触发一次分析。
- listening、speaking 和 paused 状态主动结束后都不显示 `CONNECTION PAUSED`。
- 真实 WebSocket 异常关闭仍显示 `CONNECTION PAUSED`。
- 全量测试和生产构建通过。
