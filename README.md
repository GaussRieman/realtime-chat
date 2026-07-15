# Audio Anything

基于阿里云百炼 `qwen-audio-3.0-realtime-plus` 和 `qwen3.7-max` 的浏览器实时语音对话应用。前端使用 React + Vite，Node.js 代理负责安全连接百炼实时 WebSocket 与文本分析接口，API Key 不会进入浏览器。

## 运行

要求 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env
```

编辑 `.env`：

```dotenv
DASHSCOPE_API_KEY=你的百炼_API_KEY
```

启动开发环境：

```bash
npm run dev
```

打开 `http://localhost:5173`，点击“开始实时对话”并允许麦克风权限。

## 验证

```bash
npm test
npm run build
npm start
```

生产环境必须通过 HTTPS/WSS 提供服务，浏览器才会在非本机地址开放麦克风。

## 主要能力

- 点击一次进入持续全双工对话
- 16 kHz PCM 麦克风输入与 24 kHz PCM 音频播放
- 服务端 VAD 自动断句
- 用户与 AI 实时字幕
- AI 回答期间直接插话打断
- 响应代次隔离，拒绝被打断响应的迟到音频
- 单一共享 AudioContext，首次点击即可完成录音和播放解锁
- 等待百炼 `session.updated` 后才开始上传音频
- 断线恢复、静音、字幕开关和音色设置
- 支持龙安谦、龙安聆心、龙安聆希、龙安小新、龙安路风 5 个系统音色
- 主页面直接选择音色；对话中更改将在下次会话生效
- 会话结束后自动调用 Qwen 3.7 Max 生成摘要与最多 5 条关注点
- 中央分析报告提供摘要、关注点和完整原文三个页签
- 摘要与关注点可编辑，支持当前页复制和完整 Markdown 下载
- 关注点可定位到对应原文，模型输出失败时保留原始字幕并支持安全重试
- 移动端响应式信号指挥台界面

## 实时会话说明

- 音色由第一次 `session.update` 写入，当前会话建立后不能动态替换。
- `invalid_request_error` 不会主动断开会话；只有服务端错误或不可恢复的代理错误会进入重连状态。
- `server_vad` 检测到插话时会自动取消模型回复，前端立即清空本地播放队列。
- 点击结束后麦克风与本地播放立即停止，仅保留最多 1 秒接收已经在途的字幕事件。
- 同一次逻辑会话的断线重连沿用会话 ID；主动结束后再次开始才创建新 ID。

## 会话分析说明

- 文本分析与实时语音共用 `DASHSCOPE_API_KEY`，不需要额外环境变量。
- 分析接口为 `POST /api/conversation-analysis`，浏览器只访问同源 Node.js 服务。
- 完整原文来自结束时冻结的本地字幕快照，不由 Qwen 3.7 Max 重新生成。
- 分析结果和用户编辑只保存在当前页面内存；刷新页面后不会恢复，也不会写入数据库。
- 服务端对请求大小、角色、状态、UUID、模型结构化输出和证据序号进行校验。

完整设计见：

- `docs/superpowers/specs/2026-07-15-audio-anything-realtime-voice-design.md`
- `docs/superpowers/specs/2026-07-15-conversation-analysis-design.md`
