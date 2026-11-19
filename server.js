'use strict';
// 本地服务：零依赖（仅 Node 内置模块），负责 API、静态资源、本地文件预览、LLM 代理
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { URL } = require('node:url');
const { db, nowISO, today, addDays } = require('./db');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const DEFAULT_CONFIG = {
  port: 7788,
  folders: [],
  llm: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: '' }
};

/* ---------------- 配置读写 ---------------- */
function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      port: raw.port || DEFAULT_CONFIG.port,
      folders: Array.isArray(raw.folders) ? raw.folders : [],
      llm: Object.assign({}, DEFAULT_CONFIG.llm, raw.llm || {})
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}

let CONFIG = readConfig();

/* ---------------- 工具 ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.h',
  '.cpp', '.cs', '.go', '.rs', '.sql', '.html', '.htm', '.css', '.scss', '.less', '.xml', '.yml',
  '.yaml', '.toml', '.ini', '.cfg', '.conf', '.csv', '.tsv', '.log', '.sh', '.bat', '.ps1',
  '.ipynb', '.gitignore', '.env', '.r', '.m', '.vue', '.kt', '.swift', '.php', '.rb'
]);

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico']);

/* ---------------- 路径安全 ---------------- */
function folderById(id) {
  return CONFIG.folders.find((f) => f.id === id) || null;
}

function resolveSafe(root, sub) {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, sub || '.');
  const rel = path.relative(rootAbs, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('路径越界，已拒绝访问');
  }
  return target;
}

/* ---------------- 统计 ---------------- */
function stats() {
  const t = today();
  const weekAgo = addDays(t, -6);
  const tasks = db.prepare('SELECT * FROM tasks').all();
  const open = tasks.filter((x) => x.status !== 'done');
  const overdue = open.filter((x) => x.due_date && x.due_date < t);
  const dueToday = open.filter((x) => x.due_date === t);
  const doing = open.filter((x) => x.status === 'doing');
  const weekDone = tasks.filter((x) => x.status === 'done' && x.done_at && x.done_at >= weekAgo);
  const logs = db.prepare('SELECT * FROM logs ORDER BY date DESC, id DESC').all();
  const logsWeek = logs.filter((x) => x.date && x.date >= weekAgo);
  const minutesWeek = logsWeek.reduce((s, x) => s + (x.duration || 0), 0);
  const interviews = db.prepare('SELECT * FROM interviews').all();
  const ieltsCats = ['听力', '阅读', '写作', '口语'];
  const ielts = {};
  for (const c of ieltsCats) {
    const row = db.prepare(
      "SELECT score, date FROM logs WHERE module='雅思' AND category=? AND score IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1"
    ).get(c);
    ielts[c] = row ? row.score : null;
  }
  const ideas = db.prepare('SELECT * FROM ideas').all();
  const reviews = db.prepare('SELECT * FROM reviews').all();
  const reviewsWeek = reviews.filter((x) => x.date && x.date >= weekAgo);
  return {
    pending: open.length,
    doing: doing.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    weekDone: weekDone.length,
    totalDone: tasks.filter((x) => x.status === 'done').length,
    interviewsTotal: interviews.length,
    interviewsPending: interviews.filter((x) => x.result === 'pending').length,
    interviewsPass: interviews.filter((x) => x.result === 'pass').length,
    minutesWeek,
    logsWeekCount: logsWeek.length,
    ielts,
    ideasRaw: ideas.filter((x) => !x.converted).length,
    reviewsTotal: reviews.length,
    reviewsWeek: reviewsWeek.length,
    reviewsMinutesWeek: reviewsWeek.reduce((s, x) => s + (x.minutes || 0), 0)
  };
}

/* ---------------- 任务 CRUD ---------------- */
function listTasks(q) {
  let sql = 'SELECT * FROM tasks';
  const args = [];
  const wh = [];
  if (q.get('module')) { wh.push('module = ?'); args.push(q.get('module')); }
  if (q.get('status')) { wh.push('status = ?'); args.push(q.get('status')); }
  if (wh.length) sql += ' WHERE ' + wh.join(' AND ');
  sql += " ORDER BY CASE status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 ELSE 2 END, COALESCE(due_date, '9999-12-31'), id DESC";
  return db.prepare(sql).all(...args);
}

function createTask(t) {
  const ts = nowISO();
  const stmt = db.prepare(
    'INSERT INTO tasks (title, notes, module, priority, status, due_date, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  );
  const r = stmt.run(
    String(t.title || '未命名任务').slice(0, 200),
    String(t.notes || ''),
    String(t.module || '实习准备'),
    String(t.priority || 'P1'),
    String(t.status || 'todo'),
    t.due_date || null,
    String(t.source || 'manual'),
    ts, ts
  );
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid);
}

function updateTask(id, p) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!row) return null;
  const fields = ['title', 'notes', 'module', 'priority', 'status', 'due_date'];
  const set = [];
  const args = [];
  for (const f of fields) {
    if (f in p) { set.push(f + ' = ?'); args.push(p[f] === '' && f === 'due_date' ? null : p[f]); }
  }
  if ('status' in p) {
    set.push('done_at = ?');
    args.push(p.status === 'done' ? today() : null);
  }
  set.push('updated_at = ?');
  args.push(nowISO());
  args.push(id);
  db.prepare('UPDATE tasks SET ' + set.join(', ') + ' WHERE id = ?').run(...args);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

/* ---------------- LLM 规划 ---------------- */
function extractJSON(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

async function llmPlan(body) {
  const cfg = CONFIG.llm;
  if (!cfg.apiKey) throw new Error('还没配置 API Key，请先到「设置」里填写');
  const goal = String(body.goal || '').trim();
  if (!goal) throw new Error('请先写下你想达成的目标');

  const days = Math.max(1, Math.min(60, Number(body.days) || 7));
  const hours = Number(body.hours) || 2;
  const module = String(body.module || '实习准备');
  const start = today();
  const end = addDays(start, days - 1);
  const maxTasks = Math.max(5, Math.min(20, Number(body.maxTasks) || Math.min(14, days * 2)));

  const sys = '你是一名任务规划教练，擅长把模糊目标拆成可执行、可验收的小任务。你只输出合法 JSON，不输出任何多余文字。';
  const user = [
    '背景：计算机科学与技术（人工智能与大数据方向）大四学生。',
    '求职方向：AI产品经理 / AI开发（需要能拿出竞品分析、PRD、可运行的 Agent 产品）。',
    '同时备考雅思：当前 6.0，目标 6.5（听说读写都要）。',
    '',
    '本次要拆解的目标：' + goal,
    '归属模块：' + module,
    '周期：' + days + ' 天（' + start + ' 至 ' + end + '），每天可投入约 ' + hours + ' 小时',
    '补充限制：' + (body.context || '无'),
    '',
    '要求：',
    '1) 拆分 ' + Math.min(5, maxTasks) + '-' + maxTasks + ' 个任务，每个 30-120 分钟可完成；',
    '2) 任务要具体到「做什么 + 交付物」，例如「完成 XX 竞品 3 家功能矩阵表（Excel）」；',
    '3) 优先级只用 P0 / P1 / P2；',
    '4) due_date 必须是 ' + start + ' 到 ' + end + ' 之间的 YYYY-MM-DD 日期，按顺序铺开；',
    '5) 模块字段统一填 "' + module + '"；',
    '6) 只输出如下结构的 JSON：',
    '{"summary":"一句话说明你的拆解策略","tasks":[{"title":"任务名","notes":"怎么做/验收标准","priority":"P1","due_date":"' + start + '","module":"' + module + '"}]}'
  ].join('\n');

  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ]
    }),
    signal: AbortSignal.timeout(90000)
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error('模型调用失败 HTTP ' + resp.status + '：' + txt.slice(0, 300));
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = extractJSON(content);
  if (!parsed || !Array.isArray(parsed.tasks)) {
    throw new Error('模型返回的内容不是预期格式，请重试或换模型。原始返回：' + content.slice(0, 200));
  }

  const tasks = parsed.tasks.slice(0, maxTasks).map((t) => {
    let due = String(t.due_date || start);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) due = start;
    if (due < start) due = start;
    if (due > end) due = end;
    return {
      title: String(t.title || '').slice(0, 120),
      notes: String(t.notes || ''),
      priority: ['P0', 'P1', 'P2'].includes(t.priority) ? t.priority : 'P1',
      due_date: due,
      module: String(t.module || module),
      source: 'llm',
      status: 'todo'
    };
  }).filter((t) => t.title);

  return { summary: String(parsed.summary || ''), tasks };
}

/* ---------------- 路由 ---------------- */
async function handleApi(req, res, u) {
  const p = u.pathname;
  const q = u.searchParams;
  const method = req.method;

  /* 汇总数据 */
  if (p === '/api/bootstrap' && method === 'GET') {
    return json(res, 200, {
      tasks: listTasks(q),
      ideas: db.prepare('SELECT * FROM ideas ORDER BY pinned DESC, id DESC').all(),
      reviews: db.prepare('SELECT * FROM reviews ORDER BY COALESCE(date,\'\') DESC, id DESC').all(),
      interviews: db.prepare('SELECT * FROM interviews ORDER BY COALESCE(date,\'\') DESC, id DESC').all(),
      logs: db.prepare('SELECT * FROM logs ORDER BY COALESCE(date,\'\') DESC, id DESC').all(),
      folders: CONFIG.folders,
      settings: {
        llm: {
          baseUrl: CONFIG.llm.baseUrl,
          model: CONFIG.llm.model,
          hasKey: !!CONFIG.llm.apiKey,
          keyTail: CONFIG.llm.apiKey ? CONFIG.llm.apiKey.slice(-4) : ''
        },
        port: CONFIG.port
      },
      stats: stats(),
      today: today()
    });
  }

  /* 任务 */
  if (p === '/api/tasks' && method === 'GET') return json(res, 200, listTasks(q));
  if (p === '/api/tasks' && method === 'POST') {
    const b = await readBody(req);
    if (!b.title) return json(res, 400, { error: '缺少 title' });
    return json(res, 200, createTask(b));
  }
  if (p === '/api/tasks/bulk' && method === 'POST') {
    const b = await readBody(req);
    const out = [];
    for (const t of (b.tasks || [])) out.push(createTask(t));
    return json(res, 200, { created: out.length, tasks: out });
  }
  let m = p.match(/^\/api\/tasks\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'PATCH') {
      const b = await readBody(req);
      const r = updateTask(id, b);
      return r ? json(res, 200, r) : json(res, 404, { error: '任务不存在' });
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }

  /* 完成任务 = 标记 done + 同时落一条复盘（没写复盘就不给过） */
  const mc = p.match(/^\/api\/tasks\/(\d+)\/complete$/);
  if (mc && method === 'POST') {
    const id = Number(mc[1]);
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) return json(res, 404, { error: '任务不存在' });
    const b = await readBody(req);
    const content = String(b.content || '').trim();
    const learned = String(b.learned || '').trim();
    if (!content) return json(res, 400, { error: '先写一句「做到哪一步」，这条才算完成' });
    if (!learned) return json(res, 400, { error: '再写一句「学到了什么」，这条才算真的完成' });
    updateTask(id, { status: 'done' });
    const r = db.prepare(
      'INSERT INTO reviews (task_id, task_title, module, content, learned, minutes, date, created_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      id, String(task.title || '').slice(0, 200), String(task.module || ''),
      content.slice(0, 1200), learned.slice(0, 2000),
      Math.max(0, Number(b.minutes) || 0), today(), nowISO()
    );
    return json(res, 200, {
      task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(id),
      review: db.prepare('SELECT * FROM reviews WHERE id = ?').get(r.lastInsertRowid)
    });
  }

  /* 复盘日记 */
  if (p === '/api/reviews' && method === 'GET') {
    return json(res, 200, db.prepare('SELECT * FROM reviews ORDER BY COALESCE(date,\'\') DESC, id DESC').all());
  }
  const mr = p.match(/^\/api\/reviews\/(\d+)$/);
  if (mr && method === 'DELETE') {
    db.prepare('DELETE FROM reviews WHERE id = ?').run(Number(mr[1]));
    return json(res, 200, { ok: true });
  }

  /* 灵感 */
  if (p === '/api/ideas' && method === 'GET') {
    return json(res, 200, db.prepare('SELECT * FROM ideas ORDER BY pinned DESC, id DESC').all());
  }
  if (p === '/api/ideas' && method === 'POST') {
    const b = await readBody(req);
    if (!b.content) return json(res, 400, { error: '缺少 content' });
    const r = db.prepare('INSERT INTO ideas (content, tag, module, converted, created_at) VALUES (?,?,?,0,?)')
      .run(String(b.content).slice(0, 2000), String(b.tag || ''), String(b.module || '灵感'), nowISO());
    return json(res, 200, db.prepare('SELECT * FROM ideas WHERE id = ?').get(r.lastInsertRowid));
  }
  m = p.match(/^\/api\/ideas\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === 'PATCH') {
      const b = await readBody(req);
      const cur = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
      if (!cur) return json(res, 404, { error: '灵感不存在' });
      db.prepare('UPDATE ideas SET content = ?, tag = ?, module = ?, converted = ?, pinned = ? WHERE id = ?').run(
        'content' in b ? String(b.content).slice(0, 2000) : cur.content,
        'tag' in b ? String(b.tag) : cur.tag,
        'module' in b ? String(b.module) : cur.module,
        'converted' in b ? (b.converted ? 1 : 0) : cur.converted,
        'pinned' in b ? (b.pinned ? 1 : 0) : cur.pinned,
        id
      );
      return json(res, 200, db.prepare('SELECT * FROM ideas WHERE id = ?').get(id));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }
  m = p.match(/^\/api\/ideas\/(\d+)\/to-task$/);
  if (m && method === 'POST') {
    const b = await readBody(req);
    const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(Number(m[1]));
    if (!idea) return json(res, 404, { error: '灵感不存在' });
    const t = createTask({
      title: b.title || idea.content.slice(0, 80),
      notes: idea.content,
      module: b.module || '实习准备',
      priority: b.priority || 'P1',
      due_date: b.due_date || null,
      source: 'idea'
    });
    db.prepare('UPDATE ideas SET converted = 1 WHERE id = ?').run(idea.id);
    return json(res, 200, t);
  }

  /* 面试 */
  if (p === '/api/interviews' && method === 'GET') {
    return json(res, 200, db.prepare('SELECT * FROM interviews ORDER BY COALESCE(date,\'\') DESC, id DESC').all());
  }
  if (p === '/api/interviews' && method === 'POST') {
    const b = await readBody(req);
    if (!b.company) return json(res, 400, { error: '缺少 company' });
    const ts = nowISO();
    const r = db.prepare('INSERT INTO interviews (company, position, stage, date, result, questions, reflection, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(String(b.company), String(b.position || ''), String(b.stage || '一面'), b.date || today(),
        String(b.result || 'pending'), String(b.questions || ''), String(b.reflection || ''), ts, ts);
    return json(res, 200, db.prepare('SELECT * FROM interviews WHERE id = ?').get(r.lastInsertRowid));
  }
  m = p.match(/^\/api\/interviews\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    const cur = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
    if (!cur) return json(res, 404, { error: '记录不存在' });
    if (method === 'PATCH') {
      const b = await readBody(req);
      const get = (k, v) => (k in b ? String(b[k]) : v);
      db.prepare('UPDATE interviews SET company=?, position=?, stage=?, date=?, result=?, questions=?, reflection=?, updated_at=? WHERE id=?')
        .run(get('company', cur.company), get('position', cur.position), get('stage', cur.stage),
          get('date', cur.date), get('result', cur.result), get('questions', cur.questions),
          get('reflection', cur.reflection), nowISO(), id);
      return json(res, 200, db.prepare('SELECT * FROM interviews WHERE id = ?').get(id));
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM interviews WHERE id = ?').run(id);
      return json(res, 200, { ok: true });
    }
  }

  /* 学习 / 雅思记录 */
  if (p === '/api/logs' && method === 'GET') {
    return json(res, 200, db.prepare('SELECT * FROM logs ORDER BY COALESCE(date,\'\') DESC, id DESC').all());
  }
  if (p === '/api/logs' && method === 'POST') {
    const b = await readBody(req);
    const r = db.prepare('INSERT INTO logs (module, category, title, content, score, duration, date, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(String(b.module || '雅思'), String(b.category || ''), String(b.title || ''),
        String(b.content || ''), b.score === '' || b.score === undefined || b.score === null ? null : Number(b.score),
        Number(b.duration) || 0, b.date || today(), nowISO());
    return json(res, 200, db.prepare('SELECT * FROM logs WHERE id = ?').get(r.lastInsertRowid));
  }
  m = p.match(/^\/api\/logs\/(\d+)$/);
  if (m && method === 'DELETE') {
    db.prepare('DELETE FROM logs WHERE id = ?').run(Number(m[1]));
    return json(res, 200, { ok: true });
  }

  /* 设置 */
  if (p === '/api/settings' && method === 'POST') {
    const b = await readBody(req);
    if (b.llm) {
      if (b.llm.baseUrl) CONFIG.llm.baseUrl = String(b.llm.baseUrl).trim();
      if (b.llm.model) CONFIG.llm.model = String(b.llm.model).trim();
      if (b.llm.apiKey) CONFIG.llm.apiKey = String(b.llm.apiKey).trim();
      if (b.llm.apiKey === '') CONFIG.llm.apiKey = '';
    }
    writeConfig(CONFIG);
    return json(res, 200, { ok: true });
  }

  /* 挂载文件夹 */
  if (p === '/api/folders' && method === 'POST') {
    const b = await readBody(req);
    const fp = String(b.path || '').trim();
    if (!fp) return json(res, 400, { error: '缺少路径' });
    if (!fs.existsSync(fp)) return json(res, 400, { error: '路径不存在：' + fp });
    const stat = fs.statSync(fp);
    if (!stat.isDirectory()) return json(res, 400, { error: '不是文件夹' });
    const label = String(b.label || path.basename(fp) || fp);
    if (CONFIG.folders.some((f) => path.resolve(f.path) === path.resolve(fp))) {
      return json(res, 400, { error: '该文件夹已添加' });
    }
    CONFIG.folders.push({ id: Date.now().toString(36), label, path: path.resolve(fp) });
    writeConfig(CONFIG);
    return json(res, 200, CONFIG.folders);
  }
  m = p.match(/^\/api\/folders\/([A-Za-z0-9]+)$/);
  if (m && method === 'DELETE') {
    CONFIG.folders = CONFIG.folders.filter((f) => f.id !== m[1]);
    writeConfig(CONFIG);
    return json(res, 200, CONFIG.folders);
  }

  /* 文件浏览 */
  if (p === '/api/files' && method === 'GET') {
    const f = folderById(q.get('folder'));
    if (!f) return json(res, 404, { error: '未找到该文件夹' });
    const sub = q.get('sub') || '';
    let dir;
    try { dir = resolveSafe(f.path, sub); } catch (e) { return json(res, 403, { error: e.message }); }
    if (!fs.existsSync(dir)) return json(res, 404, { error: '目录不存在' });
    const names = fs.readdirSync(dir, { withFileTypes: true });
    const entries = [];
    for (const d of names) {
      if (entries.length > 600) break;
      const full = path.join(dir, d.name);
      let size = 0, mtime = 0;
      try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs; } catch { continue; }
      entries.push({ name: d.name, dir: d.isDirectory(), size, mtime, ext: path.extname(d.name).toLowerCase() });
    }
    entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'zh'));
    return json(res, 200, { folder: f, sub, entries, parent: sub ? path.dirname(sub).replace(/\\/g, '/').replace(/^\.$/, '') : null });
  }

  /* 预览：文本内容 */
  if (p === '/api/text' && method === 'GET') {
    const f = folderById(q.get('folder'));
    if (!f) return json(res, 404, { error: '未找到该文件夹' });
    let full;
    try { full = resolveSafe(f.path, q.get('sub')); } catch (e) { return json(res, 403, { error: e.message }); }
    if (!fs.existsSync(full)) return json(res, 404, { error: '文件不存在' });
    const st = fs.statSync(full);
    if (st.size > 4 * 1024 * 1024) return json(res, 200, { tooLarge: true, size: st.size, truncated: false });
    let buf = fs.readFileSync(full);
    let text = buf.toString('utf8');
    // 处理非 UTF-8 的常见中文文本（GBK）
    if (text.includes('\uFFFD')) {
      try {
        const dec = new TextDecoder('gbk');
        const alt = dec.decode(buf);
        if (!alt.includes('\uFFFD')) text = alt;
      } catch {}
    }
    return json(res, 200, { text, size: st.size });
  }

  /* 预览：二进制流 */
  if (p === '/api/raw' && method === 'GET') {
    const f = folderById(q.get('folder'));
    if (!f) return json(res, 404, { error: '未找到该文件夹' });
    let full;
    try { full = resolveSafe(f.path, q.get('sub')); } catch (e) { return json(res, 403, { error: e.message }); }
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return json(res, 404, { error: '文件不存在' });
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    const size = fs.statSync(full).size;
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = s ? Number(s) : 0;
      const end = e ? Number(e) : Math.min(start + 1024 * 1024, size - 1);
      if (start >= size) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + size });
        return res.end();
      }
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1
      });
      fs.createReadStream(full, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline; filename="' + encodeURIComponent(path.basename(full)) + '"'
    });
    fs.createReadStream(full).pipe(res);
    return;
  }

  /* 用系统默认程序打开 */
  if (p === '/api/open' && method === 'POST') {
    const b = await readBody(req);
    const f = folderById(b.folder);
    if (!f) return json(res, 404, { error: '未找到该文件夹' });
    let full;
    try { full = resolveSafe(f.path, b.sub); } catch (e) { return json(res, 403, { error: e.message }); }
    if (!fs.existsSync(full)) return json(res, 404, { error: '文件不存在' });
    try {
      const child = spawn('explorer.exe', [full], { detached: true, stdio: 'ignore' });
      child.unref();
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { error: '打开失败：' + e.message });
    }
  }

  /* LLM 规划 */
  if (p === '/api/llm/plan' && method === 'POST') {
    const b = await readBody(req);
    try {
      const out = await llmPlan(b);
      return json(res, 200, out);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  return json(res, 404, { error: '未知接口 ' + p });
}

/* ---------------- 静态资源 ---------------- */
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

/* ---------------- 启动 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  try {
    if (u.pathname.startsWith('/api/')) return await handleApi(req, res, u);
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, u.pathname);
  } catch (e) {
    console.error('[error]', u.pathname, e.message);
    if (!res.headersSent) json(res, 500, { error: e.message || '服务端异常' });
    else res.end();
  }
});

function openBrowser(url) {
  try {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch {}
}

function start(port, retry) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && retry > 0) {
      console.log('端口 ' + port + ' 被占用，换一个试试…');
      return start(port + 1, retry - 1);
    }
    if (e.code === 'EADDRINUSE') {
      const url = 'http://127.0.0.1:' + port;
      console.log('看起来工作台已经在运行了：' + url);
      if (process.argv.includes('--open')) openBrowser(url);
      process.exit(0);
    }
    console.error(e);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port;
    CONFIG.port = port;
    writeConfig(CONFIG);
    console.log('');
    console.log('  工作台已启动 → ' + url);
    console.log('  数据文件：' + path.join(ROOT, 'data', 'workbench.db'));
    console.log('  关闭这个窗口即可停止服务。');
    console.log('');
    if (process.argv.includes('--open')) openBrowser(url);
  });
}

start(CONFIG.port || 7788, 20);
