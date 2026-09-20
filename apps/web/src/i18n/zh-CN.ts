/**
 * zh-CN dictionary — UI copy translations, keyed by the English source.
 *
 * Conventions:
 * - Keys are the exact English UI strings (the `en` locale renders them as-is).
 * - Technical identifiers (backend ids like `openwakeword`, protocol names,
 *   file formats, units) stay in English inside the translated text.
 * - Missing keys fall back to English (partial coverage is safe).
 */

export const ZH_CN: Record<string, string> = {
  // ---- Shell: sidebar navigation ----
  Workspace: '工作区',
  'Model Registry': '模型注册表',
  Training: '训练',
  Datasets: '数据集',
  Backends: '后端',
  Projects: '项目',
  Console: '控制台',
  'Device SDK': '设备 SDK',
  Settings: '设置',
  General: '常规',
  Security: '安全',
  'Cloud storage': '云存储',
  Data: '数据',
  Studio: '工作室',
  Platform: '平台',
  soon: '即将上线',
  'on-device KWS studio': '端侧 KWS 工作室',
  'console shell': '控制台外壳',

  'Settings · expanded': '设置（已展开）',
  'Settings · collapsed': '设置（已折叠）',

  // ---- Shell: top bar ----
  'Session Console': '会话控制台',
  'RNNoise Playground': 'RNNoise 演练场',
  'Settings · General': '设置 · 常规',
  'Settings · Security': '设置 · 安全',
  'Settings · Data': '设置 · 数据',
  'Settings · Cloud storage': '设置 · 云存储',
  'Settings · Modules': '设置 · 模块',
  Theme: '主题',
  Light: '浅色',
  Dark: '深色',
  System: '跟随系统',
  'Toggle navigation': '切换导航',
  'Close navigation': '关闭导航',
  Navigation: '导航',
  'Primary navigation': '主导航',
  'Wake!': '唤醒！',
  'Stop pipeline': '停止管线',
  'Minimize pipeline status': '最小化管线状态',
  'Show pipeline status': '显示管线状态',

  // ---- Settings: general ----
  Language: '语言',
  'UI language. Stored now; i18n lands in Phase 6.':
    '界面语言。选择后立即生效并保存。',
  'Console appearance. "System" follows your OS light/dark preference.':
    '控制台外观。“跟随系统”会遵循操作系统的浅色/深色偏好。',
  'Accent color': '强调色',
  'Accent theme (Radix Colors scales). Gray is the default; Sky is the classic WakeStudio look.':
    '强调色主题（Radix Colors 色阶）。默认为灰色；天蓝是 WakeStudio 的经典配色。',
  Jade: '碧绿',
  Gray: '灰色',
  Indigo: '靛蓝',
  Orange: '橙色',
  Mint: '薄荷',
  Sky: '天蓝',
  'KWS execution provider': 'KWS 执行后端',
  'onnxruntime-web execution provider. WebGPU-first with WASM fallback.':
    'onnxruntime-web 执行后端。优先 WebGPU，WASM 作为回退。',
  'WebGPU (faster)': 'WebGPU（更快）',
  'WASM (universal)': 'WASM（通用）',
  'Settings saved': '设置已保存',
  'Unsaved changes': '有未保存的更改',
  'All changes saved': '所有更改已保存',
  Save: '保存',
  Save_: '保存',

  // ---- Settings: sections ----
  'Console-wide appearance and runtime defaults. Changes apply on Save.':
    '控制台范围的外观与运行时默认值。保存后生效。',
  'Backend connection + credentials. Stored locally only; never sent. Changes apply on Save.':
    '后端连接与凭据。仅存储在本地，绝不发送。保存后生效。',
  'Local data preferences and future data-source gates. Changes apply on Save.':
    '本地数据偏好与未来的数据源开关。保存后生效。',
  'Optional cloud storage credentials for datasets. Masked secrets, stored locally only; backend push jobs receive them as job-scoped env, never persisted. Changes apply on Save.':
    '数据集的可选云存储凭据。密钥以掩码显示，仅存储在本地；后端推送任务以任务级环境变量的方式接收，永不落盘。保存后生效。',
  'Per-driver defaults from the module specs. The active project can override these per project. Changes apply on Save.':
    '来自模块规格的各驱动默认值。当前项目可以在项目级别覆盖这些值。保存后生效。',
  'Module settings': '模块设置',
  'Credentials never leave this browser. Changes apply on Save.':
    '凭据绝不离开此浏览器。保存后生效。',
  'Cloud keys are optional. They stay in this browser, are masked on export, and are passed to backend dataset push jobs as job-scoped env only — never persisted (Q-DS-3).':
    '云端密钥为可选项。它们只保留在此浏览器中，导出时被掩码，并且只以任务级环境变量的方式传给后端数据集推送任务——永不落盘（Q-DS-3）。',

  // ---- Settings: security ----
  'API key': 'API 密钥',
  'Fallback credential for Colab tunnel jobs (the notebook service token). Managed backends carry their own token. Stored locally only, never sent to a WakeStudio server, never logged or exported.':
    'Colab 隧道任务的备用凭据（即笔记本服务令牌）。托管后端自带令牌。仅存储在本地，绝不发送到 WakeStudio 服务器，也绝不记录或导出。',
  Secret: '共享密钥',
  'Fallback shared secret for Colab tunnel jobs. Same storage guarantees as the API key.':
    'Colab 隧道任务的备用共享密钥。存储保障与 API 密钥相同。',

  // ---- Settings: cloud ----
  'Hugging Face token': 'Hugging Face 令牌',
  'Token for the Hugging Face dataset-repo storage backend (authKey "cloud.hf"). Stored locally only; passed to backend push jobs as job-scoped env.':
    'Hugging Face 数据集仓库存储后端的令牌（authKey “cloud.hf”）。仅存储在本地；以任务级环境变量的方式传给后端推送任务。',
  'R2 access key ID': 'R2 访问密钥 ID',
  'Cloudflare R2 (S3-compatible) access key id (authKey "cloud.r2").':
    'Cloudflare R2（S3 兼容）访问密钥 ID（authKey “cloud.r2”）。',
  'R2 secret access key': 'R2 私有访问密钥',
  'Cloudflare R2 secret access key (authKey "cloud.r2").':
    'Cloudflare R2 私有访问密钥（authKey “cloud.r2”）。',
  'R2 endpoint': 'R2 端点',
  'Cloudflare R2 S3-compatible endpoint, e.g. https://<account>.r2.cloudflarestorage.com':
    'Cloudflare R2 S3 兼容端点，例如 https://<account>.r2.cloudflarestorage.com',
  'R2 bucket': 'R2 存储桶',
  'Cloudflare R2 bucket name holding datasets.': '存放数据集的 Cloudflare R2 存储桶名称。',
  'Google Drive client ID': 'Google Drive 客户端 ID',
  'Google Drive OAuth client id (authKey "cloud.gdrive").':
    'Google Drive OAuth 客户端 ID（authKey “cloud.gdrive”）。',
  'Google Drive client secret': 'Google Drive 客户端密钥',
  'Google Drive OAuth client secret (authKey "cloud.gdrive").':
    'Google Drive OAuth 客户端密钥（authKey “cloud.gdrive”）。',

  // ---- Settings: data ----
  'Allow data upload': '允许数据上传',
  'Gate for the pluggable data-source layer. Off by default; audio generation runs in backends, not WASM.':
    '可插拔数据源层的开关。默认关闭；音频生成在后端运行，而非 WASM。',
  'Data retention': '数据保留',
  'Future export/cleanup policy for local artifacts.': '本地产物的导出/清理策略（即将推出）。',
  'Keep local data': '保留本地数据',
  'Session only': '仅本次会话',
  'Export then delete': '导出后删除',
  'Remember mic permission': '记住麦克风授权',
  'Anchor for the mic permission prompt flow (the browser owns the real permission).':
    '麦克风授权提示流程的锚点（真正的授权由浏览器管理）。',
  'Params from the driver module spec. Changes apply on Save; per-project overrides live in the project snapshot.':
    '来自驱动模块规格的参数。保存后生效；项目级覆盖保存在项目快照中。',
  active: '使用中',

  // ---- Coming soon / placeholders ----
  'Coming soon': '即将推出',
  'Export kits and device-side SDK tooling for your target chips arrive in Phase 4.':
    '面向目标芯片的导出套件与设备端 SDK 工具将在第 4 阶段推出。',

  // ---- Model Registry ----
  'Models are never bundled with the app — they are fetched lazily from the registry. License + commercial flags drive the export gate.':
    '模型永远不会随应用打包——它们从注册表按需懒加载。许可与商用标志驱动导出门禁。',

  // ---- Backends ----
  'Your studio-backend endpoints for the Studio-backend train method. Health is checked automatically; kind (long-term / short-term) is detected from the service. Jobs and logs here are read-only — train and control jobs from the Training view.':
    'Studio-backend 训练方式的 studio-backend 端点。会自动检查健康状态；服务类型（长期 / 短期）由服务自动识别。此处的任务与日志只读——请在训练视图中提交和控制任务。',
  'New backend': '新建后端',
  'Free on Google Colab': '在 Google Colab 上免费运行',
  'A short-term studio-backend on a free Colab runtime behind a trycloudflare tunnel — no server, no keys, only your Google account.':
    '在免费的 Colab 运行时上通过 trycloudflare 隧道搭建的短期 studio-backend——无需服务器、无需密钥，只要你的 Google 账号。',
  'Access token': '访问令牌',
  '(optional; for job mutations)': '（可选；用于任务操作）',

  // ---- Training ----
  'Train a custom model end to end: pick a trainable module, configure it, choose a train method (Colab / Studio-backend / CI), then review the run. Training never runs in the browser.':
    '端到端训练自定义模型：选择可训练模块、完成配置、选择训练方式（Colab / Studio-backend / CI），然后审阅运行。训练从不在浏览器中进行。',

  // ---- Datasets ----
  'First-class training-data artifacts: pick built-ins, generate synthetic audio with a TTS engine, and persist to the backend store and/or your cloud. Every dataset is one canonical wake-studio-dataset.zip.':
    '一等公民的训练数据产物：选择内置数据集、用 TTS 引擎生成合成音频，并持久化到后端存储和/或你的云端。每个数据集都是一个规范的 wake-studio-dataset.zip。',

  // ---- Workspace: stage cards ----
  'Passthrough for v1; the real engine + persistence wiring lands with it.':
    'v1 中为直通；真正的引擎与持久化接线将随其一同落地。',
  'Passthrough for v1; single-mic pipeline. Persistence lands with the real engine.':
    'v1 中为直通；单麦克风管线。持久化将随真正的引擎落地。',
  'The only real DSP core in v1 — AEC/BSS are passthrough until the real engines land.':
    'v1 中唯一真正的 DSP 核心——在真正的引擎落地之前，AEC/BSS 均为直通。',
  'Pluggable KWS backend running in a Web Worker': '运行在 Web Worker 中的可插拔 KWS 后端',

  // ---- KWS panel ----
  'KWS detection': 'KWS 检测',
  'Pluggable KWS backend running in a Web Worker. Pick a backend below; models load from the platform registry. openWakeWord (hey-buddy, mel-spectrogram -> speech-embedding -> classifier) is the default; PLiX Few-Shot adds custom wake-word enrollment. VAD gating via AFE RNNoise VAD.':
    '运行在 Web Worker 中的可插拔 KWS 后端。在下方选择后端；模型从平台注册表加载。openWakeWord（hey-buddy，梅尔频谱 -> 语音嵌入 -> 分类器）为默认；PLiX Few-Shot 支持自定义唤醒词注册。VAD 门控由 AFE RNNoise VAD 提供。',
  Backend: '后端',
  'Wake words': '唤醒词',
  Engine: '引擎',
  'Load models': '加载模型',
  'Reload models': '重新加载模型',
  'Start detection': '开始检测',
  'Stop detection': '停止检测',
  'Loading models…': '正在加载模型……',
  'Start the AFE microphone first': '请先启动 AFE 麦克风',
  'Warming up… (collecting ~2 s of audio context)': '预热中……（正在收集约 2 秒的音频上下文）',
  'Models loaded · EP:': '模型已加载 · 执行后端：',
  'Encoder loaded — record samples to enroll': '编码器已加载——录制样本以完成注册',
  'Detection running': '检测运行中',
  'Load failed — check the registry / assets': '加载失败——请检查注册表 / 资源',
  Resources: '资源',
  'Model sources': '模型来源',
  'Pick the pretrained model per role (built-in registry), a saved model from your library, a local file, or a custom URL. Saved models are stored in your browser (IndexedDB) and can be exported back to disk. Applied on the next Load/Reload.':
    '为每个角色选择预训练模型（内置注册表）、模型库中已保存的模型、本地文件或自定义 URL。已保存的模型存放在浏览器（IndexedDB）中，也可以导出回磁盘。在下次加载/重新加载时生效。',
  "This backend's model is bundled in its wasm runtime — there are no model sources to pick. See the Engine card's resources (sherpa-onnx KWS wasm runtime + wake-word list).":
    '该后端的模型已打包进其 wasm 运行时——没有可选的模型来源。请查看引擎卡片中的资源（sherpa-onnx KWS wasm 运行时 + 唤醒词列表）。',
  'Built-in': '内置',
  'Saved models': '已保存的模型',
  Export: '导出',
  Delete: '删除',
  'Import local file…': '导入本地文件……',
  'Custom URL — will be fetched as-is on Load.': '自定义 URL——加载时按原样获取。',
  'Saved model — loaded from your browser library on Load.': '已保存的模型——加载时从浏览器模型库读取。',
  Provisioning: '唤醒词供应',
  '(keyword-list backend — edit the wake words below, then load with the list)':
    '（关键词列表后端——在下方编辑唤醒词，然后用该列表加载）',
  '(enroll a custom wake word, then detect)': '（注册自定义唤醒词，然后进行检测）',
  'The keyword list above is the wake-word artifact:':
    '上方的关键词列表即唤醒词产物：',
  'wake word(s) will be loaded with the keyword-list artifact.':
    '个唤醒词将随关键词列表产物一起加载。',
  'enter at least one wake word to load.': '请至少输入一个唤醒词再加载。',
  'Record sample': '录制样本',
  'Build prototype': '构建原型',
  'Building…': '构建中……',
  'samples recorded': '个样本已录制',
  'Negative samples': '负样本',
  '(optional — other words / background, for open-set rejection)':
    '（可选——其他词语 / 背景语音，用于开集拒识）',
  'Record non-target sample': '录制非目标样本',
  'Re-enroll negative prototype': '重新注册负样本原型',
  'Build negative prototype': '构建负样本原型',
  samples: '个样本',
  'Few-Shot detection parameters': 'Few-Shot 检测参数',
  'Configuration': '配置',
  '(backend · Primary)': '（后端 · 主要）',
  'Tunable parameters': '可调参数',
  'Advanced': '高级',
  driver: '驱动',
  'Confirm?': '确认？',
  'Open in Colab': '在 Colab 中打开',

  // ---- Module settings (spec-driven labels, host-side) ----
  'KWS backend': 'KWS 后端',
  'OpenWakeWord (available)': 'OpenWakeWord（可用）',
  'micro-wake-word (MCU / Phase 5)': 'micro-wake-word（MCU / 第 5 阶段）',
  'PLiX Few-Shot (Phase 3)': 'PLiX Few-Shot（第 3 阶段）',
  'sherpa-onnx KWS (available)': 'sherpa-onnx KWS（可用）',
  'PocketSphinx (pending)': 'PocketSphinx（待支持）',
  'Trigger threshold': '触发阈值',
  'Min. duration': '最短时长',
  'Smoothing window': '平滑窗口',
  'VAD gate': 'VAD 门控',
  'VAD threshold': 'VAD 阈值',
  Cooldown: '冷却时间',
  'Execution provider': '执行后端',
  'Distance threshold': '距离阈值',
  'Detection window': '检测窗口',
  'Inference hop': '推理步长',
  'Negative prototype': '负样本原型',
  'Silence gate (dBFS RMS)': '静音门限（dBFS RMS）',
  Topology: '拓扑结构',
  'Single worklet (default)': '单 worklet（默认）',
  'Node per stage': '每阶段一个节点',

  // ---- Misc UI verbs ----
  New: '新建',
  Next: '下一步',
  Back: '上一步',
  Review: '审阅',
  Setup: '准备',
  'Save & close': '保存并关闭',
  Cancel: '取消',
  Close: '关闭',
  Yes: '是',
  No: '否',
  OK: '确定',
  'Loading…': '加载中……',
  Error: '错误',
  Name: '名称',
  Status: '状态',
  Actions: '操作',
  Type: '类型',
  Size: '大小',
  Created: '创建时间',
  'Wake word': '唤醒词',
  'Wake word (label)': '唤醒词（标签）',
  'Wake words (comma-separated)': '唤醒词（逗号分隔）',

  // ---- Projects ----
  'Wake-word projects: target word, domain, config snapshots, samples and prototypes. Select one to inspect; create new projects from the Workspace.':
    '唤醒词项目：目标唤醒词、领域、配置快照、样本与原型。选择一个进行查看；从工作区新建项目。',
  'No projects yet — create one from the Workspace.': '还没有项目——从工作区创建一个。',
  'no wake word': '无唤醒词',
  'Target chip': '目标芯片',
  Samples: '样本',
  Prototypes: '原型',
  Updated: '更新时间',
  'Edit samples, config and prototypes from the Workspace — this panel is read-only.':
    '样本、配置与原型请从工作区编辑——此面板为只读。',
  Operations: '操作',
  'Delete this project and its stored config, samples and prototypes.':
    '删除该项目及其存储的配置、样本和原型。',
  'No project selected': '未选择项目',
  'Pick a project from the left to inspect it (wake word, target, samples, prototypes). Create new projects from the Workspace.':
    '从左侧选择一个项目查看详情（唤醒词、目标、样本、原型）。从工作区创建新项目。',
  'Delete this project?': '删除该项目？',
  'Deletes the project and its stored config, samples and prototypes. This cannot be undone.':
    '将删除该项目及其存储的配置、样本和原型。此操作不可撤销。',

  // ---- Session Console ----
  'Session log cleared': '会话日志已清空',
  'Triggers exported': '触发记录已导出',
  'trigger(s)': '条触发',
  'Live event log + wake-word trigger history. Events are captured app-wide (Phase 4).':
    '实时事件日志 + 唤醒词触发历史。事件为全应用捕获（第 4 阶段）。',
  Clear: '清空',
  'Export triggers CSV': '导出触发记录 CSV',
  'Event log': '事件日志',
  Triggers: '触发记录',
  All: '全部',
  'No events yet.': '暂无事件。',
  'No triggers yet — run detection and say the wake word.':
    '暂无触发记录——运行检测并说出唤醒词。',
  Time: '时间',
  'Peak score': '峰值得分',

  // ---- Model Registry ----
  'Commercially usable': '可商用',
  'Demo-only / check license': '仅演示 / 请查看许可',
  commercial: '可商用',
  'Cannot reach': '无法访问',
  'unreachable · retry': '不可达 · 重试',
  'probing…': '探测中……',
  'verify reachable': '验证可达性',
  'Failed to load model registry': '模型注册表加载失败',
  'Could not load the model registry:': '无法加载模型注册表：',
  'Loading model registry…': '正在加载模型注册表……',
  'Search models…': '搜索模型……',
  'Search models': '搜索模型',
  'High-perf': '高性能',
  'KWS backends': 'KWS 后端',
  available: '可用',
  'No models match your filter.': '没有符合筛选条件的模型。',
  License: '许可',
  'Export…': '导出……',

  // ---- Export gate dialog ----
  'Export requested': '已请求导出',
  'export kits land in Phase 4': '导出套件将于第 4 阶段落地',
  'License gate: export blocked': '许可门禁：导出已被阻止',
  'This model is redistributable and explicitly commercial — safe to bundle.':
    '该模型可再分发且明确允许商用——可以安全打包。',
  'This model is': '该模型的类别是',
  'It cannot be used in a commercial bundle (Phase 4 gate).':
    '不能用于商业打包（第 4 阶段门禁）。',
  'Export target': '导出目标',
  'TFLite (int8 quantized)': 'TFLite（int8 量化）',
  'Device SDK bundle': '设备 SDK 套件',
  'Blocked by the license gate': '已被许可门禁阻止',
}
