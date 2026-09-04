export type AIPromptId = 'strict' | 'balanced' | 'deep';

export interface AISettings {
  baseUrl: string;
  model: string;
  apiKey: string;
  promptId: AIPromptId;
}

export interface AIParsedEvent {
  date: string;
  start: string;
  end: string;
  type: '等需求' | '改需求' | '开会' | '线上事故' | '其他';
  evidence: string;
  invalid: boolean;
  invalidReason: string;
}

export const AI_PROMPTS: Record<AIPromptId, { name: string; badge: string; description: string; guidance: string }> = {
  strict: {
    name: '稳健取证',
    badge: '少误判',
    description: '只记证据明确、起止时间较可靠的加班，适合正式对账。',
    guidance: '宁可漏掉模糊记录，也不要把普通闲聊判成工作。结束时间没有直接证据时，只能做最保守的短时估计，并在 invalidReason 中注明“结束时间为保守估计”。',
  },
  balanced: {
    name: '平衡清算',
    badge: '推荐',
    description: '兼顾完整度和误判率，自动关联任务发起与完成消息。',
    guidance: '合理关联同一天的任务发起、追问与完成消息。结束时间没有直接证据时，可根据上下文保守估计 30—90 分钟，并在 invalidReason 中说明估计依据。',
  },
  deep: {
    name: '深挖隐形加班',
    badge: '更完整',
    description: '额外寻找等待、反复修改、深夜会议等不易被关键词抓到的占用。',
    guidance: '重点识别等待审批、待命、反复返工、非工作时间会议、被打断后继续工作的隐形占用；仍不得凭空编造任务或时间。结束时间不明时，可结合后续回复做保守估计并明确标注。',
  },
};

const EVENT_TYPES = new Set(['等需求', '改需求', '开会', '线上事故', '其他']);
const MAX_TOTAL_CHARACTERS = 240_000;
const MAX_CHUNK_CHARACTERS = 24_000;

function endpointFrom(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('请填写兼容接口地址。');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('接口地址格式不正确，请填写完整的 http:// 或 https:// 地址。');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('接口地址只支持 HTTP 或 HTTPS。');
  if (url.pathname.endsWith('/chat/completions')) return url.toString().replace(/\/$/, '');
  url.pathname = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
  return url.toString().replace(/\/$/, '');
}

function splitConversation(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length > MAX_TOTAL_CHARACTERS) {
    throw new Error('本月对话超过 24 万字，请按上、下半月分两次导入，避免接口超出上下文长度。');
  }
  const lines = normalized.split(/\r?\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const line of lines) {
    if (current.length && length + line.length + 1 > MAX_CHUNK_CHARACTERS) {
      chunks.push(current.join('\n'));
      current = current.slice(-6);
      length = current.reduce((sum, item) => sum + item.length + 1, 0);
    }
    current.push(line);
    length += line.length + 1;
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

function extractContent(payload: unknown): string {
  const data = payload as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    }).join('');
  }
  throw new Error('接口已响应，但没有返回可读取的文本内容。');
}

function parseJsonContent(content: string): unknown {
  const withoutFence = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');
  const candidate = firstBrace >= 0 && lastBrace > firstBrace ? withoutFence.slice(firstBrace, lastBrace + 1) : withoutFence;
  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error('模型没有按约定返回 JSON。可以换“稳健取证”提示词或更换模型重试。');
  }
}

async function postChat(settings: AISettings, messages: Array<{ role: 'system' | 'user'; content: string }>, signal?: AbortSignal): Promise<string> {
  if (!settings.model.trim()) throw new Error('请填写模型名称。');
  const endpoint = endpointFrom(settings.baseUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (settings.apiKey.trim()) headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  const baseBody = {
    model: settings.model.trim(),
    messages,
    temperature: 0.1,
    max_tokens: 4096,
  };

  const request = async (withJsonMode: boolean): Promise<Response> => fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(withJsonMode ? { ...baseBody, response_format: { type: 'json_object' } } : baseBody),
    signal,
  });

  let response: Response;
  try {
    response = await request(true);
    if (response.status === 400) response = await request(false);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error('接口响应超时，请检查地址、网络或模型状态。');
    throw new Error('浏览器无法访问该接口。若地址本身可用，通常是接口没有开放跨域访问；请改用你自己的代理地址。');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json() as { error?: { message?: string }; message?: string };
      detail = body.error?.message ?? body.message ?? '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new Error(`接口返回 ${response.status}${detail ? `：${detail.slice(0, 220)}` : ''}`);
  }
  return extractContent(await response.json());
}

function systemPrompt(currentMonth: string, promptId: AIPromptId): string {
  return `你是“加班清算单”的证据分析员。请从企业聊天记录中找出 ${currentMonth} 发生的非工作时间工作，并输出严格 JSON。

判断规则：
1. 只分析 ${currentMonth}，忽略其他月份。日期必须是 YYYY-MM-DD，时间必须是 HH:mm。
2. 工作事件包括下班后或周末处理需求、等待关键反馈或审批、反复修改、非工作时间会议、线上事故和其他明确工作。
3. 将同一任务的发起、过程与完成消息合并成一条，start 为开始占用时间，end 为完成或结束时间。跨午夜时，date 写开始日期，end 可以小于 start。
4. type 只能是：等需求、改需求、开会、线上事故、其他。
5. 线上事故等必要处置通常 invalid=false；无序等待、临时插单、反复修改、非工作时间会议通常 invalid=true。invalidReason 用一句简短中文说明。
6. evidence 必须忠实摘取或紧凑概括原消息，保留关键时间与事实，不得杜撰聊天中不存在的人、任务或结论。
7. ${AI_PROMPTS[promptId].guidance}
8. 没有事件时返回空数组。不要输出 Markdown、解释或额外字段。

返回格式：
{"events":[{"date":"YYYY-MM-DD","start":"HH:mm","end":"HH:mm","type":"等需求","evidence":"证据摘要","invalid":true,"invalidReason":"等待前置决策"}]}`;
}

function validateEvents(payload: unknown, currentMonth: string): AIParsedEvent[] {
  const events = (payload as { events?: unknown })?.events;
  if (!Array.isArray(events)) throw new Error('模型返回内容中缺少 events 数组。');
  return events.flatMap((raw): AIParsedEvent[] => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    const date = String(item.date ?? '');
    const start = String(item.start ?? '');
    const end = String(item.end ?? '');
    const type = String(item.type ?? '');
    const evidence = String(item.evidence ?? '').trim();
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) || !date.startsWith(currentMonth)) return [];
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end)) return [];
    if (!EVENT_TYPES.has(type) || !evidence) return [];
    return [{
      date,
      start,
      end,
      type: type as AIParsedEvent['type'],
      evidence: evidence.slice(0, 240),
      invalid: item.invalid === true,
      invalidReason: String(item.invalidReason ?? (item.invalid === true ? '非工作时间工作占用' : '必要工作处置')).slice(0, 100),
    }];
  });
}

export async function testAIConnection(settings: AISettings): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 30_000);
  try {
    const content = await postChat(settings, [
      { role: 'system', content: '你是接口连通测试助手，只返回 JSON：{"ok":true}' },
      { role: 'user', content: '返回约定的 JSON。' },
    ], controller.signal);
    const parsed = parseJsonContent(content) as { ok?: unknown };
    if (parsed.ok !== true) throw new Error('模型已响应，但没有完成格式测试。');
  } finally {
    window.clearTimeout(timer);
  }
}

export async function analyzeChatWithAI(
  text: string,
  currentMonth: string,
  settings: AISettings,
  onProgress?: (completed: number, total: number) => void,
): Promise<AIParsedEvent[]> {
  const chunks = splitConversation(text);
  if (!chunks.length) return [];
  const collected: AIParsedEvent[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 60_000);
    try {
      const content = await postChat(settings, [
        { role: 'system', content: systemPrompt(currentMonth, settings.promptId) },
        { role: 'user', content: `这是完整对话的第 ${index + 1}/${chunks.length} 段。只返回约定 JSON：\n\n${chunks[index]}` },
      ], controller.signal);
      collected.push(...validateEvents(parseJsonContent(content), currentMonth));
      onProgress?.(index + 1, chunks.length);
    } finally {
      window.clearTimeout(timer);
    }
  }
  const seen = new Set<string>();
  return collected.filter((item) => {
    const key = `${item.date}-${item.start}-${item.end}-${item.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
