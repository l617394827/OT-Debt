import './style.css';
import { importChatFile, normalizePastedChat, PLATFORM_GUIDES, type ImportPlatform } from './importers';
import { AI_PROMPTS, analyzeChatWithAI, testAIConnection, type AIPromptId, type AISettings } from './ai';

type OvertimeType = '等需求' | '改需求' | '开会' | '线上事故' | '其他';
type Tone = 'sharp' | 'reasoned' | 'resign';
type AnalysisMode = 'rule' | 'ai';

interface OvertimeEvent {
  id: string;
  date: string;
  start: string;
  end: string;
  type: OvertimeType;
  evidence: string;
  invalid: boolean;
  invalidReason: string;
}

interface Summary {
  totalHours: number;
  invalidHours: number;
  invalidRate: number;
  debt: number;
  concentration: number;
  level: string;
  lateCount: number;
  weekendCount: number;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('应用容器不存在');

let events: OvertimeEvent[] = [];
let activeTone: Tone = 'sharp';
let selectedPlatform: ImportPlatform = 'auto';
let activeGuidePlatform: GuidePlatform = 'feishu';
let lastSummary: Summary | null = null;
let lastSettledEvents: OvertimeEvent[] = [];
let analysisMode: AnalysisMode = 'rule';
let aiConnected = false;
let aiSettings: AISettings = {
  baseUrl: '',
  model: '',
  apiKey: '',
  promptId: 'balanced',
};

const localNow = new Date();
const today = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`;
const currentMonth = today.slice(0, 7);

type GuidePlatform = Exclude<ImportPlatform, 'auto'>;

interface GuideDetail {
  title: string;
  status: string;
  statusTone: 'ok' | 'warn';
  intro: string;
  steps: Array<{ title: string; body: string; image?: string; imageAlt?: string }>;
  sources: Array<{ label: string; url: string }>;
}

const GUIDE_DETAILS: Record<GuidePlatform, GuideDetail> = {
  wecom: {
    title: '企业微信 · 完整对话导入',
    status: '个人端无可读完整导出',
    statusTone: 'warn',
    intro: '电脑端“聊天记录迁移”导出的是加密 .bak，只能恢复到同账号企微，不能交给本工具分析。完整可读记录需要企业管理员通过“会话内容存档”提供。',
    steps: [
      { title: '先避开错误入口', body: '头像 → 设置 → 文档/文件管理 → 聊天记录迁移，只适合换电脑。看到 .bak 就不要上传。', image: '/guides/wecom-migrate-entry.png', imageAlt: '企业微信聊天记录迁移入口' },
      { title: '向管理员申请记录', body: '请管理员从“会话内容存档”按你的账号、会话和日期范围导出完整消息；内部规则可能要求审批或告知相关成员。', image: '/guides/wecom-migrate-export.png', imageAlt: '企业微信完整或部分迁移界面' },
      { title: '要可读格式', body: '请对方交付 TXT、CSV 或 JSON，并保留发送时间、发送人、消息正文。附件可以不导，清算主要使用文字和时间。' },
      { title: '一次放进来', body: '把同一会话分段导出的所有文件一起拖入。系统会合并并去掉重复消息。' },
    ],
    sources: [
      { label: '企业微信会话内容存档（官方开发文档）', url: 'https://developer.work.weixin.qq.com/document/path/91360' },
      { label: '企微迁移格式与限制说明', url: 'https://www.qusiyi.com/wecom-user-guide/173.html' },
    ],
  },
  dingtalk: {
    title: '钉钉 · 完整对话导入',
    status: '普通端没有已验证的一键完整导出',
    statusTone: 'warn',
    intro: '钉钉客户端的“多选 / 合并转发”可以搬运片段，但不是完整本地文件。完整导出目前可走钉钉官方开源 DWS，前提是企业管理员开启并批准访问。',
    steps: [
      { title: '管理员开启访问', body: '管理员进入钉钉开发者平台 → CLI Access Management（CLI 访问管理）→ 开启。' },
      { title: '本人扫码授权', body: '安装官方 DingTalk Workspace CLI 后发起登录，浏览器会打开组织选择与授权页；若未开通，可在页面向管理员提交申请。' },
      { title: '导出完整 JSON', body: '请管理员或技术同事使用官方仓库附带的 chat_export_messages.py，按会话与开始时间导出 JSON。它可以覆盖完整时间段，不需要你先挑关键消息。' },
      { title: '拖入 JSON', body: '把导出的一个或多个 JSON 文件一起拖入。本工具会抽取时间、发送人和正文，再寻找下班后的工作信号。' },
    ],
    sources: [
      { label: 'DingTalk Workspace CLI（钉钉官方开源）', url: 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli' },
      { label: '钉钉聊天能力与导出脚本说明', url: 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/blob/main/skills/mono/references/products/chat.md' },
    ],
  },
  feishu: {
    title: '飞书 · 完整对话导入',
    status: '可在桌面端分批完整导出',
    statusTone: 'ok',
    intro: '飞书 V7.20 及以上支持把单聊或群聊消息导出到文档。单次最多 100 条，所以长对话要连续分批，最后把每批文档下载为 Markdown 一起导入。',
    steps: [
      { title: '进入多选', body: '电脑端打开目标会话，把鼠标悬停在一条消息上，点“…” → 多选。', image: '/guides/feishu-batch.png', imageAlt: '飞书消息更多菜单中的多选入口' },
      { title: '每批选满 100 条', body: '滚到该批最早一条，把它放到“选择以下消息”分割线下，点击“选择以下消息”；单次上限 100 条。', image: '/guides/feishu-select.png', imageAlt: '飞书批量选择以下消息界面' },
      { title: '导出到文档并继续下一批', body: '点击底部“导出到文档”。从上一批之后继续选择，重复到完整时间范围结束。' },
      { title: '下载 Markdown 后一起拖入', body: '逐个打开生成的文档 → 下载为 → Markdown。最后把全部 .md 文件一次拖入本工具，系统会合并去重。' },
    ],
    sources: [
      { label: '使用消息导出到文档功能（飞书官方）', url: 'https://www.feishu.cn/hc/zh-CN/articles/158045525235-%E4%BD%BF%E7%94%A8%E6%B6%88%E6%81%AF%E5%AF%BC%E5%87%BA%E5%88%B0%E6%96%87%E6%A1%A3%E5%8A%9F%E8%83%BD' },
      { label: '云文档下载为 Markdown（飞书官方）', url: 'https://www.feishu.cn/content/article/7644456827538820052' },
    ],
  },
};

app.innerHTML = `
  <div class="noise" aria-hidden="true"></div>
  <header class="topbar">
    <a class="brand" href="#top" aria-label="加班清算单首页">
      <span class="brand-mark">OT</span>
      <span>加班清算单<small>OVERTIME DEBT</small></span>
    </a>

  </header>

  <main id="top">
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-copy">
        <p class="eyebrow">一份站在打工人这边的账</p>
        <h1 id="hero-title">你不是在加班。<br><em>你是在垫付人生。</em></h1>
        <p class="hero-lead">把深夜消息、临时修改和漫长等待，清算成一张有证据、有数字、也有脾气的账单。</p>
        <a class="primary-link" href="#ledger">现在开始翻旧账 <span aria-hidden="true">↓</span></a>
      </div>
      <div class="hero-ticket is-pending" id="hero-ticket" aria-label="本月班味尚未清算">
        <div class="ticket-status" id="hero-ticket-status">AWAITING RECEIPTS</div>
        <p>本月班味浓度</p>
        <strong id="hero-concentration">？？<sup>%</sup></strong>
        <div class="meter"><i id="hero-meter"></i></div>
        <a class="ticket-question" id="hero-question" href="#ledger">你这个月到底替公司垫了多少人生，还不往下算算？ <span aria-hidden="true">↓</span></a>
        <div class="ticket-row"><span>人生被占用</span><b id="hero-total">尚未清算</b></div>
        <div class="ticket-row"><span>无效加班</span><b id="hero-invalid">等你交账</b></div>
        <div class="stamp" id="hero-stamp">待算</div>
        <div class="scanline" aria-hidden="true"></div>
      </div>
    </section>

    <section class="ledger-section" id="ledger" aria-labelledby="ledger-title">
      <div class="section-heading">
        <p class="eyebrow">STEP 01 / 提交事实</p>
        <h2 id="ledger-title">把加过的班放上桌</h2>
        <p>粘贴聊天记录，或手工补上一笔，把被占用的时间一项项算清。</p>
      </div>

      <div class="input-grid">
        <article class="panel import-panel">
          <div class="panel-title">
            <span>聊天记录</span>
            <small>先选软件，再按指引导入</small>
          </div>
          <div class="platform-selector" id="platform-selector" role="group" aria-label="聊天软件">
            <button class="active" type="button" data-platform="auto"><strong>自动识别</strong><small>直接放文件</small></button>
            <button type="button" data-platform="wecom"><strong>企业微信</strong><small>需管理员</small></button>
            <button type="button" data-platform="dingtalk"><strong>钉钉</strong><small>需授权</small></button>
            <button type="button" data-platform="feishu"><strong>飞书</strong><small>可界面导出</small></button>
          </div>
          <div class="guide-brief" aria-live="polite">
            <span id="platform-availability">自动判断来源</span>
            <button id="open-guide" type="button">查看三平台完整导出指引 <span aria-hidden="true">↗</span></button>
          </div>
          <label class="dropzone" id="dropzone" for="file-input">
            <input id="file-input" type="file" multiple accept=".txt,.md,.html,.htm,.csv,.json,text/plain,text/markdown,text/html,text/csv,application/json" />
            <span class="drop-icon">↳</span>
            <strong>拖入完整聊天文件，可一次选择多份</strong>
            <small>支持 TXT / Markdown / HTML / CSV / JSON · 可多选</small>
          </label>
          <div class="import-status" id="import-status" hidden></div>
          <label class="field-label" for="chat-input">或者直接粘贴完整对话文本</label>
          <textarea id="chat-input" placeholder="示例：\n2026-09-01 21:30 产品：这个按钮再改一下，明早要\n2026-09-01 23:00 我：第六版已发"></textarea>
          <button class="ghost-button" id="load-demo" type="button">放入一份匿名示例</button>
        </article>

        <article class="panel manual-panel">
          <div class="panel-title">
            <span>手动补一笔</span>
            <small>事实兜底</small>
          </div>
          <form id="manual-form">
            <div class="field-row three">
              <label>日期<input id="event-date" type="date" value="${today}" required /></label>
              <label>开始<input id="event-start" type="time" value="20:00" required /></label>
              <label>结束<input id="event-end" type="time" value="22:00" required /></label>
            </div>
            <label>为什么加班
              <select id="event-type">
                <option>等需求</option><option>改需求</option><option>开会</option><option>线上事故</option><option>其他</option>
              </select>
            </label>
            <label>留一句证据或吐槽
              <textarea class="small" id="event-evidence" placeholder="例如：同一个按钮换了 6 种橙色，最后用了第一版" required></textarea>
            </label>
            <button class="secondary-button" type="submit">+ 记入这笔账</button>
          </form>
          <div class="pending" id="pending-list" aria-live="polite">
            <p class="empty">还没有手工补录。你的正常下班，不需要自证。</p>
          </div>
        </article>
      </div>

      <section class="analysis-deck" aria-labelledby="analysis-title">
        <div class="analysis-deck-copy">
          <small>ANALYSIS ENGINE / 分析方式</small>
          <strong id="analysis-title">谁来翻这本旧账？</strong>
          <span id="analysis-status">规则模式 · 当前浏览器内完成</span>
        </div>
        <div class="analysis-actions">
          <div class="analysis-switch" role="group" aria-label="选择分析方式">
            <button class="active" type="button" data-analysis-mode="rule" aria-pressed="true"><strong>规则模式</strong><small>免费 · 本地</small></button>
            <button type="button" data-analysis-mode="ai" aria-pressed="false"><strong>AI 模式</strong><small id="ai-mode-label">待接入</small></button>
          </div>
          <button class="ai-settings-button" id="open-ai-settings" type="button">配置 AI 接口 <span aria-hidden="true">↗</span></button>
        </div>
      </section>

      <div class="settle-bar">
        <label>你的折算时薪 <span>¥</span><input id="hourly-rate" type="number" min="1" max="9999" value="150" /></label>
        <button class="settle-button" id="settle" type="button"><span>开始清算</span><span aria-hidden="true">→</span></button>
      </div>
      <p class="form-error" id="form-error" role="alert"></p>
    </section>

    <section class="loading-section" id="loading" hidden aria-live="polite">
      <div class="scanner"><i></i></div>
      <p id="loading-copy">正在翻旧账…</p>
      <small>马上出单</small>
    </section>

    <section class="report-section" id="report" hidden aria-labelledby="report-title">
      <div class="report-toolbar">
        <div>
          <p class="eyebrow">STEP 02 / 账已算清</p>
          <h2 id="report-title">本月加班清算单</h2>
        </div>
        <div class="tone-control">
          <div class="tone-switch" role="group" aria-label="清算口吻">
            <button class="active" data-tone="sharp" type="button" aria-pressed="true">毒舌满格</button>
            <button data-tone="reasoned" type="button" aria-pressed="false">据理力争</button>
            <button data-tone="resign" type="button" aria-pressed="false">体面辞职</button>
          </div>
          <small id="tone-status" aria-live="polite">当前：毒舌满格 · 清算意见与分享话术会同步变化</small>
        </div>
      </div>

      <article class="statement" id="statement">
        <div class="statement-head">
          <div><small>OT-DEBT / MONTHLY STATEMENT</small><h3>人生垫付款 · 清算凭证</h3></div>
          <div class="statement-grade"><span>班味浓度</span><strong id="metric-concentration">0%</strong><b id="metric-level">尚未入味</b></div>
        </div>
        <div class="summary-grid">
          <div><span>本月加班</span><strong id="metric-total">0</strong><small>小时</small></div>
          <div class="danger"><span>无效加班</span><strong id="metric-invalid">0</strong><small>小时</small></div>
          <div><span>无效占比</span><strong id="metric-rate">0</strong><small>%</small></div>
          <div class="yellow"><span>无偿垫付</span><strong id="metric-debt">0</strong><small>元</small></div>
        </div>
        <div class="statement-block">
          <div class="block-heading"><span>01</span><h4>无效加班清单</h4><small>逐笔对账，拒绝糊涂账</small></div>
          <div class="event-list" id="event-list"></div>
        </div>
        <div class="statement-block split-block">
          <div>
            <div class="block-heading"><span>02</span><h4>人生损耗换算</h4></div>
            <div class="life-loss" id="life-loss"></div>
          </div>
          <div>
            <div class="block-heading"><span>03</span><h4>本期诊断</h4></div>
            <blockquote id="diagnosis"></blockquote>
          </div>
        </div>
        <footer>本账单由《加班清算单》自动生成 · 数据真实 · 情绪保真 · 后果自负</footer>
      </article>

      <div class="action-panel">
        <div>
          <p class="eyebrow">STEP 03 / 把话说出去</p>
          <h3>证据已经替你站直了</h3>
          <p id="message-preview"></p>
        </div>
        <div class="actions">
          <button class="primary-action" id="copy-message" type="button">复制甩脸话术</button>
          <button id="download-card" type="button">下载 9:16 卡片</button>
          <button id="print-report" type="button">打印清算单</button>
        </div>
        <small>数据为真，发送后果自负。本工具不承担被穿小鞋责任。</small>
      </div>
    </section>
  </main>

  <dialog class="guide-dialog" id="guide-dialog" aria-labelledby="guide-dialog-title">
    <div class="guide-modal-shell">
      <header class="guide-modal-head">
        <div><small>FULL CONVERSATION / 导出路线</small><h2 id="guide-dialog-title">完整对话导入指引</h2></div>
        <form method="dialog"><button class="dialog-close" aria-label="关闭指引">×</button></form>
      </header>
      <nav class="guide-tabs" aria-label="选择聊天软件">
        <button type="button" data-guide-tab="wecom">企业微信</button>
        <button type="button" data-guide-tab="dingtalk">钉钉</button>
        <button class="active" type="button" data-guide-tab="feishu">飞书</button>
      </nav>
      <div class="guide-modal-body" id="guide-modal-body"></div>
      <footer class="guide-modal-foot">
        <span>聊天内容只在当前浏览器中读取</span>
        <span>请确认你有权处理所导出的会话</span>
      </footer>
    </div>
  </dialog>

  <dialog class="ai-dialog" id="ai-dialog" aria-labelledby="ai-dialog-title">
    <div class="ai-modal-shell">
      <header class="guide-modal-head ai-modal-head">
        <div><small>EXTERNAL AUDITOR / 外接分析</small><h2 id="ai-dialog-title">接入 OpenAI 兼容模型</h2></div>
        <form method="dialog"><button class="dialog-close" aria-label="关闭 AI 设置">×</button></form>
      </header>
      <div class="ai-modal-body">
        <aside class="ai-security-note">
          <strong>三项配置，接上就能用</strong>
          <p>填写服务商提供的接口地址、模型名称和 API Key。本工具只按 OpenAI 兼容格式请求，不绑定任何一家官方服务；API Key 仅保存在当前页面，刷新即清除。</p>
        </aside>
        <div class="ai-fields">
          <label>Base URL <small>填写服务商提供的 OpenAI 兼容接口地址</small>
            <input id="ai-base-url" type="url" placeholder="https://api.example.com/v1" autocomplete="url" />
          </label>
          <label>Model <small>填写服务商实际提供的模型 ID</small>
            <input id="ai-model" placeholder="例如：your-model-name" autocomplete="off" />
          </label>
          <label class="ai-api-key-field">API Key <small>服务商控制台创建；无鉴权接口可留空</small>
            <input id="ai-api-key" type="password" placeholder="sk-... 或服务商提供的密钥" autocomplete="off" spellcheck="false" />
          </label>
        </div>
        <fieldset class="prompt-fieldset">
          <legend>选择一套分析提示词</legend>
          <div class="prompt-versions">
            ${Object.entries(AI_PROMPTS).map(([id, prompt]) => `
              <label class="prompt-version ${id === 'balanced' ? 'active' : ''}">
                <input type="radio" name="ai-prompt" value="${id}" ${id === 'balanced' ? 'checked' : ''} />
                <span><b>${escapeHtml(prompt.name)}</b><em>${escapeHtml(prompt.badge)}</em></span>
                <small>${escapeHtml(prompt.description)}</small>
              </label>
            `).join('')}
          </div>
        </fieldset>
        <div class="ai-connect-status" id="ai-connect-status" aria-live="polite">尚未测试连接</div>
      </div>
      <footer class="ai-modal-foot">
        <button id="clear-ai-settings" type="button">清除本次配置</button>
        <button class="secondary-button" id="test-ai-connection" type="button">测试并启用 AI</button>
      </footer>
    </div>
  </dialog>

  <footer class="site-footer">
    <span>OT-DEbt · 五点半下班的人出品</span>
    <span>不提供法律意见，只提供把账算清的勇气。</span>
  </footer>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id) as T | null;
  if (!element) throw new Error(`找不到元素：${id}`);
  return element;
};

const manualForm = byId<HTMLFormElement>('manual-form');
const chatInput = byId<HTMLTextAreaElement>('chat-input');
const fileInput = byId<HTMLInputElement>('file-input');
const dropzone = byId<HTMLLabelElement>('dropzone');
const pendingList = byId<HTMLDivElement>('pending-list');
const report = byId<HTMLElement>('report');
const loading = byId<HTMLElement>('loading');
const formError = byId<HTMLParagraphElement>('form-error');
const toast = byId<HTMLDivElement>('toast');
const importStatus = byId<HTMLDivElement>('import-status');
const aiDialog = byId<HTMLDialogElement>('ai-dialog');
const aiConnectStatus = byId<HTMLDivElement>('ai-connect-status');
const aiBaseUrlInput = byId<HTMLInputElement>('ai-base-url');
const aiModelInput = byId<HTMLInputElement>('ai-model');
const aiApiKeyInput = byId<HTMLInputElement>('ai-api-key');

function uid(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}

function durationHours(start: string, end: string): number {
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  let minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 10) / 10;
}

function addMinutes(time: string, minutes: number): string {
  const [hour, minute] = time.split(':').map(Number);
  const total = (hour * 60 + minute + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function classify(text: string): { type: OvertimeType; invalid: boolean; invalidReason: string } {
  if (/事故|故障|宕机|报警|线上问题/.test(text)) return { type: '线上事故', invalid: false, invalidReason: '真实线上事故' };
  if (/等|审批|排期|资源|还没给|稍后发/.test(text)) return { type: '等需求', invalid: true, invalidReason: '等待他人或流程导致' };
  if (/会|会议|对齐|同步|复盘/.test(text)) return { type: '开会', invalid: true, invalidReason: '非工作时间会议占用' };
  if (/改|修改|再来一版|换个|重做|调整/.test(text)) return { type: '改需求', invalid: true, invalidReason: '临时或反复修改导致' };
  return { type: '其他', invalid: /紧急|明早|今晚|@|临时/.test(text), invalidReason: '非工作时间临时安排' };
}

function normalizeDate(value: string): string {
  const cleaned = value.replace(/[/.]/g, '-');
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned)) {
    const [year, month, day] = cleaned.split('-');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  if (/^\d{1,2}-\d{1,2}$/.test(cleaned)) {
    const [month, day] = cleaned.split('-');
    return `${new Date().getFullYear()}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return today;
}

function parseChat(text: string): OvertimeEvent[] {
  const workSignal = /加班|紧急|明早|今晚|改|修改|再来一版|需求|审批|排期|会议|开会|事故|故障|上线|发布|等|@|重做|换个|调整/;
  const completionSignal = /已发|发了|完成|搞定|结束|修复|恢复|上线|下班|收工|请查收/;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const records: Array<{ line: string; date: string; times: string[] }> = [];
  let lastDate = today;

  for (const line of lines) {
    const dateMatch = line.match(/(20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})/);
    if (dateMatch) lastDate = normalizeDate(dateMatch[1]);
    const times = [...line.matchAll(/(?:^|\s|T)([01]?\d|2[0-3]):([0-5]\d)/g)]
      .map((match) => `${match[1].padStart(2, '0')}:${match[2]}`);
    records.push({ line, date: lastDate, times });
  }

  const parsed: OvertimeEvent[] = [];
  records.forEach((record, index) => {
    if (!workSignal.test(record.line) || record.times.length === 0) return;
    const start = record.times[0];
    if (Number(start.slice(0, 2)) < 18 && !/加班|今晚|事故|故障/.test(record.line)) return;

    const category = classify(record.line);
    let end = record.times[1];
    if (!end) {
      const startMinutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3));
      const completion = records.slice(index + 1, index + 5).find((candidate) => {
        if (candidate.date !== record.date || candidate.times.length === 0 || !completionSignal.test(candidate.line)) return false;
        const candidateTime = candidate.times[0];
        const candidateMinutes = Number(candidateTime.slice(0, 2)) * 60 + Number(candidateTime.slice(3));
        return candidateMinutes > startMinutes && candidateMinutes - startMinutes <= 8 * 60;
      });
      end = completion?.times[0] ?? addMinutes(start, category.type === '开会' ? 120 : 90);
    }

    parsed.push({
      id: uid(),
      date: record.date,
      start,
      end,
      type: category.type,
      evidence: record.line.slice(0, 180),
      invalid: category.invalid,
      invalidReason: category.invalidReason,
    });
  });
  return deduplicate(parsed);
}

function deduplicate(items: OvertimeEvent[]): OvertimeEvent[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.date}-${item.start}-${item.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderPending(): void {
  if (events.length === 0) {
    pendingList.innerHTML = '<p class="empty">还没有手工补录。你的正常下班，不需要自证。</p>';
    return;
  }
  pendingList.innerHTML = events.map((item) => `
    <div class="pending-item">
      <div><strong>${escapeHtml(item.date.slice(5))} · ${escapeHtml(item.start)}—${escapeHtml(item.end)}</strong><small>${escapeHtml(item.type)} / ${durationHours(item.start, item.end)} 小时</small></div>
      <button type="button" data-remove="${item.id}" aria-label="删除这条记录">×</button>
    </div>
  `).join('');
}

manualForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const type = byId<HTMLSelectElement>('event-type').value as OvertimeType;
  const evidence = byId<HTMLTextAreaElement>('event-evidence').value.trim();
  const category = classify(`${type} ${evidence}`);
  events.push({
    id: uid(),
    date: byId<HTMLInputElement>('event-date').value,
    start: byId<HTMLInputElement>('event-start').value,
    end: byId<HTMLInputElement>('event-end').value,
    type,
    evidence,
    invalid: type === '线上事故' ? false : category.invalid || type !== '其他',
    invalidReason: type === '线上事故' ? '真实线上事故' : category.invalidReason,
  });
  byId<HTMLTextAreaElement>('event-evidence').value = '';
  renderPending();
  showToast('这笔账记下了');
});

pendingList.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-remove]');
  if (!button) return;
  events = events.filter((item) => item.id !== button.dataset.remove);
  renderPending();
});

const guideDialog = byId<HTMLDialogElement>('guide-dialog');
const guideModalBody = byId<HTMLDivElement>('guide-modal-body');
const openGuideButton = byId<HTMLButtonElement>('open-guide');

function renderGuideDialog(platform: GuidePlatform): void {
  activeGuidePlatform = platform;
  const detail = GUIDE_DETAILS[platform];
  byId('guide-dialog-title').textContent = detail.title;
  document.querySelectorAll<HTMLButtonElement>('[data-guide-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.guideTab === platform);
  });
  guideModalBody.innerHTML = `
    <section class="guide-intro">
      <span class="guide-status ${detail.statusTone}">${escapeHtml(detail.status)}</span>
      <p>${escapeHtml(detail.intro)}</p>
    </section>
    <div class="guide-step-list">
      ${detail.steps.map((step, index) => `
        <article class="guide-step-card">
          <div class="guide-step-number">${String(index + 1).padStart(2, '0')}</div>
          <div class="guide-step-copy">
            <h3>${escapeHtml(step.title)}</h3>
            <p>${escapeHtml(step.body)}</p>
            ${step.image ? `<figure><img src="${step.image}" alt="${escapeHtml(step.imageAlt ?? step.title)}" loading="lazy" /><figcaption>界面位置示意 · 截图来源见下方</figcaption></figure>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
    <aside class="guide-sources">
      <strong>核对来源</strong>
      ${detail.sources.map((source) => `<a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.label)} <span aria-hidden="true">↗</span></a>`).join('')}
    </aside>
  `;
}

function setPlatform(platform: ImportPlatform): void {
  selectedPlatform = platform;
  if (platform !== 'auto') activeGuidePlatform = platform;
  document.querySelectorAll<HTMLButtonElement>('[data-platform]').forEach((button) => {
    button.classList.toggle('active', button.dataset.platform === platform);
  });
  const guide = PLATFORM_GUIDES[platform];
  byId('platform-availability').textContent = guide.availability;
  openGuideButton.innerHTML = platform === 'auto'
    ? '查看三平台完整导出指引 <span aria-hidden="true">↗</span>'
    : `查看${escapeHtml(guide.shortName)}完整导出指引 <span aria-hidden="true">↗</span>`;
  dropzone.classList.remove('loaded');
  dropzone.querySelector('strong')!.textContent = '拖入完整聊天文件，可一次选择多份';
  importStatus.hidden = true;
}

document.querySelectorAll<HTMLButtonElement>('[data-platform]').forEach((button) => {
  button.addEventListener('click', () => setPlatform(button.dataset.platform as ImportPlatform));
});

document.querySelectorAll<HTMLButtonElement>('[data-guide-tab]').forEach((button) => {
  button.addEventListener('click', () => renderGuideDialog(button.dataset.guideTab as GuidePlatform));
});

openGuideButton.addEventListener('click', () => {
  renderGuideDialog(selectedPlatform === 'auto' ? activeGuidePlatform : selectedPlatform);
  guideDialog.showModal();
});

guideDialog.addEventListener('click', (event) => {
  if (event.target === guideDialog) guideDialog.close();
});

function renderAnalysisMode(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-analysis-mode]').forEach((button) => {
    const isActive = button.dataset.analysisMode === analysisMode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  byId('ai-mode-label').textContent = aiConnected ? '已连接' : '待接入';
  byId('analysis-status').textContent = analysisMode === 'ai' && aiConnected
    ? `AI 模式 · ${aiSettings.model} · ${AI_PROMPTS[aiSettings.promptId].name}`
    : '规则模式 · 当前浏览器内完成';
}

function setAnalysisMode(mode: AnalysisMode): void {
  if (mode === 'ai' && !aiConnected) {
    aiConnectStatus.textContent = '先完成一次连接测试，成功后会自动切到 AI 模式。';
    aiConnectStatus.className = 'ai-connect-status';
    aiDialog.showModal();
    return;
  }
  analysisMode = mode;
  renderAnalysisMode();
  showToast(mode === 'ai' ? `已切换到 AI · ${AI_PROMPTS[aiSettings.promptId].name}` : '已切回本地规则模式');
}

function selectedPromptId(): AIPromptId {
  return (document.querySelector<HTMLInputElement>('input[name="ai-prompt"]:checked')?.value ?? 'balanced') as AIPromptId;
}

function fillAISettingsForm(): void {
  aiBaseUrlInput.value = aiSettings.baseUrl;
  aiModelInput.value = aiSettings.model;
  aiApiKeyInput.value = aiSettings.apiKey;
  document.querySelectorAll<HTMLInputElement>('input[name="ai-prompt"]').forEach((input) => {
    input.checked = input.value === aiSettings.promptId;
    input.closest('.prompt-version')?.classList.toggle('active', input.checked);
  });
}

byId<HTMLButtonElement>('open-ai-settings').addEventListener('click', () => {
  fillAISettingsForm();
  aiConnectStatus.textContent = aiConnected ? `当前已连接：${aiSettings.model}` : '尚未测试连接';
  aiConnectStatus.className = `ai-connect-status${aiConnected ? ' ok' : ''}`;
  aiDialog.showModal();
});

document.querySelectorAll<HTMLButtonElement>('[data-analysis-mode]').forEach((button) => {
  button.addEventListener('click', () => setAnalysisMode(button.dataset.analysisMode as AnalysisMode));
});

document.querySelectorAll<HTMLInputElement>('input[name="ai-prompt"]').forEach((input) => {
  input.addEventListener('change', () => {
    document.querySelectorAll('.prompt-version').forEach((item) => item.classList.remove('active'));
    input.closest('.prompt-version')?.classList.add('active');
  });
});

aiDialog.addEventListener('click', (event) => {
  if (event.target === aiDialog) aiDialog.close();
});

byId<HTMLButtonElement>('clear-ai-settings').addEventListener('click', () => {
  aiSettings = { baseUrl: '', model: '', apiKey: '', promptId: 'balanced' };
  aiConnected = false;
  analysisMode = 'rule';
  fillAISettingsForm();
  renderAnalysisMode();
  aiConnectStatus.textContent = '本次配置已清除，API Key 已从页面内存移除。';
  aiConnectStatus.className = 'ai-connect-status';
});

byId<HTMLButtonElement>('test-ai-connection').addEventListener('click', async () => {
  const button = byId<HTMLButtonElement>('test-ai-connection');
  const candidate: AISettings = {
    baseUrl: aiBaseUrlInput.value.trim(),
    model: aiModelInput.value.trim(),
    apiKey: aiApiKeyInput.value,
    promptId: selectedPromptId(),
  };
  button.disabled = true;
  button.textContent = '正在测试接口…';
  aiConnectStatus.textContent = '正在发送一条极短的格式测试请求…';
  aiConnectStatus.className = 'ai-connect-status testing';
  try {
    await testAIConnection(candidate);
    aiSettings = candidate;
    aiConnected = true;
    analysisMode = 'ai';
    renderAnalysisMode();
    aiConnectStatus.textContent = `连接成功：${candidate.model} · ${AI_PROMPTS[candidate.promptId].name}`;
    aiConnectStatus.className = 'ai-connect-status ok';
    showToast('AI 已接入，可以直接开始清算');
    window.setTimeout(() => aiDialog.close(), 650);
  } catch (error) {
    aiConnected = false;
    analysisMode = 'rule';
    renderAnalysisMode();
    aiConnectStatus.textContent = error instanceof Error ? error.message : '接口测试失败，请检查地址和模型名称。';
    aiConnectStatus.className = 'ai-connect-status error';
  } finally {
    button.disabled = false;
    button.textContent = '测试并启用 AI';
  }
});

async function loadFiles(fileList?: FileList | File[]): Promise<void> {
  const files = Array.from(fileList ?? []);
  if (!files.length) return;
  if (files.length > 50) {
    formError.textContent = '一次最多导入 50 份文件，请分两次整理。';
    return;
  }
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 100 * 1024 * 1024) {
    formError.textContent = '本次文件合计超过 100MB，请按月份分批清算。';
    return;
  }

  try {
    const results = await Promise.all(files.map((file) => importChatFile(file, selectedPlatform)));
    const lines = [...new Set(results.flatMap((result) => result.text.split(/\r?\n/).filter(Boolean)))];
    chatInput.value = lines.join('\n');
    formError.textContent = '';
    dropzone.classList.add('loaded');
    dropzone.querySelector('strong')!.textContent = files.length === 1 ? `已读取：${files[0].name}` : `已合并 ${files.length} 份聊天文件`;
    importStatus.hidden = false;
    const detected = [...new Set(results.map((result) => result.platform).filter((platform) => platform !== 'auto'))];
    const platform = detected.length === 1 ? detected[0] : selectedPlatform;
    const platformName = PLATFORM_GUIDES[platform].name;
    const formats = [...new Set(results.map((result) => result.format))].join(' + ');
    importStatus.innerHTML = `<b>${escapeHtml(platformName)}</b><span>${escapeHtml(formats)} · 合并后 ${lines.length} 行消息</span>`;
    if (selectedPlatform === 'auto' && detected.length === 1) {
      setPlatform(detected[0]);
      dropzone.classList.add('loaded');
      dropzone.querySelector('strong')!.textContent = files.length === 1 ? `已读取：${files[0].name}` : `已合并 ${files.length} 份聊天文件`;
    }
    importStatus.hidden = false;
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : '文件读取失败，请查看对应软件的完整导出指引。';
    dropzone.classList.remove('loaded');
    importStatus.hidden = true;
  }
}

fileInput.addEventListener('change', () => void loadFiles(fileInput.files ?? undefined));
['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
}));
dropzone.addEventListener('drop', (event) => void loadFiles(event.dataTransfer?.files));

byId<HTMLButtonElement>('load-demo').addEventListener('click', () => {
  const todayOfMonth = Number(today.slice(8));
  const latestCompletedDay = Math.max(1, todayOfMonth - 1);
  const demoDate = (position: number): string => {
    const day = Math.max(1, Math.ceil(latestCompletedDay * position));
    return `${currentMonth}-${String(day).padStart(2, '0')}`;
  };
  const [dateA, dateB, dateC, dateD] = [0.25, 0.5, 0.75, 1].map(demoDate);
  chatInput.value = `${dateA} 20:15 产品同事：首页按钮再换个橙色，明早要看
${dateA} 21:30 我：第六版已经发了
${dateB} 19:40 项目群：先等审批，稍后再给排期
${dateB} 21:10 我：排期终于确认，收工
${dateC} 22:10 老板：@我 临时有个紧急需求，今晚调整一下
${dateC} 23:20 我：已发，请查收
${dateD} 19:30 系统：线上故障报警，支付接口异常
${dateD} 21:00 我：故障已恢复`;
  showToast(`已放入本月${todayOfMonth > 1 ? '截至昨天' : '今天'}的匿名示例，点“开始清算”即可`);
});
function currentMonthOnly(items: OvertimeEvent[]): OvertimeEvent[] {
  return items.filter((item) => item.date.startsWith(currentMonth));
}
function calculateSummary(items: OvertimeEvent[]): Summary {
  const totalHours = items.reduce((sum, item) => sum + durationHours(item.start, item.end), 0);
  const invalidHours = items.filter((item) => item.invalid).reduce((sum, item) => sum + durationHours(item.start, item.end), 0);
  const invalidRate = totalHours ? Math.round((invalidHours / totalHours) * 100) : 0;
  const rate = Number(byId<HTMLInputElement>('hourly-rate').value) || 0;
  const lateCount = items.filter((item) => Number(item.start.slice(0, 2)) >= 22).length;
  const weekendCount = items.filter((item) => [0, 6].includes(new Date(`${item.date}T12:00:00`).getDay())).length;
  const concentration = Math.min(100, Math.round(totalHours * 1.8 + invalidRate * 0.45 + lateCount * 5 + weekendCount * 8));
  const level = concentration >= 85 ? '重度腌入味' : concentration >= 65 ? '班味扑面而来' : concentration >= 40 ? '已有工位回甘' : '尚可抢救';
  return {
    totalHours: Math.round(totalHours * 10) / 10,
    invalidHours: Math.round(invalidHours * 10) / 10,
    invalidRate,
    debt: Math.round(invalidHours * rate * 1.5),
    concentration,
    level,
    lateCount,
    weekendCount,
  };
}

const toneLabels: Record<Tone, string> = {
  sharp: '毒舌满格',
  reasoned: '据理力争',
  resign: '体面辞职',
};
const roasts: Record<Tone, Record<OvertimeType, string[]>> = {
  sharp: {
    '等需求': ['今晚的主要产出：等一个明天可能就忘掉的决定。', '流程没走完，你的人生先被它走了一遍。'],
    '改需求': ['同一个决定来回横跳，只有你的下班时间单向消失。', '需求没有定稿，但你的黑眼圈已经正式发布。'],
    '开会': ['这场会如果录下来，应该先申请助眠产品备案。', '大家用一场会证明：没人知道下一步是什么。'],
    '线上事故': ['这笔班确实救了火，但不该默认你就是灭火器。', '事故是真的，长期靠人肉兜底也是真的。'],
    '其他': ['“临时”是对方的形容词，却成了你的生活方式。', '这件事可能紧急，但不该永远由你的夜晚买单。'],
  },
  reasoned: {
    '等需求': ['该时段主要消耗在等待前置决策，建议明确响应时限与值班边界。'],
    '改需求': ['修改发生在非工作时间，建议在执行前确认版本与验收标准。'],
    '开会': ['会议占用非工作时间，建议调整议程并优先安排在工作时段。'],
    '线上事故': ['该事件属于必要处置，建议补充轮值与调休机制。'],
    '其他': ['该任务在非工作时间临时安排，建议提前排期并确认补偿方式。'],
  },
  resign: {
    '等需求': ['我愿意为结果负责，但不再为没有结果的等待持续垫付生活。'],
    '改需求': ['我尊重变化，也决定把自己的时间留给尊重边界的团队。'],
    '开会': ['当讨论长期挤占生活，离开也成了一个需要执行的议程。'],
    '线上事故': ['我曾认真接住每次故障，现在也该认真接住自己的生活。'],
    '其他': ['感谢这段经历提醒我：工作重要，未被透支的人生更重要。'],
  },
};

function getRoast(item: OvertimeEvent, index: number): string {
  const choices = roasts[activeTone][item.type];
  return choices[index % choices.length];
}

function buildMessage(summary: Summary): string {
  const base = `本月共记录加班 ${summary.totalHours} 小时，其中无效加班 ${summary.invalidHours} 小时，占 ${summary.invalidRate}%，按当前时薪折算约 ¥${summary.debt.toLocaleString('zh-CN')}。`;
  if (activeTone === 'reasoned') return `${base} 这些时间主要来自临时修改、等待或非工作时段安排。我希望后续明确需求截止时间、减少非工作时段临时任务，并就已发生的加班确认调休或补偿方案。请一起确认。`;
  if (activeTone === 'resign') return `${base} 这份记录让我确认，当前工作方式与我希望长期保持的生活边界并不一致。感谢过去的合作，我会完成必要交接，也决定不再继续垫付自己的生活。`;
  return `${base} 简单说：公司省下的是排期，我垫进去的是人生。账已经算清，接下来请把调休、补偿和“不再深夜灵光一闪”一起安排上。`;
}

function updateHero(summary: Summary): void {
  const ticket = byId<HTMLDivElement>('hero-ticket');
  ticket.classList.remove('is-pending');
  ticket.classList.add('is-settled');
  ticket.setAttribute('aria-label', `本月班味浓度 ${summary.concentration}%，共加班 ${summary.totalHours} 小时`);
  byId('hero-ticket-status').textContent = 'MONTH SETTLED / 本月已结算';
  byId('hero-concentration').innerHTML = `${summary.concentration}<sup>%</sup>`;
  byId<HTMLElement>('hero-meter').style.width = `${Math.min(100, summary.concentration)}%`;
  byId('hero-total').textContent = `${summary.totalHours} 小时`;
  byId('hero-invalid').textContent = `${summary.invalidHours} 小时 · ${summary.invalidRate}%`;
  byId('hero-stamp').textContent = summary.invalidRate >= 50 ? '超标' : '已算';
  byId('hero-question').innerHTML = `账都算到 ${summary.concentration}% 了，还准备继续假装这是正常的吗？ <span aria-hidden="true">↓</span>`;
}
function renderReport(items: OvertimeEvent[]): void {
  const summary = calculateSummary(items);
  lastSummary = summary;
  lastSettledEvents = items.map((item) => ({ ...item }));
  updateHero(summary);
  byId('metric-concentration').textContent = `${summary.concentration}%`;
  byId('metric-level').textContent = summary.level;
  byId('metric-total').textContent = String(summary.totalHours);
  byId('metric-invalid').textContent = String(summary.invalidHours);
  byId('metric-rate').textContent = String(summary.invalidRate);
  byId('metric-debt').textContent = summary.debt.toLocaleString('zh-CN');

  byId('event-list').innerHTML = items.map((item, index) => `
    <article class="report-event ${item.invalid ? 'is-invalid' : 'is-valid'}">
      <div class="event-index">${String(index + 1).padStart(2, '0')}</div>
      <div class="event-main">
        <div class="event-meta"><strong>${escapeHtml(item.date)} · ${escapeHtml(item.start)}—${escapeHtml(item.end)}</strong><span>${escapeHtml(item.type)}</span><span>${durationHours(item.start, item.end)} 小时</span></div>
        <p class="evidence">“${escapeHtml(item.evidence)}”</p>
        <p class="roast"><b>清算意见</b>${escapeHtml(getRoast(item, index))}</p>
      </div>
      <div class="invalid-stamp">${item.invalid ? '无效' : '必要'}</div>
    </article>
  `).join('');

  const movies = Math.max(1, Math.round(summary.invalidHours / 2));
  const dinners = Math.max(1, Math.round(summary.invalidHours / 3));
  const sleep = Math.round(summary.invalidHours * 10) / 10;
  byId('life-loss').innerHTML = `
    <strong>${summary.invalidHours} 小时</strong>
    <p>≈ 少看 <b>${movies}</b> 部电影</p>
    <p>≈ 错过 <b>${dinners}</b> 次晚饭</p>
    <p>≈ 少睡 <b>${sleep}</b> 小时</p>
  `;
  const diagnosis = activeTone === 'reasoned'
    ? `无效加班占比 ${summary.invalidRate}%。优先处理临时需求与等待流程，可直接减少非必要占用。`
    : activeTone === 'resign'
      ? `有些账不必讨回，但要记得停止续借。你值得一份不靠透支生活运转的工作。`
      : `你无偿垫付的 ¥${summary.debt.toLocaleString('zh-CN')}，建议向公司索要发票。品名：人生损耗。`;
  byId('diagnosis').textContent = diagnosis;
  byId('message-preview').textContent = buildMessage(summary);
}

byId<HTMLButtonElement>('settle').addEventListener('click', async () => {
  if (analysisMode === 'ai' && !aiConnected) {
    formError.textContent = 'AI 模式还没有连上接口，请先完成连接测试。';
    aiDialog.showModal();
    return;
  }

  const settleButton = byId<HTMLButtonElement>('settle');
  const normalizedChat = normalizePastedChat(chatInput.value);
  const copies = analysisMode === 'ai'
    ? ['正在把完整对话交给 AI…', '正在关联任务与完成消息…', '正在核对时间与证据…', '正在合并重复线索…']
    : ['正在翻旧账…', '正在统计你白加的班…', '正在确认冤种事实…', '正在给边界感开发补丁…'];
  let copyIndex = 0;
  let copyTimer = 0;
  settleButton.disabled = true;
  settleButton.innerHTML = '<span>清算中…</span><span aria-hidden="true">···</span>';
  formError.textContent = '';
  loading.hidden = false;
  report.hidden = true;
  byId('loading-copy').textContent = copies[0];
  loading.querySelector('small')!.textContent = analysisMode === 'ai' ? `由 ${aiSettings.model} 分析，耗时取决于对话长度` : '马上出单';
  loading.scrollIntoView({ behavior: 'smooth', block: 'center' });
  copyTimer = window.setInterval(() => {
    copyIndex = (copyIndex + 1) % copies.length;
    byId('loading-copy').textContent = copies[copyIndex];
  }, analysisMode === 'ai' ? 1600 : 450);

  try {
    let parsed: OvertimeEvent[] = [];
    if (analysisMode === 'ai') {
      if (normalizedChat.trim()) {
        const aiEvents = await analyzeChatWithAI(normalizedChat, currentMonth, aiSettings, (completed, total) => {
          byId('loading-copy').textContent = `AI 正在分析第 ${completed}/${total} 段对话…`;
        });
        parsed = aiEvents.map((item) => ({ id: uid(), ...item }));
      }
    } else {
      parsed = parseChat(normalizedChat);
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }

    const allEvents = deduplicate([...events, ...parsed]);
    if (allEvents.length === 0) {
      throw new Error(analysisMode === 'ai'
        ? 'AI 没有找到可清算的记录。可以换“深挖隐形加班”提示词，或手工补一笔。'
        : '还没有找到可清算的记录。请粘贴带日期、时间和工作关键词的聊天，或手工补一笔。');
    }
    const monthEvents = currentMonthOnly(allEvents);
    if (monthEvents.length === 0) {
      throw new Error(`记录已经读到，但没有发现 ${currentMonth} 的加班线索。首页“本月班味”只计算当前月份。`);
    }

    renderReport(monthEvents);
    report.hidden = false;
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(analysisMode === 'ai' ? `AI 清算完成 · 找到 ${monthEvents.length} 笔` : `规则清算完成 · 找到 ${monthEvents.length} 笔`);
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : '清算失败，请稍后重试。';
    document.querySelector('.analysis-deck')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    window.clearInterval(copyTimer);
    loading.hidden = true;
    settleButton.disabled = false;
    settleButton.innerHTML = '<span>开始清算</span><span aria-hidden="true">→</span>';
  }
});
document.querySelectorAll<HTMLButtonElement>('[data-tone]').forEach((button) => {
  button.addEventListener('click', () => {
    if (!lastSettledEvents.length) return;
    activeTone = button.dataset.tone as Tone;
    document.querySelectorAll<HTMLButtonElement>('[data-tone]').forEach((item) => {
      const isActive = item === button;
      item.classList.toggle('active', isActive);
      item.setAttribute('aria-pressed', String(isActive));
    });
    renderReport(lastSettledEvents);
    byId('tone-status').textContent = `当前：${toneLabels[activeTone]} · 清算意见与分享话术已更新`;
    const statement = byId('statement');
    statement.classList.remove('tone-updated');
    requestAnimationFrame(() => statement.classList.add('tone-updated'));
    showToast(`已切换为「${toneLabels[activeTone]}」`);
  });
});

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2200);
}

byId<HTMLButtonElement>('copy-message').addEventListener('click', async () => {
  if (!lastSummary) return;
  try {
    await navigator.clipboard.writeText(buildMessage(lastSummary));
    showToast('话术已复制。证据在手，语气由你。');
  } catch {
    showToast('复制被浏览器拦截，请手动选择上方话术。');
  }
});

byId<HTMLButtonElement>('print-report').addEventListener('click', () => window.print());

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines = 3): number {
  const characters = [...text];
  let line = '';
  let lines = 0;
  for (const character of characters) {
    const test = line + character;
    if (context.measureText(test).width > maxWidth && line) {
      context.fillText(line, x, y + lines * lineHeight);
      line = character;
      lines += 1;
      if (lines >= maxLines) return y + lines * lineHeight;
    } else {
      line = test;
    }
  }
  if (line && lines < maxLines) {
    context.fillText(line, x, y + lines * lineHeight);
    lines += 1;
  }
  return y + lines * lineHeight;
}

function downloadCard(): void {
  if (!lastSummary) return;
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1920;
  const context = canvas.getContext('2d');
  if (!context) return;
  const summary = lastSummary;
  context.fillStyle = '#0D0F14';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(0,229,255,.12)';
  context.lineWidth = 2;
  for (let y = 0; y < 1920; y += 12) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(1080, y); context.stroke();
  }
  context.fillStyle = '#00E5FF';
  context.font = '700 30px monospace';
  context.fillText('OT-DEBT / MONTHLY STATEMENT', 72, 100);
  context.fillStyle = '#F5F5F7';
  context.font = '900 84px sans-serif';
  context.fillText('加班清算单', 72, 220);
  context.fillStyle = '#FFE600';
  context.font = '900 310px Impact, sans-serif';
  context.fillText(String(summary.concentration), 60, 560);
  const numberWidth = context.measureText(String(summary.concentration)).width;
  context.font = '900 96px sans-serif';
  context.fillText('%', 70 + numberWidth, 550);
  context.fillStyle = '#F5F5F7';
  context.font = '700 44px sans-serif';
  context.fillText(`班味浓度 · ${summary.level}`, 72, 650);
  context.strokeStyle = '#FF3B30';
  context.lineWidth = 8;
  context.strokeRect(70, 720, 940, 390);
  context.fillStyle = '#FF3B30';
  context.font = '900 46px sans-serif';
  context.fillText('无效加班', 110, 805);
  context.font = '900 170px Impact, sans-serif';
  context.fillText(`${summary.invalidHours}H`, 110, 995);
  context.fillStyle = '#F5F5F7';
  context.font = '500 34px monospace';
  context.fillText(`占全部加班 ${summary.invalidRate}%`, 650, 810);
  context.fillText(`无偿垫付 ¥${summary.debt.toLocaleString('zh-CN')}`, 650, 870);
  context.fillText(`深夜开工 ${summary.lateCount} 次`, 650, 930);
  context.fillText(`周末被占 ${summary.weekendCount} 次`, 650, 990);
  context.fillStyle = '#FF9500';
  context.font = '900 40px sans-serif';
  context.fillText('本期清算意见', 72, 1210);
  context.fillStyle = '#F5F5F7';
  context.font = '700 54px sans-serif';
  wrapCanvasText(context, byId('diagnosis').textContent ?? '', 72, 1300, 920, 82, 4);
  context.strokeStyle = '#2A303B';
  context.beginPath(); context.moveTo(72, 1680); context.lineTo(1008, 1680); context.stroke();
  context.fillStyle = '#8D96A8';
  context.font = '500 28px monospace';
  context.fillText('数据真实 · 情绪保真 · 后果自负', 72, 1750);
  context.fillStyle = '#F5F5F7';
  context.font = '700 32px sans-serif';
  context.fillText('加班清算单 · 五点半下班的人出品', 72, 1825);
  const link = document.createElement('a');
  link.download = `加班清算单-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  showToast('9:16 分享卡片已下载');
}

byId<HTMLButtonElement>('download-card').addEventListener('click', downloadCard);

