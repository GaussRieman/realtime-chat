# Audio Anything 本地会话存储设计规格

日期：2026-07-16
状态：用户已确认
范围：SQLite 会话持久化与历史查看

## 1. 目标

为单机运行的 Audio Anything 增加轻量持久化能力，在不保存原始音频、不引入独立数据库服务和账号系统的前提下，保存每次主动结束的会话，并允许用户在现有页面中查看最近的历史记录。

每条历史会话保存：

- 会话 ID、开始时间、结束时间和有效会话时长。
- 实际生效的千问音色。
- 用户、千问和必要系统消息组成的冻结字幕快照。
- 用户语音转写完整状态与失败次数。
- Qwen 3.7 Max 生成的摘要和关注点。
- 用户对摘要和关注点保存后的编辑结果。

### 1.1 成功标准

- 用户结束会话后，即使分析失败或用户转写缺失，基础信息和已有字幕仍能写入 SQLite。
- 同一个 `conversationId` 的重复保存或网络重试不会产生重复历史记录。
- 会话与字幕要么全部写入，要么全部回滚，不允许产生半条记录。
- 分析完成后可以补充更新同一条会话；用户保存编辑时同步更新 SQLite。
- 刷新页面或重启 Node.js 服务后，最近历史记录仍可读取。
- SQLite 不可用或单次写入失败时，实时对话和会话分析仍可使用。
- 不保存原始麦克风音频或千问回复音频。

### 1.2 非目标

- 不处理 VPS、反向代理、HTTPS、进程守护或备份自动化。
- 不增加应用内账号、用户隔离或多设备同步。
- 不提供搜索、标签、收藏、删除、批量操作或复杂统计。
- 不实现无限滚动或游标分页；第一版只读取最近 50 条。
- 不恢复上游模型上下文，也不使用历史记录继续旧会话。
- 不为用户转写额外接入独立 ASR。
- 不迁移浏览器 `sessionStorage` 中未结束或旧版本的临时字幕。

## 2. 技术选择

### 2.1 SQLite 驱动

服务端使用 Node.js 内置 `node:sqlite`，不增加第三方数据库依赖。项目运行要求从 Node.js 20 提升为 Node.js 22.13 或更高版本，避免 Node.js 22.5 至 22.12 仍需 `--experimental-sqlite` 启动参数的问题。第一版不支持更早版本，也不同时维护第三方 SQLite 驱动。

### 2.2 数据库文件

- 默认路径：`data/audio-anything.sqlite`。
- 可通过环境变量 `DATABASE_PATH` 覆盖。
- 相对路径按项目当前工作目录解析；绝对路径原样使用。
- 服务启动时创建数据库父目录和数据表。
- `data/` 加入 `.gitignore`，数据库文件不得提交到 Git。
- 应用不自动删除、重建或覆盖已有数据库。

### 2.3 SQLite 设置

每个数据库连接启用：

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

应用是单进程、低并发场景，只维持一个长生命周期数据库连接。进程退出时尽力关闭连接。

## 3. 数据模型

第一版只使用 `conversations` 和 `transcript_items` 两张业务表。数据库版本通过 `PRAGMA user_version` 管理；初始版本为 `1`。

### 3.1 `conversations`

```sql
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  voice TEXT NOT NULL,
  transcription_status TEXT NOT NULL
    CHECK (transcription_status IN ('complete', 'partial', 'unavailable')),
  transcription_failure_count INTEGER NOT NULL DEFAULT 0
    CHECK (transcription_failure_count >= 0),
  summary TEXT,
  concerns_json TEXT,
  analysis_generated_at TEXT,
  analysis_version INTEGER NOT NULL DEFAULT 0 CHECK (analysis_version >= 0),
  summary_edited INTEGER NOT NULL DEFAULT 0 CHECK (summary_edited IN (0, 1)),
  concerns_edited INTEGER NOT NULL DEFAULT 0 CHECK (concerns_edited IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX conversations_ended_at_idx
  ON conversations (ended_at DESC);
```

字段约束：

- `id` 必须是前端逻辑会话使用的 UUID。
- `started_at` 和 `ended_at` 是 Unix 毫秒时间戳；`ended_at >= started_at`。
- `duration_seconds` 是活跃会话片段累计时长，不含暂停和断线等待。
- `voice` 是本次连接实际生效的音色，而不是结束时下拉框可能已经选择的下一次音色。
- 同一 `conversationId` 断线重连时必须复用首次成功连接的 `activeVoice`；用户在会话中更改的下次音色不得影响重连。这样一条逻辑会话始终对应一个音色字段。
- `summary` 和 `concerns_json` 在分析尚未成功时为 `NULL`。
- `concerns_json` 是 JSON 数组字符串。每项结构与现有分析结果一致：`id`、`text`、`evidenceSequences`。写入前必须完成结构校验，读取后必须安全解析。
- `analysis_generated_at` 保留模型生成时间；用户编辑不会改变它。
- `analysis_version` 用于分析结果的乐观并发控制；没有分析时为 `0`，每次成功更新后加 `1`。
- `summary_edited` 和 `concerns_edited` 表示对应内容是否经过用户保存修改。

关注点不拆成第三张表，因为第一版只整组读取、整组编辑和整组导出，数量最多 5 条。将其作为受校验 JSON 保存能保持两表结构，同时避免无收益的关联写入。

### 3.2 `transcript_items`

```sql
CREATE TABLE transcript_items (
  conversation_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  analysis_sequence INTEGER,
  item_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  text TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('completed', 'interrupted', 'error')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (conversation_id, sequence),
  UNIQUE (conversation_id, analysis_sequence),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX transcript_items_item_id_idx
  ON transcript_items (conversation_id, item_id);
```

规则：

- `sequence` 来自包含系统消息的完整冻结快照显示顺序，从 1 开始连续编号。
- `analysis_sequence` 只为可参与分析的非空 `user` 和 `assistant` 条目编号，从 1 开始连续递增；系统消息和不可分析状态为 `NULL`。
- `analysis_sequence` 必须与现有 `createAnalysisPayload()` 和原文报告使用的序号完全一致，`evidenceSequences` 只引用这个命名空间，不能引用完整历史的 `sequence`。
- 保存所有非空字幕，包括现有界面中的系统连接消息和错误提示；分析仍只消费 `user` 与 `assistant`。
- 空文本不入库。
- 结束时仍为 `streaming` 的条目先按现有规则转为 `interrupted`，数据库不接受 `streaming`。
- 历史详情严格按 `sequence ASC` 返回，不依赖时间戳重新排序。

### 3.3 转写状态

实时 hook 需要统计当前逻辑会话收到的 `conversation.item.input_audio_transcription.failed` 次数，并在会话快照中返回 `transcriptionFailureCount`。

状态计算：

```text
failureCount = 0                         -> complete
failureCount > 0 且至少有一条 user 字幕  -> partial
failureCount > 0 且没有 user 字幕        -> unavailable
```

该状态只描述用户语音转写完整性，不代表千问是否理解音频，也不阻止会话保存或分析现有内容。

## 4. 服务端边界

### 4.1 存储模块

新增独立存储模块，职责限定为：

- 解析数据库路径并初始化目录。
- 打开 SQLite、应用 PRAGMA 和版本迁移。
- 验证并保存会话快照。
- 更新分析结果。
- 读取最近会话列表和单条详情。
- 将 SQLite 异常转换为稳定的存储错误。

Express 路由不直接包含 SQL。实时 WebSocket 代理和分析模型调用也不直接访问数据库。

### 4.2 启动降级

服务启动时尝试初始化存储：

- 成功：历史和写入 API 正常开放。
- 失败：记录不含密钥和会话正文的服务端错误；实时代理、分析接口和静态页面继续启动。
- `/api/health` 增加 `storageConfigured` 布尔值。
- 存储不可用时，存储 API 返回 `503 STORAGE_UNAVAILABLE`。

不会因为数据库路径权限、磁盘故障或迁移失败而终止整个服务。

## 5. API 设计

所有接口保持同源，沿用现有允许来源策略，并使用 JSON。UUID、枚举、长度、时间戳、数组数量和请求体大小必须在服务端验证，不能信任浏览器状态。

### 5.1 保存会话

`POST /api/conversations`

请求示例：

```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "startedAt": 1784196000000,
  "endedAt": 1784196120000,
  "durationSeconds": 95,
  "voice": "longanqian",
  "transcriptionFailureCount": 2,
  "transcript": [
    {
      "id": "system-1",
      "role": "system",
      "text": "声音链路已建立，可以直接开始说话",
      "status": "completed",
      "startedAt": 1784196001000,
      "completedAt": 1784196001000
    },
    {
      "id": "assistant-1",
      "role": "assistant",
      "text": "你好，有什么我可以帮你的吗？",
      "status": "completed",
      "startedAt": 1784196005000,
      "completedAt": 1784196009000
    }
  ]
}
```

保存语义：

1. 规范化并验证完整请求。
2. 计算 `transcription_status`，不接受客户端直接指定状态。
3. 开启事务。
4. 按 `conversationId` 插入或更新会话基础字段，但保留已经存在的分析字段。
5. 删除该会话已有字幕并按当前冻结快照重新插入。
6. 提交事务。

这使接口具备幂等性：同一个结束快照重复提交不会重复记录；如果第一次响应在客户端收到前丢失，重试仍得到同一结果。事务失败时必须完整回滚。

成功返回：

```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "saved": true,
  "transcriptionStatus": "unavailable"
}
```

### 5.2 更新分析

`PATCH /api/conversations/:conversationId/analysis`

模型结果保存请求：

```json
{
  "summary": "本次对话主要讨论了……",
  "concerns": [],
  "generatedAt": "2026-07-16T07:30:00.000Z",
  "expectedVersion": 0,
  "summaryEdited": false,
  "concernsEdited": false
}
```

用户编辑保存使用同一接口和完整当前值，将对应的 `Edited` 标志设为 `true`，并携带最近一次成功响应返回的 `expectedVersion`。更新采用整组替换，不提供关注点局部修改接口。

规则：

- 会话不存在时返回 `404 CONVERSATION_NOT_FOUND`，不能隐式创建没有字幕的会话。
- 摘要必须是非空、受长度限制的字符串。
- 关注点最多 5 条；`id`、文字和证据序号必须满足现有分析契约。
- 用户编辑关注点时仍不得改变 `id`、顺序或 `evidenceSequences`；服务端将请求与已保存结构比较并拒绝结构变化。
- 模型生成的首次保存允许建立关注点结构；后续更新只允许修改摘要和关注点文字。
- 服务端使用 `UPDATE ... WHERE id = ? AND analysis_version = ?` 原子更新并把版本加 `1`。版本不匹配返回 `409 ANALYSIS_VERSION_CONFLICT`，不得覆盖现有内容。
- 成功响应返回新的 `analysisVersion`。
- 更新失败不得清空已有分析字段。

### 5.3 历史列表

`GET /api/conversations`

第一版固定返回按 `ended_at DESC` 排序的最近 50 条，不接收分页、搜索或排序参数。

每项只返回列表所需字段：

```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "endedAt": 1784196120000,
  "durationSeconds": 95,
  "voice": "longanqian",
  "transcriptionStatus": "unavailable",
  "summaryPreview": "本次对话主要讨论了……",
  "hasAnalysis": true
}
```

`summaryPreview` 由服务端从摘要生成有限长度的单行预览；列表不返回完整字幕或关注点 JSON。

### 5.4 历史详情

`GET /api/conversations/:conversationId`

返回会话全部元信息、分析结果、`analysisVersion`、编辑标记和按 `sequence` 排序的完整字幕。不存在时返回 `404 CONVERSATION_NOT_FOUND`。

响应示例：

```json
{
  "conversationId": "550e8400-e29b-41d4-a716-446655440000",
  "startedAt": 1784196000000,
  "endedAt": 1784196120000,
  "durationSeconds": 95,
  "voice": "longanqian",
  "transcriptionStatus": "partial",
  "transcriptionFailureCount": 1,
  "analysisVersion": 2,
  "analysis": {
    "summary": "本次对话主要讨论了……",
    "concerns": [
      {
        "id": "concern-1",
        "text": "仍需确认具体时间。",
        "evidenceSequences": [1]
      }
    ],
    "generatedAt": "2026-07-16T07:30:00.000Z",
    "summaryEdited": true,
    "concernsEdited": false
  },
  "transcript": [
    {
      "id": "system-1",
      "sequence": 1,
      "analysisSequence": null,
      "role": "system",
      "text": "声音链路已建立，可以直接开始说话",
      "status": "completed",
      "startedAt": 1784196001000,
      "completedAt": 1784196001000
    },
    {
      "id": "user-1",
      "sequence": 2,
      "analysisSequence": 1,
      "role": "user",
      "text": "下周开始可以吗？",
      "status": "completed",
      "startedAt": 1784196003000,
      "completedAt": 1784196004000
    }
  ]
}
```

历史详情是只读接口。第一版不提供删除或覆盖字幕的 API。

### 5.5 错误结构

存储接口使用统一错误格式：

```json
{
  "error": {
    "code": "CONVERSATION_SAVE_FAILED",
    "message": "本次会话暂时无法保存，请重试。",
    "retryable": true
  }
}
```

至少区分：

- `STORAGE_UNAVAILABLE`：数据库未初始化成功，`503`，可重试。
- `CONVERSATION_INVALID`：请求无效，`400`，不可重试。
- `CONVERSATION_TOO_LARGE`：请求体或字幕数量超限，`413`，不可重试。
- `CONVERSATION_NOT_FOUND`：目标会话不存在，`404`，不可重试。
- `ANALYSIS_VERSION_CONFLICT`：分析版本已变化，`409`，需要重新读取详情后再保存。
- `CONVERSATION_SAVE_FAILED`：事务或磁盘写入失败，`500`，可重试。
- `CONVERSATION_READ_FAILED`：查询失败，`500`，可重试。

错误响应和日志不得包含 API Key、完整字幕、摘要正文或 SQLite 内部路径细节。

## 6. 前端保存时序

### 6.1 结束会话

用户主动结束时：

1. `useRealtimeConversation.end()` 按现有逻辑冻结字幕，并额外返回 `startedAt`、实际 `voice` 和 `transcriptionFailureCount`。
2. 前端立即调用 `POST /api/conversations` 保存基础信息和字幕。
3. 保存与分析互不阻塞：两项都以同一不可变快照为输入，可以并行开始。
4. 基础保存成功后记录本会话已经持久化；失败时保留快照和错误，显示“本次记录未保存 · 重试”。
5. 分析成功后把模型结果加入该 `conversationId` 的持久化写入队列；若基础保存仍在进行，先等待其完成，再以 `expectedVersion: 0` 保存模型结果。
6. 分析失败不删除基础记录；当前页面继续提供现有分析重试。

### 6.2 用户编辑分析

现有分析弹窗中的“保存”先更新本地 reducer，再调用分析更新接口：

- 每个 `conversationId` 只有一个串行持久化写入队列。模型结果保存必须排在用户编辑保存之前，不能并行发送。
- 只有模型结果首次持久化成功并获得 `analysisVersion` 后，后续用户编辑才可写入 SQLite。此前用户仍可本地编辑，但历史保存状态显示等待或失败，不能伪装成已经持久化。
- SQLite 更新成功后显示已保存状态。
- SQLite 更新失败时保留本地编辑内容，并提示“编辑尚未写入历史 · 重试”。
- 失败不能自动恢复成模型原文，也不能关闭弹窗。
- 如果收到 `409 ANALYSIS_VERSION_CONFLICT`，停止自动重试并重新读取历史详情；不得用旧页面状态覆盖数据库中的较新分析。

### 6.3 保存状态隔离

保存状态按 `conversationId` 隔离。用户可以在上一会话保存或分析仍进行时开始下一会话；旧请求完成后只能更新对应历史记录，不能覆盖当前会话状态。

## 7. 历史界面

### 7.1 入口与容器

- 在现有顶栏增加“历史”入口。
- 点击后打开中央历史弹窗，沿用当前分析报告的深色信号控制台视觉。
- 不增加前端路由，不改变实时对话主页面布局。
- `storageConfigured: false` 时入口禁用并显示存储不可用说明。

### 7.2 桌面端

- 左侧显示最近 50 条会话列表。
- 右侧显示选中会话详情。
- 首次打开默认选中最新一条；没有记录时显示空状态。
- 列表项显示结束时间、有效时长、音色、摘要首行和转写状态。

### 7.3 移动端

- 首屏显示会话列表。
- 点击列表项进入详情视图。
- 详情提供明确的返回列表操作。
- 交互目标不小于 44 × 44 CSS 像素。

### 7.4 详情内容

历史详情复用“摘要”“关注点”“完整原文”三个页签的展示组件，但保持只读：

- 不显示编辑、保存或取消按钮。
- 允许复制当前页签和下载 Markdown。
- 没有分析时，摘要和关注点页签显示“本次会话暂无分析结果”，完整原文仍可查看。
- `partial` 显示“部分用户语音未能转写”；`unavailable` 显示“本次用户语音转写不可用”。
- 转写提示不能暗示千问没有理解音频，只描述历史文本可能不完整。

### 7.5 加载状态

- 列表加载中显示轻量占位，不阻塞实时会话。
- 列表或详情失败时保留弹窗并提供重试。
- 切换详情时丢弃或忽略前一个详情请求的迟到响应。
- 每次打开历史弹窗重新获取列表，确保新结束的会话可见。

## 8. 数据限制与安全

服务端限制应集中配置，并至少覆盖：

- 会话保存请求体上限为 1 MiB；分析更新请求体上限为 256 KiB。
- 单次会话最多保存 2,000 条字幕。
- 单条字幕文本最多 16,000 个 Unicode 字符。
- 摘要最多 20,000 个 Unicode 字符；单条关注点最多 4,000 个 Unicode 字符。
- 关注点最多 5 条，证据序号必须是正整数且指向存在的 `analysis_sequence`。
- 不接受未知角色、未知状态、非法 UUID、非有限时间戳或负时长。
- SQL 只使用预编译语句，禁止字符串拼接用户输入。
- API 返回数据库数据前再次规范化 JSON 字段，损坏的 `concerns_json` 不得导致整个服务崩溃。

数据库包含对话正文，运行环境应把文件目录视为私有持久数据；具体部署权限、备份和公网访问保护不在本规格范围内。

## 9. 测试策略

### 9.1 存储单元测试

使用临时目录中的独立 SQLite 文件验证：

- 首次启动建库、PRAGMA 和 `user_version = 1`。
- 重复初始化不破坏已有记录。
- 保存完整会话和字幕顺序。
- 同一 `conversationId` 重复保存不产生重复记录。
- 字幕插入失败时会话和字幕全部回滚。
- 重试保存基础快照时保留已经存在的分析字段。
- `complete`、`partial`、`unavailable` 状态计算。
- 分析首次保存和用户编辑更新。
- 分析版本冲突不会覆盖较新内容。
- 模型结果与用户编辑的持久化写入严格串行。
- 用户编辑不能改变关注点结构或证据序号。
- 最近 50 条按结束时间倒序返回。
- 详情按 `sequence` 返回字幕。
- 损坏 JSON、非法 UUID、空摘要、超长内容和不存在会话的错误处理。
- 数据库不可写、被锁或初始化失败时的稳定错误映射。

### 9.2 路由测试

覆盖：

- 保存、分析更新、列表和详情的成功响应。
- Origin、JSON 解析、请求体大小和字段验证。
- 存储不可用的 `503` 降级。
- 错误响应不泄露正文或内部路径。

### 9.3 前端测试

纯逻辑测试覆盖：

- 会话快照转换为保存载荷。
- 保存与分析请求按 `conversationId` 隔离。
- 保存失败后的重试状态。
- 历史列表和详情响应规范化。
- 转写状态文案。

界面手动验收覆盖桌面端和移动端的历史弹窗、空状态、只读详情、复制、下载、失败重试和新会话出现。

### 9.4 回归要求

- 现有实时语音、暂停/继续、主动结束和分析测试全部通过。
- `npm test` 和 `npm run build` 通过。
- 使用 Node.js 22.13 或更高版本执行一次真实 SQLite 建库、保存、重启和读取验证。

## 10. 验收场景

- 完整用户字幕会话结束后，历史中出现一条 `complete` 记录，字幕和分析可在重启后查看。
- 部分用户转写失败时，已有用户字幕和千问字幕保存，历史显示 `partial`。
- 所有用户转写失败但千问正常回应时，会话仍保存，历史显示 `unavailable`。
- 分析接口失败时，历史原文仍存在；之后分析重试成功可补充更新同一记录。
- 用户编辑摘要或关注点并保存后，重新打开历史显示编辑后的内容。
- 同一保存请求重复发送不会出现两条历史记录。
- 保存事务中途失败不会留下缺字幕的会话记录。
- SQLite 初始化失败时，实时对话和分析仍可用，历史入口明确不可用。
- 单次保存失败时，当前会话快照仍保留并可重试。
- 历史弹窗最多展示最近 50 条，按结束时间从新到旧排序。
