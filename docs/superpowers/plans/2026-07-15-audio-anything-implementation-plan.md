# Audio Anything 实施计划

## 目标

实现已批准的“信号指挥台”实时语音 WebAPP：React + Vite 前端、Node.js WebSocket 安全代理、16 kHz 麦克风输入、24 kHz AI 音频输出、实时双向字幕、用户插话打断和响应代次隔离。

## 阶段 1：工程与安全代理

- 创建单仓库 Node.js 项目、Vite React 前端和生产静态文件服务。
- 创建 `/api/health` 与 `/realtime` WebSocket 入口。
- 校验 Origin、客户端消息类型和大小；从服务端环境注入 `DASHSCOPE_API_KEY`。
- 提供 `.env.example`、安全日志和可读错误码。

验证：代理单元测试、健康检查、无密钥时前端仍可加载且开始会话得到配置错误。

## 阶段 2：浏览器音频模块

- 点击事件同步解锁单一 AudioContext，AudioWorklet 采集和 AI 播放共享该上下文。
- 重采样并编码为 16 kHz mono PCM16 little-endian。
- 24 kHz PCM16 解码和连续播放调度。
- 支持静音、停止、清空播放队列和输入音量事件。

验证：PCM 边界、重采样长度、Base64 转换和播放队列代次测试。

## 阶段 3：实时会话控制器

- 建立状态机：idle、connecting、listening、generating、speaking、interrupted、disconnected、ended。
- 处理百炼音频、字幕、VAD、错误和会话事件。
- 以 response ID 或本地代次拒绝被打断响应的迟到音频。
- 保存临时字幕到 `sessionStorage`，实现 RTT 移动中位数。

验证：状态转换、打断、迟到 delta、断线和重连集成测试。

## 阶段 4：信号指挥台 UI

- 实现深色网格声场、实时波形、连接与延迟状态、双向字幕和四个关键状态。
- 实现开始、结束、静音、字幕开关和主页面音色下拉，不使用额外设置弹窗。
- 适配 320 px 起移动视口，提供键盘焦点、ARIA 状态和减少动态效果支持。

验证：375、768、1024、1440 px 布局；开始前、对话中、插话和断线状态；无横向溢出。

## 阶段 5：交付验证

- 运行单元测试、生产构建和密钥泄露扫描。
- 启动本地应用，在浏览器验证主要交互和响应式布局。
- 若提供有效 `DASHSCOPE_API_KEY`，执行真实百炼连接冒烟测试；否则明确保留该验证项。
