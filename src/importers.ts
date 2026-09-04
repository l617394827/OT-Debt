export type ImportPlatform = 'auto' | 'wecom' | 'dingtalk' | 'feishu';

export interface PlatformGuide {
  name: string;
  shortName: string;
  badge: string;
  availability: string;
  steps: string[];
  note: string;
  formats: string;
}

export interface ImportResult {
  text: string;
  platform: ImportPlatform;
  messageCount: number;
  format: string;
}

export const PLATFORM_GUIDES: Record<ImportPlatform, PlatformGuide> = {
  auto: {
    name: '自动识别',
    shortName: '自动',
    badge: '推荐',
    availability: '自动判断来源',
    steps: ['选择聊天软件查看完整导出路径。', '可一次拖入多份文件，系统会合并并去重。'],
    note: '不确定格式时保留自动识别即可。',
    formats: 'TXT · Markdown · HTML · CSV · JSON',
  },
  wecom: {
    name: '企业微信',
    shortName: '企微',
    badge: '需管理员',
    availability: '个人端无可读完整导出',
    steps: ['个人端迁移包是加密 .bak，不能读取正文。', '请管理员通过会话内容存档提供 TXT、CSV 或 JSON。'],
    note: '不要上传 .bak；它只能恢复到同账号的企业微信。',
    formats: 'TXT · CSV · JSON',
  },
  dingtalk: {
    name: '钉钉',
    shortName: '钉钉',
    badge: '需授权',
    availability: '普通端无一键完整导出',
    steps: ['由管理员开启官方 DWS CLI 访问。', '授权后导出完整消息 JSON，再拖入本工具。'],
    note: '网页上流传的“右上角直接导出 HTML/PDF”未得到官方资料支持。',
    formats: 'JSON · TXT · CSV',
  },
  feishu: {
    name: '飞书 / Lark',
    shortName: '飞书',
    badge: '可操作',
    availability: '可在界面分批完整导出',
    steps: ['桌面端多选消息，每批最多 100 条并导出到文档。', '将生成的文档下载为 Markdown，多份一起拖入。'],
    note: '话题群、保密会话或禁止转发消息不支持此功能。',
    formats: 'Markdown · TXT · JSON',
  },
};
const timestampKeys = [
  'timestamp', 'time', 'send_time', 'sendTime', 'create_time', 'createTime',
  'created_at', 'createdAt', 'createdDateTime', 'sentDateTime', 'msgtime',
];
const textKeys = ['text', 'content', 'message', 'msg', 'msgContent', 'body'];
const senderKeys = ['sender_name', 'senderName', 'senderNick', 'from', 'username', 'user_name', 'user', 'sender'];

function firstValue(object: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null && object[key] !== '') return object[key];
  }
  return undefined;
}

function cleanText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && trimmed.length < 200_000) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const nested = cleanText(parsed);
        if (nested) return nested;
      } catch {
        // 普通正文恰好以括号开头时继续按文本处理。
      }
    }
    const decoded = trimmed.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, ' ');
    const textarea = document.createElement('textarea');
    textarea.innerHTML = decoded;
    return textarea.value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (Array.isArray(value)) return value.map(cleanText).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const direct = firstValue(object, ['text', 'content', 'title', 'body']);
    if (direct !== undefined && direct !== value) return cleanText(direct);
  }
  return '';
}

function normalizeDateParts(year: string | undefined, month: string, day: string): string {
  const currentYear = String(new Date().getFullYear());
  return `${year ?? currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function normalizeDateText(value: string): string | null {
  const match = value.match(/(?:(20\d{2})[年./-])?(\d{1,2})[月./-](\d{1,2})日?/);
  return match ? normalizeDateParts(match[1], match[2], match[3]) : null;
}

function formatTimestamp(value: unknown): { date: string; time: string } | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value).trim();
  const visibleDate = normalizeDateText(raw);
  const visibleTime = raw.match(/(?:^|\s|T)([01]?\d|2[0-3]):([0-5]\d)/);
  if (visibleDate && visibleTime) {
    return { date: visibleDate, time: `${visibleTime[1].padStart(2, '0')}:${visibleTime[2]}` };
  }

  let date: Date;
  if (/^\d{10,13}(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    date = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime())) return null;
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16) };
}

function senderText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return String(firstValue(object, ['name', 'display_name', 'nickname', 'nick', 'id']) ?? '成员');
  }
  return '成员';
}

function collectJsonMessages(value: unknown, lines: string[], seen: Set<string>): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonMessages(item, lines, seen));
    return;
  }
  if (!value || typeof value !== 'object') return;

  const item = value as Record<string, unknown>;
  const timestamp = firstValue(item, timestampKeys);
  const body = firstValue(item, textKeys);
  const formatted = formatTimestamp(timestamp);
  const text = cleanText(body);

  if (formatted && text) {
    const sender = senderText(firstValue(item, senderKeys));
    const line = `${formatted.date} ${formatted.time} ${sender}: ${text}`;
    const key = `${formatted.date}-${formatted.time}-${sender}-${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      lines.push(line);
    }
  }

  Object.values(item).forEach((nested) => {
    if (nested && typeof nested === 'object') collectJsonMessages(nested, lines, seen);
  });
}

function parseJson(text: string): string[] {
  const parsed = JSON.parse(text) as unknown;
  const lines: string[] = [];
  collectJsonMessages(parsed, lines, new Set());
  return lines;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function findHeader(headers: string[], candidates: string[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => header.toLowerCase().includes(candidate.toLowerCase())));
}

function parseCsv(text: string): string[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const timeIndex = findHeader(headers, ['发送时间', '消息时间', '创建时间', 'timestamp', 'sendtime', 'create_time', 'time']);
  const dateIndex = findHeader(headers, ['日期', 'date']);
  const senderIndex = findHeader(headers, ['发送人', '发送者', '姓名', 'sender', 'from', 'username', 'nickname']);
  const textIndex = findHeader(headers, ['消息内容', '正文', '内容', 'message', 'content', 'text']);
  if (textIndex < 0 || (timeIndex < 0 && dateIndex < 0)) return [];

  return rows.slice(1).map((row) => {
    const timestamp = [dateIndex >= 0 ? row[dateIndex] : '', timeIndex >= 0 ? row[timeIndex] : ''].filter(Boolean).join(' ');
    const formatted = formatTimestamp(timestamp);
    const body = cleanText(row[textIndex]);
    if (!formatted || !body) return '';
    return `${formatted.date} ${formatted.time} ${row[senderIndex] || '成员'}: ${body}`;
  }).filter(Boolean);
}

function normalizeCopiedText(text: string): string {
  const rawLines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const normalized: string[] = [];
  let lastDate = '';
  let pendingSender = '';

  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index];
    const date = normalizeDateText(line) ?? lastDate;
    if (normalizeDateText(line)) lastDate = normalizeDateText(line)!;
    const timeMatch = line.match(/(?:^|\s|T)([01]?\d|2[0-3]):([0-5]\d)/);

    if (timeMatch && date) {
      const time = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
      const before = line.slice(0, timeMatch.index).replace(/(?:(?:20\d{2})[年./-])?\d{1,2}[月./-]\d{1,2}日?/, '').trim();
      let after = line.slice((timeMatch.index ?? 0) + timeMatch[0].length).replace(/^\s*[:：|-]?\s*/, '').trim();
      const sender = before.replace(/[()[\]【】]/g, '').trim() || pendingSender || '成员';

      if (!after && rawLines[index + 1] && !normalizeDateText(rawLines[index + 1]) && !/\d{1,2}:\d{2}/.test(rawLines[index + 1])) {
        after = rawLines[index + 1];
        index += 1;
      }
      if (after) normalized.push(`${date} ${time} ${sender}: ${after}`);
      else pendingSender = sender;
      continue;
    }

    if (/^[\p{L}\p{N}_·（）()\- ]{1,32}$/u.test(line)) {
      pendingSender = line;
      continue;
    }

    normalized.push(line);
  }

  return normalized.join('\n');
}

function detectPlatform(fileName: string, text: string): ImportPlatform {
  const sample = `${fileName}\n${text.slice(0, 8000)}`.toLowerCase();
  if (/飞书|lark|open_id|tenant_key|message_id/.test(sample)) return 'feishu';
  if (/企业微信|wecom|wework|external_userid|msgid/.test(sample)) return 'wecom';
  if (/钉钉|dingtalk|conversationid|sendernick|openconversationid/.test(sample)) return 'dingtalk';
  return 'auto';
}

export async function importChatFile(file: File, preferred: ImportPlatform): Promise<ImportResult> {
  if (file.size > 25 * 1024 * 1024) throw new Error('单份文件超过 25MB，请按日期分段后一起导入。');
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith('.bak')) throw new Error('这是企业微信加密迁移包，只能恢复到企微，无法读取消息正文。');
  if (!/\.(txt|md|html?|csv|json)$/i.test(fileName)) throw new Error('目前支持 TXT、Markdown、HTML、CSV 和 JSON 文件。');

  const raw = await file.text();
  const platform = preferred === 'auto' ? detectPlatform(file.name, raw) : preferred;
  let lines: string[] = [];
  let format = 'TXT';

  if (fileName.endsWith('.json')) {
    format = 'JSON';
    lines = parseJson(raw);
    if (!lines.length) throw new Error('JSON 中没有找到带时间和正文的消息记录。');
  } else if (fileName.endsWith('.csv')) {
    format = 'CSV';
    lines = parseCsv(raw);
    if (!lines.length) throw new Error('没有识别出 CSV 列，请保留发送时间、发送人和消息内容表头。');
  } else {
    format = fileName.endsWith('.md') ? 'Markdown' : /\.html?$/.test(fileName) ? 'HTML' : 'TXT';
    const readable = /\.html?$/.test(fileName)
      ? new DOMParser().parseFromString(raw, 'text/html').body.innerText
      : raw;
    lines = normalizeCopiedText(readable).split(/\r?\n/).filter(Boolean);
  }

  const uniqueLines = [...new Set(lines)];
  return {
    text: uniqueLines.join('\n'),
    platform,
    messageCount: uniqueLines.length,
    format,
  };
}

export function normalizePastedChat(text: string): string {
  return normalizeCopiedText(text);
}
