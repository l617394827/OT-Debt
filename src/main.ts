import './style.css';

type OvertimeType = '等需求' | '改需求' | '开会' | '线上事故' | '其他';
type Tone = 'sharp' | 'reasoned' | 'resign';

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
let lastSummary: Summary | null = null;

const today = new Date().toISOString().slice(0, 10);

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
      <div class="hero-ticket" aria-label="清算单示意">
        <div class="ticket-status">DEBT DETECTED</div>
        <p>本月班味浓度</p>
        <strong>87<sup>%</sup></strong>
        <div class="meter"><i></i></div>
        <div class="ticket-row"><span>人生被占用</span><b>21 小时</b></div>
        <div class="ticket-row"><span>建议动作</span><b>立即清算</b></div>
        <div class="stamp">无效</div>
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
            <small>TXT / CSV</small>
          </div>
          <label class="dropzone" id="dropzone" for="file-input">
            <input id="file-input" type="file" accept=".txt,.csv,text/plain,text/csv" />
            <span class="drop-icon">↳</span>
            <strong>拖进来，或选择文件</strong>
            <small>我们会寻找深夜时间、紧急、修改、等待和 @ 等线索</small>
          </label>
          <label class="field-label" for="chat-input">也可以直接粘贴</label>
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
        <div class="tone-switch" role="group" aria-label="清算口吻">
          <button class="active" data-tone="sharp" type="button">毒舌满格</button>
          <button data-tone="reasoned" type="button">据理力争</button>
          <button data-tone="resign" type="button">体面辞职</button>
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
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed: OvertimeEvent[] = [];
  let lastDate = today;

  for (const line of lines) {
    const dateMatch = line.match(/(20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2})/);
    if (dateMatch) lastDate = normalizeDate(dateMatch[1]);
    const times = [...line.matchAll(/(?:^|\s|T)([01]?\d|2[0-3]):([0-5]\d)/g)].map((match) => `${match[1].padStart(2, '0')}:${match[2]}`);
    if (!workSignal.test(line) || times.length === 0) continue;
    const start = times[0];
    if (Number(start.slice(0, 2)) < 18 && !/加班|今晚|事故|故障/.test(line)) continue;
    const category = classify(line);
    parsed.push({
      id: uid(),
      date: lastDate,
      start,
      end: times[1] ?? addMinutes(start, category.type === '开会' ? 120 : 90),
      type: category.type,
      evidence: line.slice(0, 180),
      invalid: category.invalid,
      invalidReason: category.invalidReason,
    });
  }
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

async function loadFile(file?: File): Promise<void> {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    formError.textContent = '文件超过 2MB。请只保留需要清算的聊天片段再试。';
    return;
  }
  chatInput.value = await file.text();
  formError.textContent = '';
  dropzone.classList.add('loaded');
  dropzone.querySelector('strong')!.textContent = `已读取：${file.name}`;
}

fileInput.addEventListener('change', () => void loadFile(fileInput.files?.[0]));
['dragenter', 'dragover'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.remove('dragging');
}));
dropzone.addEventListener('drop', (event) => void loadFile(event.dataTransfer?.files[0]));

byId<HTMLButtonElement>('load-demo').addEventListener('click', () => {
  chatInput.value = `2026-09-03 21:30 产品同事：首页按钮再换个橙色，明早要看\n2026-09-03 23:00 我：第六版已经发了\n2026-09-10 20:00 项目群：先等审批，稍后再给排期\n2026-09-10 22:30 我：审批还没下来\n2026-09-15 22:47 老板：@我 临时有个紧急需求，今晚调整一下\n2026-09-15 23:50 我：已发，请查收\n2026-09-21 19:30 系统：线上故障报警，支付接口异常\n2026-09-21 21:00 我：故障已恢复`;
  showToast('匿名示例已放入，点“开始清算”就能看结果');
});

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

function renderReport(items: OvertimeEvent[]): void {
  const summary = calculateSummary(items);
  lastSummary = summary;
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

byId<HTMLButtonElement>('settle').addEventListener('click', () => {
  const parsed = parseChat(chatInput.value);
  const allEvents = deduplicate([...events, ...parsed]);
  if (allEvents.length === 0) {
    formError.textContent = '还没有找到可清算的记录。请粘贴带日期、时间和工作关键词的聊天，或手工补一笔。';
    return;
  }
  formError.textContent = '';
  const copies = ['正在翻旧账…', '正在统计你白加的班…', '正在确认冤种事实…', '正在给边界感开发补丁…'];
  let index = 0;
  loading.hidden = false;
  report.hidden = true;
  loading.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const copyTimer = window.setInterval(() => {
    index = (index + 1) % copies.length;
    byId('loading-copy').textContent = copies[index];
  }, 450);
  window.setTimeout(() => {
    window.clearInterval(copyTimer);
    loading.hidden = true;
    renderReport(allEvents);
    report.hidden = false;
    report.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 1700);
});

document.querySelectorAll<HTMLButtonElement>('[data-tone]').forEach((button) => {
  button.addEventListener('click', () => {
    activeTone = button.dataset.tone as Tone;
    document.querySelectorAll('[data-tone]').forEach((item) => item.classList.toggle('active', item === button));
    const parsed = deduplicate([...events, ...parseChat(chatInput.value)]);
    if (parsed.length) renderReport(parsed);
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

