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

  // ---- Workspace: pipeline cards / run control ----
  'Start pipeline': '启动管线',
  'loading models…': '正在加载模型……',
  config: '配置',
  toggle: '开关',
  On: '开',
  Off: '关',
  'Bypassed': '已旁路',
  'Active': '生效中',
  Level: '电平',
  'Echo red.': '回声抑制',
  'Separ.': '分离度',
  'Spectrum': '频谱',
  passthrough: '直通',
  'Score curve (raw + smoothed + threshold)': '得分管线（原始 + 平滑 + 阈值）',
  score: '得分',
  'Raw input': '原始输入',
  'NS output': '降噪输出',
  'KWS output (16 kHz)': 'KWS 输出（16 kHz）',
  'Per-stage clips': '分阶段音频片段',
  'Stop & save clips': '停止并保存片段',
  Capture: '捕获',
  'Enable persistence in a module config (Source/NS/KWS) first.':
    '请先在模块配置（Source/NS/KWS）中启用持久化。',
  'Saved clips': '已保存片段',
  total: '共',
  Play: '播放',
  Stop: '停止',

  // ---- Source / persistence ----
  Persistence: '持久化',
  'Persist raw input (captures the mic/file stream)': '持久化原始输入（捕获麦克风/文件流）',
  'Persist NS output (denoised audio)': '持久化降噪输出（降噪后的音频）',
  'Pipeline-wide settings for the whole AEC → BSS → NS chain.':
    '整条 AEC → BSS → NS 链路的管线级设置。',
  'input feed, raw persistence and AFE-wide settings': '输入源、原始持久化与 AFE 全局设置',
  Microphone: '麦克风',
  'Audio files': '音频文件',
  'Use audio files as source': '使用音频文件作为输入源',
  'Use microphone as source': '使用麦克风作为输入源',
  'Apply source changes': '应用输入源更改',
  'Applies on the next Start': '将在下次启动时生效',
  'Not saved yet — press Apply to make it the project source.':
    '尚未保存——点击“应用”将其设为项目输入源。',
  'Input device': '输入设备',
  'Default device': '默认设备',
  'Allow mic to see device names': '授权麦克风以显示设备名称',
  Channels: '声道',
  Mono: '单声道',
  Stereo: '立体声',
  'Browser DSP is off by default — our RNNoise is the only noise suppressor. Toggle browser AEC/NS/AGC to let the device do it instead.':
    '浏览器 DSP 默认关闭——RNNoise 是唯一的降噪器。如需让设备处理，可开启浏览器 AEC/NS/AGC。',
  '+ Add audio files…': '+ 添加音频文件……',
  'No files — files play concurrently, each channel with its own loop + offset.':
    '暂无文件——文件将并发播放，每个声道可单独设置循环与偏移。',
  'file(s)': '个文件',
  'Remove': '移除',
  Loop: '循环',
  Offset: '偏移',
  Ch: '声道',

  // ---- Projects / project bar ----
  'Project created': '项目已创建',
  'Untitled project': '未命名项目',
  'Failed to create project': '项目创建失败',
  'New project': '新建项目',
  'Create a wake-word project: target word, domain and target chip.':
    '创建唤醒词项目：目标唤醒词、领域与目标芯片。',
  'Project name': '项目名称',
  'e.g. Hey Studio': '例如 Hey Studio',
  'e.g. hey studio': '例如 hey studio',
  Domain: '领域',
  'Target chip (optional)': '目标芯片（可选）',
  'e.g. rpi4, esp32-s3, linux-x64': '例如 rpi4、esp32-s3、linux-x64',
  'Creating…': '创建中……',
  Create: '创建',
  Target: '目标唤醒词',
  Chip: '芯片',
  'Low-power / MCU': '低功耗 / MCU',
  'High-performance (Linux / Pi / Android)': '高性能（Linux / 树莓派 / Android）',
  'Recent projects': '最近项目',
  'No projects yet': '还没有项目',
  'New project…': '新建项目……',
  'updated just now': '刚刚更新',
  updated: '更新于',
  'min ago': '分钟前',
  'h ago': '小时前',
  'list': '列表',
  'Your list': '你的列表',
  'Toggle list': '切换列表',
  'Show list': '显示列表',
  'Open list': '打开列表',
  'Close list': '关闭列表',

  // ---- Datasets console ----
  Generated: '已生成',
  Uploaded: '已上传',
  Public: '公开',
  cloud: '云端',
  'not hosted yet': '尚未托管',
  'no clips': '无片段',
  clip: '个片段',
  clips: '个片段',
  'Loading datasets…': '正在加载数据集……',
  'No datasets yet. Press (the wizard wand) to generate one with a TTS engine — built-ins and generated datasets land here.':
    '还没有数据集。点击"新建"（向导魔棒）用 TTS 引擎生成一个——内置与已生成的数据集都会出现在这里。',
  ' (the wizard wand) to generate one with a TTS engine — built-ins and generated datasets land here.':
    '（向导魔棒）用 TTS 引擎生成一个——内置与已生成的数据集都会出现在这里。',
  Generate: '生成',
  Storage: '存储',
  Check: '检查',
  Split: '拆分',
  queued: '排队中',
  running: '运行中',
  paused: '已暂停',
  succeeded: '已成功',
  failed: '已失败',
  canceled: '已取消',
  'Generation job': '生成任务',
  'Storage job': '存储任务',
  'Quality check job': '质量检查任务',
  'Split job': '拆分任务',
  Started: '开始时间',
  Finished: '结束时间',
  Dataset: '数据集',
  'Live progress': '实时进度',
  'Browser progress': '浏览器进度',
  polling: '轮询',
  Progress: '进度',
  Log: '日志',
  lines: '行',
  Inputs: '输入',
  'This deletes the job on the studio-backend and removes it from the rail.':
    '这会在 studio-backend 上删除该任务并将其从列表移除。',
  'This removes the job from the rail. Any dataset it generated stays in the local store.':
    '这会将该任务从列表移除。其生成的数据集仍保留在本地存储中。',
  'Delete this job?': '删除该任务？',
  'Dataset downloaded': '数据集已下载',
  bytes: '字节',
  'Download failed': '下载失败',
  'Dataset deleted': '数据集已删除',
  'Delete failed': '删除失败',
  'Uploaded to cloud': '已上传到云端',
  'Upload failed': '上传失败',
  'Could not load the backend dataset store:': '无法加载后端数据集存储：',
  'Built-in catalog unavailable:': '内置目录不可用：',
  'This dataset is no longer in the list (deleted?). Pick another from the rail.':
    '该数据集已不在列表中（可能已被删除）。请从列表中选择其他数据集。',
  'This job is no longer in the list (deleted?). Pick another from the rail.':
    '该任务已不在列表中（可能已被删除）。请从列表中选择其他任务。',
  'No dataset selected': '未选择数据集',
  'Pick a dataset in the left rail to inspect its manifest, provenance, storage and quality report, or press':
    '在左侧列表中选择一个数据集以查看其清单、来源、存储与质量报告，或点击',
  'Generation jobs': '生成任务',

  // ---- Dataset details ----
  Manifest: '清单',
  Role: '角色',
  Duration: '时长',
  'Sample rate': '采样率',
  'Channels / encoding': '声道 / 编码',
  'Content hash': '内容哈希',
  Label: '标签',
  Source: '来源',
  Voices: '音色',
  Recipe: '生成配方',
  Provenance: '来源信息',
  'commercial use': '可商用',
  'non-commercial': '非商用',
  'A model trained on this dataset inherits the restriction — the export gate blocks commercial bundles (#210).':
    '在该数据集上训练的模型会继承此限制——导出门禁会阻止商业打包（#210）。',
  'browser-local': '浏览器本地',
  'Quality report': '质量报告',
  pass: '通过',
  warn: '警告',
  checked: '检查于',
  'checked on the studio-backend': '由 studio-backend 检查',
  'No quality warnings — the dataset looks clean.': '没有质量问题——数据集看起来很干净。',
  'Role coverage': '角色覆盖',
  'Wake-word (positive) labels': '唤醒词（positive）标签',
  'Unknowns / noise coverage': 'unknowns / noise 覆盖',
  'Commercial use': '商用性',
  yes: '是',
  no: '否',
  'This manifest-level summary is rendered today. Run a Check on the studio-backend (Actions) to produce the full health report — per-label clip quality, silence/duplicate detection, sample-rate drift, label balance, voice coverage.':
    '目前仅渲染清单级摘要。在 studio-backend 上运行一次"检查"（操作）即可生成完整健康报告——逐标签片段质量、静音/重复检测、采样率漂移、标签均衡、音色覆盖。',
  'Run a': '运行一次',
  'Reproducible split': '可复现拆分',
  train: '训练',
  val: '验证',
  test: '测试',
  Listen: '试听',
  'Could not play this clip.': '无法播放该片段。',
  'Reading clips from the archive tail…': '正在从归档尾部读取片段……',
  'No audio clips in this dataset.': '该数据集中没有音频片段。',
  stop: '停止',
  play: '播放',
  '…and': '……还有',
  'more clips in': '个片段位于',
  'Playback reads a single clip on demand — never the whole archive (§8.3).':
    '播放按需读取单个片段——绝不下载整个归档（§8.3）。',

  // ---- Dataset actions ----
  'New generation task': '新建生成任务',
  'Open the Training wizard with this dataset pre-picked': '打开训练向导并预选该数据集',
  'Train with this': '用此数据集训练',
  'Upload to cloud': '上传到云端',
  'Run the check-dataset quality job (clip quality, silence/duplication, voice coverage) on the studio-backend':
    '在 studio-backend 上运行 check-dataset 质量任务（片段质量、静音/重复、音色覆盖）',
  'Requires a connected studio-backend (backend-stored dataset)':
    '需要已连接的 studio-backend（后端存储的数据集）',
  'Built-ins are immutable references — materialize them on the backend to download.':
    '内置数据集是不可变引用——请在后端实体化后再下载。',
  'Download the canonical wake-studio-dataset.zip': '下载规范的 wake-studio-dataset.zip',
  'Downloading…': '下载中……',
  Download: '下载',
  'Built-ins are immutable references and cannot be deleted.': '内置数据集是不可变引用，不能删除。',
  'Delete this dataset': '删除该数据集',
  'Built-ins are immutable references (': '内置数据集是不可变引用（',
  'materialized on the backend on first use': '首次使用时在后端实体化',
  'Use them in training directly; download/delete are not applicable.':
    '可直接在训练中使用；下载/删除不适用。',
  Upload: '上传',
  'to cloud': '到云端',
  'Direct browser push of the canonical zip using your Settings cloud credentials (client-side, masked, never persisted).':
    '使用"设置"中的云凭据直接从浏览器推送规范的 zip（客户端侧、掩码显示、永不落盘）。',
  'not wired browser-side': '浏览器端尚未接入',
  'Hugging Face repo id': 'Hugging Face 仓库 ID',
  'Token comes from Settings → Cloud storage → Hugging Face.':
    '令牌来自"设置 → 云存储 → Hugging Face"。',
  Keep: '保留',
  'Uploading…': '上传中……',
  'Removes the dataset from the backend store (its zip + index). Datasets that feed an existing train keep working through their copied materialization.':
    '会从后端存储中删除该数据集（其 zip 与索引）。已作为训练输入的数据集仍可通过其拷贝的实体化继续工作。',
  'Removes this dataset from the browser-local store. This cannot be undone unless you have the zip elsewhere.':
    '会从浏览器本地存储中删除该数据集。此操作不可撤销，除非你在别处保存了 zip。',
  'Split into a fixed train/val/test partition (reproducible, no leakage) and save it as a new dataset':
    '拆分为固定的 train/val/test 划分（可复现、无泄漏），并保存为新数据集',
  'Split…': '拆分……',
  'Records a fixed train/val/test partition (80/10/10) in a new dataset’s manifest. Near-duplicate clips stay in one partition — evaluation never sees training data.':
    '在新数据集的清单中记录固定的 train/val/test 划分（80/10/10）。近似重复的片段会留在同一划分中——评估永远看不到训练数据。',
  'Reproducibility seed': '可复现性种子',
  'Same dataset + seed → identical partition every time (byte-reproducible).':
    '相同数据集 + 相同种子 → 每次都得到完全一致的划分（字节级可复现）。',

  // ---- New dataset wizard ----
  'Pick the TTS engine that synthesizes the audio.': '选择用于合成音频的 TTS 引擎。',
  'Wake phrases + the engine’s own settings.': '唤醒短语 + 引擎自身的设置。',
  'Where the dataset is generated + saved.': '数据集的生成与保存位置。',
  'Review and start the generation job.': '审阅并启动生成任务。',
  Configure: '配置',
  Destination: '保存位置',
  Ready: '就绪',
  'Generation steps': '生成步骤',
  'Generation jobs land in the Datasets rail with live progress (same UI as Training).':
    '生成任务会出现在数据集列表中，并带有实时进度（与训练相同的 UI）。',
  'Wake phrases': '唤醒短语',
  'One wake phrase per line (or comma-separated). Each phrase becomes a':
    '每行一个唤醒短语（或用逗号分隔）。每个短语都会成为',
  label: '标签',
  'phrase(s)': '个短语',
  'Dataset name': '数据集名称',
  'Optional — defaults to the first phrase + languages.': '可选——默认取第一个短语 + 语言。',
  settings: '设置',
  'The engine’s own parameters (rendered spec-driven).': '引擎自身的参数（以 spec 驱动渲染）。',
  Postprocess: '后处理',
  'An optional transform applied to the synthesized clips.': '对合成片段应用的可选变换。',
  Passthrough: '直通',
  'Use the synthesized clips as-is.': '直接使用合成的片段。',
  'openWakeWord-style': 'openWakeWord 风格',
  'Pitch/rate/volume perturbation (backend, ffmpeg) — browser runs use passthrough.':
    '音调/语速/音量扰动（后端，ffmpeg）——浏览器运行时使用直通。',
  'Starting…': '启动中……',
  'Generate dataset': '生成数据集',
  'Runs entirely in this tab (online HTTP TTS → canonical zip). The dataset is saved to the browser-local store; no studio-backend is involved.':
    '完全在此标签页内运行（在线 HTTP TTS → 规范 zip）。数据集保存到浏览器本地存储；不涉及 studio-backend。',
  'Discard this generation?': '放弃本次生成？',
  'You have progress in the wizard. Leaving now discards your selections.':
    '向导中还有未完成的进度。现在离开将放弃你的选择。',
  Discard: '放弃',
  'Could not load the TTS engine catalog:': '无法加载 TTS 引擎目录：',
  'Loading engines…': '正在加载引擎……',
  'No studio-backend connected — browser-capable engines (green “browser” badge) run client-side; backend-only engines are disabled until you connect one in the Backends menu.':
    '未连接 studio-backend——支持浏览器的引擎（绿色"browser"徽标）在客户端运行；仅后端引擎会保持禁用，直到你在"后端"菜单中连接一个。',
  'No executor is available for this engine.': '该引擎没有可用的执行器。',
  Executor: '执行器',
  'Backend executor': '后端执行器',
  'Browser executor': '浏览器执行器',
  'Save destination': '保存位置',
  'The generated dataset is persisted to the connected studio-backend’s':
    '生成的数据集会持久化到已连接 studio-backend 的',
  'store — it becomes trainable and downloadable. Cloud upload (Hugging Face / R2 / Drive) is available as an action on the dataset after generation.':
    '存储中——变为可训练、可下载。生成后可通过数据集上的操作上传到云端（Hugging Face / R2 / Drive）。',
  'Saved to the': '保存到',
  'browser-local store': '浏览器本地存储',
  '(this tab’s IndexedDB) — it shows in the Datasets rail and the Training dataset picker.':
    '（此标签页的 IndexedDB）——会显示在数据集列表和训练数据集选择器中。',
  'Also push to Hugging Face': '同时推送到 Hugging Face',
  'browser direct push': '浏览器直推',
  'Uploads wake-studio-dataset.zip straight to a dataset repo using your Settings cloud token (R2 / Drive are not wired browser-side yet).':
    '使用"设置"中的云端令牌将 wake-studio-dataset.zip 直接上传到数据集仓库（R2 / Drive 尚未在浏览器端接入）。',
  'Set a Hugging Face token in Settings → Cloud storage first.': '请先在"设置 → 云存储"中设置 Hugging Face 令牌。',
  '+ whether a studio-backend is connected': '+ 是否已连接 studio-backend',
  connected: '已连接',
  'not connected': '未连接',
  'Executor decided by the engine’s': '执行器由引擎的',
  Phrases: '短语',
  '(auto)': '（自动）',
  'Cloud push': '云端推送',
  'local only': '仅本地',
  'studio-backend': 'studio-backend',
  browser: '浏览器',
  'user-owned (synthetic TTS)': '用户自有（合成 TTS）',
  '— the generated dataset is commercially usable and trains clean models (export gate, #210).':
    '——生成的数据集可商用，可训练出干净的模型（导出门禁，#210）。',
}
