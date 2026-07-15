
logo
模型
应用
订阅
Token Plan
体验
文档
API 参考


华北2（北京）
默认业务空间
逐云者123
主账号
avatar
模型广场
模型体验
文本模型
语音模型
视觉模型
全模态模型
向量模型
模型推理
TPM预留
模型训练
数据管理
模型调优
我的模型
模型评测
模型压缩
工作台
批量推理
模型部署
模型监控
模型告警
限流提额
用量 & 费用
权限管理
API Key
模型广场
/
Qwen3.7-Max
Qwen3.7-Max

中国内地
模型Code
模型介绍

qwen3.7
深度思考
文本生成
Qwen3.7系列中规模最大、综合能力最强的Max模型，当前开放纯文本模型能力供体验。Qwen3.7是面向智能体时代的新一代旗舰模型，核心优势在于智能体能力的广度与深度：在编程、办公与生产力、长周期自主执行方面均能出色胜任各项任务。

该模型版本功能等同于快照模型qwen3.7-max-2026-05-20

模型能力
输入模态
模型体验
function calling
结构化输出
联网搜索
输出模态
前缀续写
cache缓存
批量推理
模型调优
模型价格
输入
限时5折
原价12
元/每百万tokens
输入（缓存命中）
限时5折
原价2.4
元/每百万tokens
输入（Batch File）
6
元/每百万tokens
显式缓存创建
限时5折
原价15
元/每百万tokens
显式缓存命中
限时5折
原价1.2
元/每百万tokens
输入（Batch Chat)
限时5折
原价12
元/每百万tokens
输出
限时5折
原价36
元/每百万tokens
输出（Batch File）
18
元/每百万tokens
输出（Batch Chat)
限时5折
原价36
元/每百万tokens
工具调用价格
code_interpreter
Responses API
限时免费
web_extractor
Responses API
限时免费
web_search
Responses API
4
元/千次调用
免费额度
免费额度用完即停
100%
剩余
0%10%50%100%
过期时间：2026/08/20
1,000,000/1,000,000
模型限流与上下文
最大输入长度
991K
RPM
30000
最大输入长度(思考模式下)
983K
上下文长度
1M
最大输出长度
64K
TPM
5000000
最大输出长度(思考模式下)
64K
最大思维链长度
256K
API代码示例

OpenAI兼容

DashScope
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
⌄
⌄
⌄
⌄
⌄
⌄
from openai import OpenAI
import os

client = OpenAI(
    # 如果没有配置环境变量，请用阿里云百炼API Key替换：api_key="sk-xxx"
    api_key=os.getenv("DASHSCOPE_API_KEY"),
    base_url="https://llm-vdcmboq80tbpljv5.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
)

messages = [{"role": "user", "content": "你是谁"}]
completion = client.chat.completions.create(
    model="qwen3.7-max",  # 您可以按需更换为其它深度思考模型
    messages=messages,
    extra_body={"enable_thinking": True},
    stream=True
)
is_answering = False  # 是否进入回复阶段
print("\n" + "=" * 20 + "思考过程" + "=" * 20)
for chunk in completion:
    if not chunk.choices:
        continue
    delta = chunk.choices[0].delta
    if hasattr(delta, "reasoning_content") and delta.reasoning_content is not None:
        if not is_answering:
            print(delta.reasoning_content, end="", flush=True)
    if hasattr(delta, "content") and delta.content:
        if not is_answering:
            print("\n" + "=" * 20 + "完整回复" + "=" * 20)
            is_answering = True
        print(delta.content, end="", flush=True)


我的资源
我的收藏
产品与服务
全部
人工智能与机器学习
计算
容器
存储
网络与CDN
安全
中间件
数据库
大数据计算
媒体服务
企业服务与云通信
域名与网站
终端用户计算
物联网
开发工具
迁移与运维管理
云市场
支持与服务
我的资源
最近访问
•
大模型服务平台百炼
•
费用与成本
•
云解析DNS
•
轻量应用服务器
•
域名与网站
•
访问控制 RAM
migrationom
迁移与运维管理
访问控制 RAM
1
角色

