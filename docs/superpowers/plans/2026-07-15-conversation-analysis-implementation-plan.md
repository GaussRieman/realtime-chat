# Audio Anything 会话分析实施计划

## 目标

在不改变现有实时语音协议和视觉方向的前提下，为每次用户主动结束的逻辑会话自动生成 Qwen 3.7 Max 摘要与关注点，并提供中央报告弹窗、完整原文、编辑、复制、原文定位和 Markdown 下载。

设计依据：`docs/superpowers/specs/2026-07-15-conversation-analysis-design.md`

## 实施原则

- API Key 只存在于 Node.js 服务端。
- 文本分析状态与实时语音状态独立。
- 完整原文只来自冻结的本地字幕快照。
- 结束会话时立即停止麦克风和播放，最多只保留 1 秒字幕信令收尾。
- 每次 fresh start 使用完整 UUID `conversationId`；重连沿用，主动结束后再次开始轮换。
- 不增加数据库或新的运行时依赖；优先使用 Node 20 内置 `fetch` 和 `AbortController`。
- 先实现可测试的纯函数和服务边界，再接 UI。

## 阶段 1：服务端配置、契约与模型客户端

### 文件

- 修改 `server/config.js`
- 新建 `server/analysis.js`
- 新建 `server/analysis.test.js`
- 修改 `server/config.test.js`

### 工作

1. 增加 Qwen 3.7 Max 常量：兼容 API Base URL、模型名和 chat completions 路径。
2. 复用 `DASHSCOPE_API_KEY`，在健康检查中分别报告 realtime 与 analysis 配置。
3. 实现分析请求校验与规范化：
   - 请求体上限 512 KiB。
   - `conversationId` 必须是 UUID。
   - 最多 2,000 条字幕。
   - 单条最多 8,000 字符。
   - 规范化后总文本最多 300,000 字符。
   - 只接受 `user | assistant` 和 `completed | interrupted`。
4. 构造编号原文与严格提示词，要求 `summary`、最多 5 条 `concerns` 和有效 `evidenceSequences`。
5. 使用非流式 `chat/completions`、`enable_thinking: true`、JSON 输出和保守的 1,600 Token 输出上限。
6. 上游超时固定为 60 秒；结构解析失败以同一输入重试一次，网络/鉴权/限流不做服务端循环重试。
7. 校验并清洗模型响应，丢弃证据引用无效的关注点，不返回 reasoning content 或原始响应。
8. 定义稳定错误类型和 `retryable` 映射。

### 验证

- 测试有效请求、空字幕、非法 UUID、非法角色、条目/单条/总长度边界。
- 测试模型 JSON 解析、5 条上限、无效证据清洗、一次格式重试。
- 测试 401/403、429、超时、5xx 和网络错误映射。
- 测试序列化输出和错误对象不包含 API Key、推理内容或完整上游响应。

## 阶段 2：HTTP 路由与安全边界

### 文件

- 新建 `server/analysisRoute.js`
- 新建 `server/analysisRoute.test.js`
- 修改 `server/index.js`

### 工作

1. 在 Vite/static 中间件之前注册 `POST /api/conversation-analysis`。
2. 只为该路由启用 512 KiB JSON 解析，避免扩大其他入口攻击面。
3. 校验同源 `Origin`、JSON content type、请求契约和服务配置。
4. 调用独立分析服务并返回已清洗的成功或错误响应。
5. 给请求分配匿名 request ID；日志只记录耗时、状态和稳定错误码。
6. `/api/health` 增加 `analysisConfigured` 和分析模型名，不返回 URL 或密钥。

### 验证

- 路由测试覆盖成功、413、400、403、503 和上游错误映射。
- 开发和生产中间件顺序均能命中 API，不落到 Vite 或 SPA fallback。
- 实时 WebSocket `/realtime` 行为不变。

## 阶段 3：逻辑会话与结束快照

### 文件

- 修改 `src/hooks/useRealtimeConversation.js`
- 修改 `src/realtime/transcripts.js`
- 修改 `src/realtime/transcripts.test.js`
- 视需要新建 `src/realtime/conversationSnapshot.js`
- 新建对应测试文件

### 工作

1. 将当前 `App.jsx` 页面级短 ID 移入实时会话 hook：
   - fresh start 生成完整 UUID。
   - reconnect 保留 UUID 和字幕。
   - 主动结束后再次开始生成新 UUID。
   - UI 只展示前 4 位大写短标识。
2. 累计同一逻辑会话各活跃连接段的时长，断线等待不计时。
3. 改造 `end()`：
   - 立即设置结束门闩和 UI ended 状态。
   - 立即停止麦克风、使本地播放失效并清空队列。
   - 结束门闩期间丢弃所有音频和非字幕状态事件。
   - 最多等待 1 秒合并在途字幕，再关闭 WebSocket 和 AudioContext。
   - 把非空 `streaming` 转为 `interrupted`，丢弃空占位。
   - 返回不可变 `{ conversationId, transcript, durationSeconds, endedAt }`。
4. 组件卸载和异常清理继续立即释放全部资源，不等待分析收尾。

### 验证

- fresh start / reconnect / ended 后重启的 UUID 生命周期测试。
- 活跃分段时长累计测试。
- 结束后不再播放迟到音频，也不再切换为 speaking/listening。
- 收尾窗口能接收字幕 done；超时后 streaming 规范化正确。
- 返回快照与之后的新会话字幕互不影响。

## 阶段 4：前端分析领域与 API 状态

### 文件

- 新建 `src/analysis/api.js`
- 新建 `src/analysis/normalize.js`
- 新建 `src/analysis/markdown.js`
- 新建 `src/analysis/analysisState.js`
- 新建 `src/analysis/*.test.js`
- 新建 `src/hooks/useConversationAnalysis.js`

### 工作

1. 将冻结快照过滤并编号为服务端契约，空快照直接返回 `empty`。
2. 实现 API client 和 AbortController；解析稳定错误并保留 `retryable`。
3. 用纯 reducer 管理 `idle / generating / ready / error`、请求代次和旧响应隔离。
4. 保留最近一段 ended 会话的快照；新会话开始时仍可显示“上一会话分析”，下一段结束时替换。
5. 实现重试，始终使用同一冻结快照。
6. 管理模型原始结果、摘要编辑草稿、关注点文字草稿和已编辑标记。
7. 关注点只允许修改现有文字；ID、顺序和 evidenceSequences 不变。
8. 实现当前页签纯文本复制内容和全报告 Markdown 导出。

### 验证

- 空会话不请求。
- 一次结束只提交一次。
- ready/error/retry 和 non-retryable 状态正确。
- 旧 conversationId、旧请求代次和卸载后的响应被丢弃。
- 编辑保存/取消和关注点不可增删重排。
- Markdown 中文、文件名、已编辑标识和原文顺序正确。

## 阶段 5：中央报告弹窗与主页面入口

### 文件

- 新建 `src/components/AnalysisEntry.jsx`
- 新建 `src/components/AnalysisDialog.jsx`
- 新建 `src/components/AnalysisToolbar.jsx`
- 新建 `src/components/analysis/SummaryTab.jsx`
- 新建 `src/components/analysis/ConcernsTab.jsx`
- 新建 `src/components/analysis/OriginalTranscriptTab.jsx`
- 修改 `src/components/TranscriptPanel.jsx`
- 修改 `src/App.jsx`
- 修改 `src/styles.css`

### 工作

1. 在字幕标题区加入互斥入口：生成中、查看分析、可重试失败、不可重试不可用。
2. `App` 组合实时 hook 与分析 hook；用户结束时把返回快照传给分析 hook。
3. 实现中央深色报告弹窗，默认摘要页签，保持“信号指挥台”视觉语言。
4. 实现三个语义化页签：摘要、关注点、完整原文。
5. 关注点“查看原文”切换页签、滚动、聚焦并短暂高亮正确条目。
6. 摘要与关注点支持编辑、保存、取消和未保存离开确认；原文只读。
7. 复制当前页签；下载完整 Markdown。
8. 实现焦点圈定、Escape 关闭、关闭后焦点归还、aria-live 状态和键盘页签操作。
9. 桌面弹窗限制宽高并内部滚动；移动端接近全宽，控件换行且触控目标至少 44px。

### 验证

- 构建无 React 警告或无效 ARIA。
- 生成、成功、失败、空内容和编辑状态可视化检查。
- 320、375、768、1024、1440 px 无横向滚动和操作遮挡。
- 字幕区域继续保持固定高度、独立滚动。
- 键盘可打开、切换页签、编辑、关闭并回到入口。

## 阶段 6：回归、文档与交付

### 文件

- 修改 `.env.example`（仅在需要新增非敏感配置时）
- 修改 `README.md`
- 保留 `docs/qwen3.7max.md` 作为模型参考文档

### 工作

1. 记录分析模型、触发时机、页面内存保存边界、错误重试和环境变量。
2. 运行全部 Vitest、生产构建和 Git diff 检查。
3. 扫描仓库中的密钥、Authorization 和示例 `sk-` 值。
4. 本地启动应用，验证首次实时连接、重连、音色、静音、字幕和结束流程。
5. 使用可用 API Key 做一次真实 Qwen 3.7 Max 冒烟测试；若环境无有效密钥，明确标记为待用户验证，不伪造结果。

### 完成标准

- 自动分析、报告三页签、编辑、复制、定位、下载和失败重试全部可用。
- 结束会话后音频立即停止，分析请求不影响 WebSocket 生命周期。
- 单元测试和生产构建通过。
- 设计规格、实施计划、模型参考和用户文档齐全。
- 最终代码提交不包含密钥、临时文件或无关工作区改动。
