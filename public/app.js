'use strict';

/* ================= 全局状态 ================= */
const S = {
  tab: 'home',
  data: null,
  filter: '全部',
  files: { folderId: null, sub: '', entries: null, entry: null, loading: false },
  plan: null,
  planning: false,
  newIdeaId: null,
  deck: { drawnId: null }
};

const MODULES = ['实习准备', '雅思', '知识学习', '项目', '其他'];
const TABS = [
  { id: 'home', label: '工作台' },
  { id: 'tasks', label: '任务看板' },
  { id: 'planner', label: 'AI 规划' },
  { id: 'ideas', label: '灵感库' },
  { id: 'reviews', label: '复盘日记' },
  { id: 'interviews', label: '面试记录' },
  { id: 'logs', label: '学习打卡' },
  { id: 'files', label: '文件预览' },
  { id: 'settings', label: '设置' }
];

/* ================= 基础工具 ================= */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function api(path, method, body) {
  const opt = { method: method || 'GET' };
  if (body !== undefined) {
    opt.headers = { 'Content-Type': 'application/json' };
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(path, opt);
  let d = null;
  try { d = await r.json(); } catch { d = {}; }
  if (!r.ok) throw new Error(d.error || ('请求失败 HTTP ' + r.status));
  return d;
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function todayStr() { return ymd(new Date()); }

function readableDate(s) {
  if (!s) return '';
  const parts = s.split('-');
  if (parts.length !== 3) return s;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const wk = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return Number(parts[1]) + '月' + Number(parts[2]) + '日 ' + wk;
}

function dueLabel(date) {
  if (!date) return '';
  const t = todayStr();
  if (date === t) return { text: '今天', cls: 'due-today' };
  const diff = Math.round((new Date(date + 'T00:00:00') - new Date(t + 'T00:00:00')) / 86400000);
  if (diff < 0) return { text: '逾期 ' + Math.abs(diff) + ' 天', cls: 'due-over' };
  if (diff === 1) return { text: '明天', cls: '' };
  if (diff <= 7) return { text: diff + ' 天后', cls: '' };
  return { text: date.slice(5), cls: '' };
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/* 极简 Markdown 渲染 */
function mdToHtml(md) {
  const blocks = [];
  let src = String(md).replace(/\r\n/g, '\n');

  src = src.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return '\u0000B' + (blocks.length - 1) + '\u0000';
  });

  let out = esc(src);

  out = out.replace(/^###### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^##### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^#### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^\s*&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\s*(---|\*\*\*)\s*$/gm, '<hr />');

  out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

  const lines = out.split('\n');
  const res = [];
  let inUl = false, inOl = false;
  for (const line of lines) {
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul) {
      if (inOl) { res.push('</ol>'); inOl = false; }
      if (!inUl) { res.push('<ul>'); inUl = true; }
      res.push('<li>' + ul[1] + '</li>');
    } else if (ol) {
      if (inUl) { res.push('</ul>'); inUl = false; }
      if (!inOl) { res.push('<ol>'); inOl = true; }
      res.push('<li>' + ol[1] + '</li>');
    } else {
      if (inUl) { res.push('</ul>'); inUl = false; }
      if (inOl) { res.push('</ol>'); inOl = false; }
      if (/^\s*<\/(h1|h2|h3|blockquote|hr|pre)/.test(line) || /^\s*<(h1|h2|h3|blockquote|hr|pre)/.test(line)) {
        res.push(line);
      } else if (line.trim() === '') {
        res.push('');
      } else {
        res.push('<p>' + line + '</p>');
      }
    }
  }
  if (inUl) res.push('</ul>');
  if (inOl) res.push('</ol>');

  let html = res.join('\n');
  html = html.replace(/\u0000B(\d+)\u0000/g, (m, i) => blocks[Number(i)]);
  return html;
}

/* ================= 载入 ================= */
async function load() {
  S.data = await api('/api/bootstrap');
  if (S.files.folderId && !S.data.folders.some((f) => f.id === S.files.folderId)) {
    S.files.folderId = null;
    S.files.entries = null;
  }
  render();
}

/* ================= 渲染 ================= */
function render() {
  renderNav();
  renderMain();
}

function renderNav() {
  const d = S.data;
  const nav = document.getElementById('nav');
  const counts = {
    home: d.stats.pending,
    ideas: d.stats.ideasRaw,
    interviews: d.stats.interviewsPending
  };
  nav.innerHTML = TABS.map((t) => {
    const c = counts[t.id];
    return '<button class="nav-item' + (S.tab === t.id ? ' active' : '') + '" data-act="tab" data-tab="' + t.id + '">' +
      '<span>' + t.label + '</span>' +
      (c ? '<span class="count">' + c + '</span>' : '') +
      '</button>';
  }).join('');
}

function renderMain() {
  const main = document.getElementById('main');
  const view = ({
    home: viewHome,
    tasks: viewTasks,
    planner: viewPlanner,
    ideas: viewIdeas,
    reviews: viewReviews,
    interviews: viewInterviews,
    logs: viewLogs,
    files: viewFiles,
    settings: viewSettings
  })[S.tab] || viewHome;
  main.innerHTML = view();
  if (S.tab === 'files') ensureFiles();
}

/* ================= 视图：工作台 ================= */
function viewHome() {
  const d = S.data;
  const st = d.stats;
  const t = todayStr();
  const open = d.tasks.filter((x) => x.status !== 'done');
  const focus = open.filter((x) => x.due_date === t || x.status === 'doing');
  const overdue = open.filter((x) => x.due_date && x.due_date < t);
  const ielts = st.ielts;
  const ieltsFilled = Object.keys(ielts).filter((k) => ielts[k] != null);
  const ieltsAvg = ieltsFilled.length ? (ieltsFilled.reduce((s, k) => s + ielts[k], 0) / ieltsFilled.length) : null;
  const recentIv = d.interviews.slice(0, 3);

  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">${readableDate(t)}</h1>
      <div class="view-sub">${focus.length ? '今天有 ' + focus.length + ' 件事要推进' : '今天没有排定的任务'}${overdue.length ? '，另有 ' + overdue.length + ' 项逾期需要处理' : ''}</div>
    </div>
    <div class="head-actions">
      <button class="btn" data-act="tab" data-tab="planner">让 AI 拆个计划</button>
      <button class="btn primary" data-act="new-task">新建任务</button>
    </div>
  </div>

  <div class="grid cols-4" style="margin-bottom:14px">
    <div class="card stat">
      <div class="num">${st.pending}</div>
      <div class="lbl">待推进任务</div>
      <div class="meter"><i style="width:${Math.min(100, st.pending * 8)}%"></i></div>
    </div>
    <div class="card stat">
      <div class="num">${st.dueToday}</div>
      <div class="lbl">今日到期</div>
      <div class="meter"><i style="width:${st.dueToday ? 100 : 0}%"></i></div>
    </div>
    <div class="card stat">
      <div class="num">${st.weekDone}</div>
      <div class="lbl">本周完成</div>
      <div class="meter"><i style="width:${Math.min(100, st.weekDone * 15)}%"></i></div>
    </div>
    <div class="card stat">
      <div class="num">${ieltsAvg != null ? ieltsAvg.toFixed(1) : '—'}</div>
      <div class="lbl">雅思均值 · 目标 6.5</div>
      <div class="meter"><i style="width:${ieltsAvg != null ? Math.min(100, (ieltsAvg / 9) * 100) : 0}%"></i></div>
    </div>
  </div>

  <div class="grid cols-2" style="align-items:start">
    <div class="card">
      <div class="card-title">今日聚焦</div>
      ${focus.length ? focus.slice(0, 7).map(taskCard).join('') : '<div class="empty">还没有今天的任务<br/>用「AI 规划」把目标拆下来</div>'}
      ${overdue.length ? `<div class="card-title" style="margin:18px 0 10px">逾期</div>${overdue.slice(0, 5).map(taskCard).join('')}` : ''}
    </div>

    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card deck-card-wrap">
        <div class="card-title">灵感 · 一叠卡${d.ideas.length ? ' <span style="font-weight:400;color:var(--muted)">' + d.ideas.length + ' 张</span>' : ''}</div>
        <div class="quick-capture" style="margin-top:2px">
          <input id="quick-idea" placeholder="突然想到的产品点子 / 面试题 / 一句话…" />
          <button class="btn primary" data-act="quick-idea">记下</button>
        </div>
        <div data-idea-target>${ideaDeck(d.ideas)}</div>
      </div>

      <div class="card">
        <div class="card-title">雅思进度</div>
        <div class="grid cols-4" style="gap:8px">
          ${['听力', '阅读', '写作', '口语'].map((k) => `
            <div>
              <div style="font-size:16px;font-weight:600;font-variant-numeric:tabular-nums">${ielts[k] != null ? ielts[k] : '—'}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:3px">${k}</div>
            </div>`).join('')}
        </div>
        <div class="hint-line">本周已投入 ${st.minutesWeek} 分钟，共 ${st.logsWeekCount} 次打卡记录。</div>
      </div>

      <div class="card">
        <div class="card-title">最近复盘</div>
        ${(d.reviews || []).length
          ? (d.reviews || []).slice(0, 3).map((r) => `
            <div class="row">
              <div class="row-main">
                <div class="row-title">${esc(r.task_title || '（无标题任务）')}</div>
                <div class="row-sub">${esc(String(r.learned || '').slice(0, 46))}</div>
              </div>
              <div style="font-size:10.5px;color:var(--faint);flex:0 0 auto;padding-top:2px">${esc((r.date || '').slice(5).replace('-', '/'))}</div>
            </div>`).join('')
          : '<div class="empty">勾完任务写下「学到什么」，会记在这里</div>'}
        <div class="hint-line"><a data-act="tab" data-tab="reviews">全部复盘（${(d.reviews || []).length}）</a></div>
      </div>

      <div class="card">
        <div class="card-title">近期面试</div>
        ${recentIv.length ? recentIv.map((iv) => `
          <div class="row" data-act="open-interview" data-id="${iv.id}" style="cursor:pointer">
            <div class="row-main">
              <div class="row-title">${esc(iv.company)} · ${esc(iv.position || iv.stage)}</div>
              <div class="row-sub">${esc(iv.date || '')} · ${esc(iv.stage)} · ${resultText(iv.result)}</div>
            </div>
          </div>`).join('') : '<div class="empty">还没有面试记录</div>'}
      </div>
    </div>
  </div>`;
}

function resultText(r) {
  return { pending: '待结果', pass: '通过', fail: '未通过' }[r] || '待结果';
}

function taskCard(t) {
  const due = dueLabel(t.due_date);
  const done = t.status === 'done';
  return `
  <div class="task${done ? ' done' : ''}" data-act="open-task" data-id="${t.id}">
    <div class="t-row">
      <div class="t-check${done ? ' on' : ''}" data-act="toggle-task" data-id="${t.id}" data-status="${t.status}"></div>
      <div class="t-title">${esc(t.title)}</div>
    </div>
    ${t.notes ? '<div class="t-notes">' + esc(t.notes) + '</div>' : ''}
    <div class="t-meta">
      <span class="pill ${t.priority === 'P0' ? 'p0' : t.priority === 'P1' ? 'p1' : ''}">${esc(t.priority)}</span>
      <span class="pill">${esc(t.module)}</span>
      ${due ? `<span class="pill ${due.cls}">${due.text}</span>` : ''}
      ${t.source === 'llm' ? '<span class="pill">AI</span>' : ''}
    </div>
  </div>`;
}

/* 灵感条目（灵感库页用） */
function ideaRow(it, opts) {
  const isNew = S.newIdeaId === it.id;
  return `
  <div class="idea-row${isNew ? ' new' : ''}">
    <span class="idea-mark"></span>
    <div class="idea-body">
      <div class="idea-txt">${esc(it.content)}</div>
      <div class="idea-meta">${esc((it.created_at || '').slice(5, 10).replace('-', '/'))}${it.tag ? ' · #' + esc(it.tag) : ''}${it.converted ? ' · 已转任务' : ''}${it.pinned ? ' · 已置顶' : ''}</div>
    </div>
    ${it.pinned ? '<span class="pill">置顶</span>' : ''}
    ${it.converted
      ? '<span class="pill">已转</span>'
      : `<button class="btn sm ghost" data-act="idea-to-task" data-id="${it.id}">开始做</button>`}
    ${opts && opts.del ? `<button class="btn sm ghost" data-act="idea-pin" data-id="${it.id}" data-pinned="${it.pinned ? 1 : 0}">${it.pinned ? '取消置顶' : '置顶'}</button>` : ''}
    ${opts && opts.del ? `<button class="btn sm ghost" data-act="idea-del" data-id="${it.id}">删除</button>` : ''}
  </div>`;
}

/* 灵感牌堆：最新/置顶的当「最上面那张」，鼠标放上去扇形展开，可洗牌抽一张 */
function ideaDeck(all) {
  if (!all.length) {
    return '<div class="empty" style="padding:30px 16px;font-size:11.5px;line-height:1.8">还没有灵感，上面随手记一条<br/>记下的会叠成一叠卡，鼠标放上去自动展开</div>';
  }
  const drawnIdea = S.deck.drawnId ? all.find((x) => x.id === S.deck.drawnId) : null;
  const hero = drawnIdea || all[0];
  const others = all.filter((x) => x.id !== hero.id).slice(0, 4).reverse();
  const list = others.concat([hero]);
  const n = list.length;
  const c = (n - 1) / 2;

  const cards = list.map((it, i) => {
    const k = i - c;
    const cls = [
      'deck-card',
      it.pinned ? 'pinned' : '',
      S.deck.drawnId === it.id ? 'drawn' : '',
      S.newIdeaId === it.id ? 'fresh' : ''
    ].filter(Boolean).join(' ');
    const dateStr = (it.created_at || '').slice(5, 10).replace('-', '/');
    return `
    <button class="${cls}" style="--i:${k};--ay:${(k * k * 3.4).toFixed(1)}px;z-index:${i + 1}"
      data-act="open-idea" data-id="${it.id}" title="点击查看 / 编辑">
      <div class="dc-top">
        <span class="dc-date">${esc(dateStr)}</span>
        ${it.converted ? '<span class="dc-pin ghost">已转任务</span>' : ''}
        ${it.pinned ? '<span class="dc-pin">置顶</span>' : ''}
      </div>
      <div class="dc-text">${esc(it.content)}</div>
      <div class="dc-foot"><span class="dc-tag${it.tag ? '' : ' dim'}">${it.tag ? '#' + esc(it.tag) : '灵感'}</span></div>
    </button>`;
  }).join('');

  const more = all.length - n;
  return `
  <div class="deck-stage" data-deck>${cards}</div>
  <div class="deck-foot">
    <button class="btn sm ghost" data-act="deck-shuffle">洗牌抽一张</button>
    ${S.deck.drawnId ? '<button class="btn sm ghost" data-act="deck-return">放回去</button>' : ''}
    <span class="hint-line" style="margin:0 0 0 auto">${more > 0 ? '另有 ' + more + ' 张 · ' : ''}<a data-act="tab" data-tab="ideas">查看全部</a></span>
  </div>`;
}

/* 灵感详情：点卡片打开，可改内容 / 标签 / 置顶 / 转任务 / 删除 */
function ideaEditor(it) {
  modal('灵感', `
    <label class="f"><span>内容</span><textarea id="i2-content" rows="5">${esc(it.content)}</textarea></label>
    <div class="grid cols-2" style="margin-top:13px">
      <label class="f"><span>标签</span><input id="i2-tag" value="${esc(it.tag || '')}" placeholder="可选，如 产品 / 面试题" /></label>
      <label class="f"><span>排在牌堆里</span>
        <select id="i2-pinned">
          <option value="0"${it.pinned ? '' : ' selected'}>按时间（最新在上）</option>
          <option value="1"${it.pinned ? ' selected' : ''}>置顶到最上面</option>
        </select>
      </label>
    </div>
    <div class="hint-line">记于 ${esc((it.created_at || '').slice(0, 10))}${it.converted ? ' · 已转成任务' : ''}</div>
  `, `
    <button class="btn ghost" data-act="idea-del" data-id="${it.id}">删除</button>
    <div style="flex:1"></div>
    ${it.converted ? '' : `<button class="btn" data-act="idea-to-task" data-id="${it.id}">开始做</button>`}
    <button class="btn primary" data-act="save-idea" data-id="${it.id}">保存</button>
  `);
}

/* 完成任务时强制写的复盘 */
function reviewEditor(t) {
  modal('完成 · ' + String(t.title || '').slice(0, 20), `
    <div class="rev-task">${esc(t.title || '')}</div>
    <label class="f"><span>实际做到哪一步 / 交付物</span>
      <textarea id="rv-content" rows="3" placeholder="例：跑通 3 个 query，回收 12 条结果，截图放进项目文件夹"></textarea>
    </label>
    <label class="f" style="margin-top:12px"><span>学到了什么</span>
      <textarea id="rv-learned" rows="3" placeholder="例：中文短 query 对 chunk 大小很敏感，切太碎反而召回不准"></textarea>
    </label>
    <div class="grid cols-2" style="margin-top:12px">
      <label class="f"><span>用时（分钟，可选）</span><input id="rv-min" type="number" min="0" placeholder="45" /></label>
      <div class="f"><span>模块</span><div style="font-size:12.5px;color:var(--muted);padding-top:5px">${esc(t.module || '未分类')}</div></div>
    </div>
    <div class="hint-line">写下来才会落成完成 —— 这样回头看才知道这条是真的做完了，还是被划掉了。</div>
  `, `
    <button class="btn ghost" data-act="modal-close">还没做完</button>
    <div style="flex:1"></div>
    <button class="btn primary" data-act="save-review" data-id="${t.id}">标记完成，记进复盘</button>
  `);
}

/* 纸飞机入档动效：从按钮飞向灵感列表 */
function flyPlane(fromEl, toEl) {
  return new Promise((resolve) => {
    if (!fromEl || !toEl || !fromEl.getBoundingClientRect) return resolve();
    const f = fromEl.getBoundingClientRect();
    const t = toEl.getBoundingClientRect();
    if (!f.width || !t.width) return resolve();
    const sx = f.left + f.width / 2, sy = f.top + f.height / 2;
    const tx = t.left + Math.min(t.width / 2, 150);
    const ty = t.top + 22;
    const plane = document.createElement('div');
    plane.className = 'plane-fx';
    plane.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M2.4 12.2 21 3.3 13.6 21l-2.7-7.5-8.5-1.3z" fill="currentColor"/></svg>';
    plane.style.left = sx + 'px';
    plane.style.top = sy + 'px';
    plane.style.setProperty('--dx', (tx - sx) + 'px');
    plane.style.setProperty('--dy', (ty - sy) + 'px');
    document.body.appendChild(plane);
    setTimeout(() => { plane.remove(); resolve(); }, 620);
  });
}

/* ================= 视图：任务看板 ================= */
function viewTasks() {
  const d = S.data;
  const mods = ['全部'].concat(MODULES);
  const list = S.filter === '全部' ? d.tasks : d.tasks.filter((x) => x.module === S.filter);
  const cols = [
    { key: 'todo', label: '待办' },
    { key: 'doing', label: '进行中' },
    { key: 'done', label: '已完成' }
  ];
  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">任务看板</h1>
      <div class="view-sub">共 ${d.tasks.length} 个任务 · 待办 ${d.stats.pending} · 逾期 ${d.stats.overdue}</div>
    </div>
    <div class="head-actions"><button class="btn primary" data-act="new-task">新建任务</button></div>
  </div>

  <div class="chips">
    ${mods.map((m) => `<button class="chip${S.filter === m ? ' active' : ''}" data-act="filter" data-module="${m}">${m}</button>`).join('')}
  </div>

  <div class="kanban">
    ${cols.map((c) => {
      const items = list.filter((x) => x.status === c.key);
      return `<div>
        <div class="col-head">${c.label}<span class="n">${items.length}</span></div>
        <div class="col-body">
          ${items.length ? items.map(taskCard).join('') : '<div class="empty" style="padding:16px;font-size:11.5px">空</div>'}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

/* ================= 视图：AI 规划 ================= */
function viewPlanner() {
  const cfg = S.data.settings.llm;
  const plan = S.plan;
  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">AI 任务规划</h1>
      <div class="view-sub">写下一个模糊目标，让模型拆成能当天动手的小任务。${cfg.hasKey ? '' : '（还没填 API Key，先到设置里配）'}</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="field">
      <label class="f"><span>目标</span>
        <textarea id="plan-goal" placeholder="例如：两周内做出一个能投递的 Agent 产品 Demo，并把竞品分析写进简历"></textarea>
      </label>
    </div>
    <div class="grid cols-3" style="margin-top:13px">
      <label class="f"><span>模块</span>
        <select id="plan-module">${MODULES.map((m) => `<option>${m}</option>`).join('')}</select>
      </label>
      <label class="f"><span>周期（天）</span><input id="plan-days" type="number" min="1" max="60" value="7" /></label>
      <label class="f"><span>每天可投入（小时）</span><input id="plan-hours" type="number" min="1" max="16" value="2" /></label>
    </div>
    <div class="field" style="margin-top:13px">
      <label class="f"><span>补充限制（可选）</span>
        <input id="plan-context" placeholder="例如：周三有课，晚上才有空；已有 Python 基础但对 RAG 不熟" />
      </label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;align-items:center">
      ${!cfg.hasKey ? '<span class="hint-line" style="margin:0 auto 0 0">当前模型：未配置</span>' : `<span class="hint-line" style="margin:0 auto 0 0">当前模型：${esc(cfg.model)}</span>`}
      <button class="btn primary" data-act="run-plan" ${S.planning ? 'disabled' : ''}>
        ${S.planning ? '<span class="spin"></span>拆解中…' : '生成计划'}
      </button>
    </div>
  </div>

  ${plan ? `
  <div class="card">
    <div class="card-title">拆解结果</div>
    ${plan.summary ? `<div class="row-sub" style="margin-bottom:12px">${esc(plan.summary)}</div>` : ''}
    <div class="plan-out">
      ${plan.tasks.map((t, i) => `
        <div class="plan-task${plan.skip[i] ? ' off' : ''}" data-act="plan-toggle" data-i="${i}">
          <div class="pk">${plan.skip[i] ? '' : '✓'}</div>
          <div class="row-main">
            <div class="row-title">${esc(t.title)}</div>
            ${t.notes ? `<div class="row-sub">${esc(t.notes)}</div>` : ''}
            <div class="t-meta"><span class="pill ${t.priority === 'P0' ? 'p0' : 'p1'}">${esc(t.priority)}</span><span class="pill">${esc(t.due_date)}</span><span class="pill">${esc(t.module)}</span></div>
          </div>
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
      <button class="btn ghost" data-act="plan-clear">清空</button>
      <button class="btn primary" data-act="plan-apply">加入任务板（${plan.tasks.filter((_, i) => !plan.skip[i]).length}）</button>
    </div>
  </div>` : ''}`;
}

/* ================= 视图：灵感库 ================= */
function viewIdeas() {
  const ideas = S.data.ideas;
  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">灵感库</h1>
      <div class="view-sub">先记下来，再决定要不要做。共 ${ideas.length} 条，其中 ${S.data.stats.ideasRaw} 条还没转成任务。</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="quick-capture">
      <input id="idea-input" placeholder="产品点子、竞品观察、面试题、论文想法…" />
      <input id="idea-tag" style="max-width:160px" placeholder="标签（可选）" />
      <button class="btn primary" data-act="add-idea">记下</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">全部灵感 · ${ideas.length} 条</div>
    <div class="idea-list" data-idea-target>
      ${ideas.length
        ? ideas.map((it) => ideaRow(it, { del: true })).join('')
        : '<div class="empty">还没有灵感。上面随手记一条试试。</div>'}
    </div>
  </div>`;
}

/* ================= 视图：复盘日记 ================= */
function viewReviews() {
  const reviews = S.data.reviews || [];
  const st = S.data.stats;
  const groups = {};
  for (const r of reviews) {
    const k = r.date || '未记日期';
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  }
  const keys = Object.keys(groups).sort().reverse();

  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">复盘日记</h1>
      <div class="view-sub">勾完任务要写下「做到哪一步 + 学到什么」才会落成完成。共 ${reviews.length} 条，本周 ${st.reviewsWeek || 0} 条、约 ${st.reviewsMinutesWeek || 0} 分钟。</div>
    </div>
  </div>

  ${reviews.length ? keys.map((k) => `
    <div class="card" style="margin-bottom:12px">
      <div class="card-title">${esc(k === '未记日期' ? k : readableDate(k))}</div>
      ${groups[k].map((r) => `
        <div class="review-item">
          <div class="rv-head">
            <span class="rv-dot"></span>
            <span class="rv-title">${esc(r.task_title || '（无标题任务）')}</span>
            ${r.module ? `<span class="pill">${esc(r.module)}</span>` : ''}
            ${r.minutes ? `<span class="pill">${r.minutes} 分钟</span>` : ''}
            <button class="btn sm ghost" data-act="review-del" data-id="${r.id}" style="margin-left:auto">删除</button>
          </div>
          <div class="rv-body">
            <div class="rv-line"><span class="rv-k">做到哪一步</span><span>${esc(r.content)}</span></div>
            <div class="rv-line"><span class="rv-k">学到了什么</span><span>${esc(r.learned)}</span></div>
          </div>
        </div>`).join('')}
    </div>`).join('')
    : '<div class="card"><div class="empty">还没有复盘。去勾一个任务，写下你实际做到什么、学到了什么，就会记在这里。</div></div>'}`;
}

/* ================= 视图：面试记录 ================= */
function viewInterviews() {
  const ivs = S.data.interviews;
  const st = S.data.stats;
  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">面试记录</h1>
      <div class="view-sub">共 ${st.interviewsTotal} 场 · 待结果 ${st.interviewsPending} · 已通过 ${st.interviewsPass}。记下每道被问到的问题，它们会反复出现。</div>
    </div>
    <div class="head-actions"><button class="btn primary" data-act="new-interview">记录一场面试</button></div>
  </div>

  ${ivs.length ? ivs.map((iv) => `
    <div class="row" style="align-items:flex-start;flex-direction:column;gap:0">
      <div style="display:flex;align-items:center;gap:10px;width:100%">
        <div style="font-size:14.5px;font-weight:600">${esc(iv.company)}</div>
        <span class="pill">${esc(iv.position || '未填岗位')}</span>
        <span class="pill">${esc(iv.stage)}</span>
        <span class="pill ${iv.result === 'pass' ? 'p0' : ''}">${resultText(iv.result)}</span>
        <div style="flex:1"></div>
        <div style="font-size:11.5px;color:var(--faint)">${esc(iv.date || '')}</div>
        <button class="btn sm ghost" data-act="open-interview" data-id="${iv.id}">编辑</button>
        <button class="btn sm ghost" data-act="del-interview" data-id="${iv.id}">删除</button>
      </div>
      ${iv.questions ? '<div class="row-sub" style="margin-top:9px;padding-left:2px">' + esc(iv.questions) + '</div>' : ''}
      ${iv.reflection ? '<div class="row-sub" style="margin-top:7px;padding-left:12px;border-left:2px solid var(--line)">复盘：' + esc(iv.reflection) + '</div>' : ''}
    </div>`).join('') : '<div class="empty">还没有面试记录。面完当天就记，细节最全。</div>'}`;
}

/* ================= 视图：学习打卡 ================= */
function viewLogs() {
  const logs = S.data.logs;
  const st = S.data.stats;
  const cats = ['听力', '阅读', '写作', '口语', '词汇', 'RAG', 'Agent 框架', 'Python', '论文', '其他'];
  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">学习打卡</h1>
      <div class="view-sub">本周 ${st.minutesWeek} 分钟 / ${st.logsWeekCount} 次。雅思和 Agent 学习共用这一张表。</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px">
    <div class="grid cols-4">
      <label class="f"><span>模块</span>
        <select id="log-module"><option>雅思</option><option>知识学习</option><option>实习准备</option><option>其他</option></select>
      </label>
      <label class="f"><span>分类</span>
        <select id="log-category">${cats.map((c) => `<option>${c}</option>`).join('')}</select>
      </label>
      <label class="f"><span>内容</span>
        <input id="log-title" placeholder="做了/学了什么" />
      </label>
      <label class="f"><span>日期</span>
        <input id="log-date" type="date" value="${todayStr()}" />
      </label>
    </div>
    <div class="grid cols-4" style="margin-top:12px;align-items:end">
      <label class="f"><span>分数 / 正确率（可选）</span>
        <input id="log-score" type="number" step="0.5" placeholder="如 6.5" />
      </label>
      <label class="f"><span>时长（分钟）</span>
        <input id="log-duration" type="number" placeholder="如 60" />
      </label>
      <div></div>
      <div style="display:flex;justify-content:flex-end;align-items:end;height:100%">
        <button class="btn primary" data-act="add-log" style="width:100%">打卡</button>
      </div>
    </div>
  </div>

  ${logs.length ? logs.map((l) => `
    <div class="row">
      <div class="row-main">
        <div class="row-title">${esc(l.title || '(未填写)')}</div>
        <div class="row-sub">${esc(l.date || '')} · ${esc(l.module)}${l.category ? ' / ' + esc(l.category) : ''}${l.duration ? ' · ' + l.duration + ' 分钟' : ''}${l.score != null ? ' · 得分 ' + l.score : ''}</div>
      </div>
      <div class="row-side"><button class="btn sm ghost" data-act="del-log" data-id="${l.id}">删除</button></div>
    </div>`).join('') : '<div class="empty">还没有打卡记录。</div>'}`;
}

/* ================= 视图：文件预览 ================= */
function viewFiles() {
  const folders = S.data.folders;
  const f = folders.find((x) => x.id === S.files.folderId);
  if (!folders.length) {
    return `<div class="view-head"><div><h1 class="view-title">文件预览</h1>
      <div class="view-sub">把简历、项目文档、笔记所在的文件夹挂进来，就能直接在网页里看。</div></div></div>
      <div class="empty">还没有挂载文件夹。<br/>去「设置 → 本地文件夹」添加一个，比如你的简历目录。</div>`;
  }
  const cur = f || folders[0];
  if (!S.files.folderId) { S.files.folderId = cur.id; }

  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">文件预览</h1>
      <div class="view-sub">${esc(cur.path)}</div>
    </div>
  </div>
  <div class="chips">
    ${folders.map((x) => `<button class="chip${x.id === S.files.folderId ? ' active' : ''}" data-act="file-folder" data-id="${x.id}">${esc(x.label)}</button>`).join('')}
  </div>
  <div class="files-wrap">
    <div class="file-list">
      ${renderCrumb(cur)}
      ${S.files.entries === null ? '<div style="padding:20px;color:var(--faint);font-size:12px">读取中…</div>'
        : (S.files.entries.length ? S.files.entries.map(fileItem).join('') : '<div style="padding:20px;color:var(--faint);font-size:12px">这个文件夹是空的</div>')}
    </div>
    <div class="preview" id="preview-pane">${renderPreview(cur)}</div>
  </div>`;
}

function renderCrumb(f) {
  if (!f) return '';
  const sub = S.files.sub;
  const segs = sub ? sub.split('/').filter(Boolean) : [];
  return `<div class="crumb"><a data-act="file-nav" data-sub="">${esc(f.label)}</a>
    ${segs.map((s, i) => '<span>/</span><a data-act="file-nav" data-sub="' + esc(segs.slice(0, i + 1).join('/')) + '">' + esc(s) + '</a>').join('')}
  </div>`;
}

function fileIcon(e) {
  if (e.dir) return 'DIR';
  const map = { '.pdf': 'PDF', '.md': 'MD ', '.docx': 'DOC', '.doc': 'DOC', '.xlsx': 'XLS', '.xls': 'XLS', '.pptx': 'PPT', '.png': 'IMG', '.jpg': 'IMG', '.jpeg': 'IMG', '.gif': 'IMG', '.webp': 'IMG', '.mp4': 'VID', '.py': 'PY ', '.json': 'JSN', '.txt': 'TXT', '.csv': 'CSV', '.zip': 'ZIP' };
  return map[e.ext] || 'FILE';
}

function fileItem(e) {
  const active = S.files.entry && S.files.entry.sub === joinSub(e.name);
  const sub = joinSub(e.name);
  if (e.dir) {
    return `<div class="f-item" data-act="file-open" data-sub="${esc(sub)}" data-dir="1">
      <span class="ic">${fileIcon(e)}</span><span class="f-name">${esc(e.name)}</span>
    </div>`;
  }
  return `<div class="f-item${active ? ' active' : ''}" data-act="file-open" data-sub="${esc(sub)}" data-dir="0">
    <span class="ic">${fileIcon(e)}</span><span class="f-name">${esc(e.name)}</span><span class="f-size">${fmtSize(e.size)}</span>
  </div>`;
}

function joinSub(name) {
  return S.files.sub ? S.files.sub + '/' + name : name;
}

function renderPreview(f) {
  const e = S.files.entry;
  if (!e) {
    return `<div class="preview-head"><span>预览</span></div><div class="preview-body" style="display:grid;place-items:center;color:var(--faint);font-size:12.5px">左边选一个文件</div>`;
  }
  return `<div class="preview-head">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.name)} <span style="color:var(--faint);font-size:11px">${fmtSize(e.size)}</span></span>
      <span style="display:flex;gap:6px">
        <button class="btn sm ghost" data-act="file-open-system">用本机程序打开</button>
        <button class="btn sm ghost" data-act="file-close">关闭</button>
      </span>
    </div>
    <div class="preview-body" id="preview-body">${previewPlaceholder(e)}</div>`;
}

function previewPlaceholder(e) {
  const q = 'folder=' + encodeURIComponent(S.files.folderId) + '&sub=' + encodeURIComponent(e.sub);
  const ext = e.ext;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'].includes(ext)) {
    return `<img src="/api/raw?${q}" alt="" />`;
  }
  if (ext === '.pdf') return `<iframe src="/api/raw?${q}" title="pdf"></iframe>`;
  if (['.mp4', '.webm', '.mov'].includes(ext)) return `<video src="/api/raw?${q}" controls style="width:100%;display:block"></video>`;
  if (['.mp3', '.wav', '.m4a', '.ogg'].includes(ext)) return `<div style="padding:26px"><audio src="/api/raw?${q}" controls style="width:100%"></audio></div>`;
  if (['.md', '.markdown', '.txt', '.json', '.js', '.ts', '.py', '.tsx', '.jsx', '.css', '.html', '.csv', '.yml', '.yaml', '.sql', '.ipynb', '.log', '.java', '.c', '.cpp', '.go', '.rs', '.sh', '.bat', '.ps1', '.xml', '.toml', '.ini'].includes(ext)) {
    return `<div style="padding:16px;color:var(--faint);font-size:12px">读取文本…</div>`;
  }
  if (['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'].includes(ext)) {
    return `<div style="padding:40px;text-align:center;color:var(--muted);font-size:12.5px;line-height:1.9">Office 文档无法在网页内直接渲染<br/>点右上角「用本机程序打开」，或从这里下载：<br/><a href="/api/raw?${q}" style="color:var(--ink)">下载 ${esc(e.name)}</a></div>`;
  }
  if (['.zip', '.rar', '.7z', '.exe', '.apk'].includes(ext)) {
    return `<div style="padding:40px;text-align:center;color:var(--muted);font-size:12.5px">该类型不支持预览。<br/><a href="/api/raw?${q}" style="color:var(--ink)">下载文件</a></div>`;
  }
  return `<div style="padding:40px;text-align:center;color:var(--muted);font-size:12.5px">暂不支持该格式预览。<br/><a href="/api/raw?${q}" style="color:var(--ink)">下载</a> · 或用本机程序打开</div>`;
}

async function loadTextPreview(e) {
  const q = 'folder=' + encodeURIComponent(S.files.folderId) + '&sub=' + encodeURIComponent(e.sub);
  const body = document.getElementById('preview-body');
  if (!body) return;
  try {
    const r = await api('/api/text?' + q);
    if (r.tooLarge) {
      body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:12.5px">文件太大（${fmtSize(r.size)}），不做内联渲染。<br/><a href="/api/raw?${q}" style="color:var(--ink)">下载</a></div>`;
      return;
    }
    const isMd = /\.(md|markdown)$/i.test(e.name);
    const html = isMd ? `<div class="md-body">${mdToHtml(r.text)}</div>` : `<pre>${esc(r.text)}</pre>`;
    const pane = document.getElementById('preview-pane');
    if (!pane) return;
    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div style="padding:20px;color:var(--muted);font-size:12.5px">${esc(err.message)}</div>`;
  }
}

function ensureFiles() {
  if (!S.files.folderId) {
    const f = S.data.folders[0];
    if (f) S.files.folderId = f.id;
  }
  if (!S.files.folderId || S.files.entries !== null) return;
  refreshFiles();
}

async function refreshFiles() {
  S.files.entries = null;
  const box = document.querySelector('.file-list');
  if (box) box.innerHTML = '<div style="padding:20px;color:var(--faint);font-size:12px">读取中…</div>';
  try {
    const r = await api('/api/files?folder=' + encodeURIComponent(S.files.folderId) + '&sub=' + encodeURIComponent(S.files.sub));
    S.files.entries = r.entries;
    S.files.sub = r.sub || '';
  } catch (e) {
    toast(e.message);
    S.files.entries = [];
  }
  if (S.tab === 'files') {
    const main = document.getElementById('main');
    const scroll = main.scrollTop;
    main.innerHTML = viewFiles();
    main.scrollTop = scroll;
  }
}

/* ================= 视图：设置 ================= */
function viewSettings() {
  const cfg = S.data.settings.llm;
  const folders = S.data.folders;
  return `
  <div class="view-head">
    <div>
      <h1 class="view-title">设置</h1>
      <div class="view-sub">所有数据只存在这台电脑：data/workbench.db + config.json，不上传任何云端。</div>
    </div>
  </div>

  <div class="card set-block">
    <div class="card-title">模型接口（OpenAI 兼容）</div>
    <div class="chips" style="margin-bottom:14px">
      <button class="chip" data-act="preset" data-provider="deepseek">DeepSeek</button>
      <button class="chip" data-act="preset" data-provider="ark">豆包 / 火山方舟</button>
      <button class="chip" data-act="preset" data-provider="openai">OpenAI</button>
      <button class="chip" data-act="preset" data-provider="qwen">通义千问</button>
    </div>
    <label class="f"><span>Base URL</span><input id="set-base" value="${esc(cfg.baseUrl)}" placeholder="https://api.deepseek.com/v1" /></label>
    <div class="grid cols-2" style="margin-top:13px">
      <label class="f"><span>模型名</span><input id="set-model" value="${esc(cfg.model)}" placeholder="deepseek-chat" /></label>
      <label class="f"><span>API Key ${cfg.hasKey ? '（已保存，尾部 ' + esc(cfg.keyTail) + '）' : '（未配置）'}</span>
        <input id="set-key" type="password" placeholder="${cfg.hasKey ? '留空则保持不变' : 'sk-...'}" /></label>
    </div>
    <div class="hint-line">Key 以明文保存在本地 config.json，只在本机的服务进程里使用。如果这台电脑会借给别人用，建议用完清空。</div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <button class="btn primary" data-act="save-settings">保存</button>
    </div>
  </div>

  <div class="card set-block">
    <div class="card-title">本地文件夹（用于文件预览）</div>
    ${folders.length ? folders.map((f) => `
      <div class="row">
        <div class="row-main">
          <div class="row-title">${esc(f.label)}</div>
          <div class="row-sub">${esc(f.path)}</div>
        </div>
        <div class="row-side"><button class="btn sm ghost" data-act="del-folder" data-id="${f.id}">移除</button></div>
      </div>`).join('') : '<div class="empty" style="margin-bottom:12px">还没挂载文件夹。建议先加：简历目录、项目文档目录。</div>'}
    <div class="quick-capture" style="margin-top:13px">
      <input id="folder-path" placeholder="绝对路径，例如 D:\\我的简历" />
      <input id="folder-label" style="max-width:150px" placeholder="显示名（可选）" />
      <button class="btn primary" data-act="add-folder">添加</button>
    </div>
    <div class="hint-line">只读访问，工作台不会修改或删除你的文件。目录里的子文件夹可以逐层浏览。</div>
  </div>

  <div class="card set-block">
    <div class="card-title">数据</div>
    <div class="row-sub" style="margin-bottom:12px">数据库：<code style="font-family:var(--mono);font-size:11.5px">data\\workbench.db</code>；备份时把整个文件夹复制走即可。</div>
    <div style="display:flex;gap:8px">
      <button class="btn sm ghost" data-act="export-json">导出全部数据为 JSON</button>
    </div>
  </div>`;
}

/* ================= 弹窗 ================= */
function modal(title, bodyHtml, footHtml) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="mask" data-act="modal-mask">
    <div class="modal">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="x" data-act="modal-close">×</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot">${footHtml || ''}</div>
    </div>
  </div>`;
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

function taskEditor(t) {
  const isNew = !t;
  const v = t || { title: '', notes: '', module: '实习准备', priority: 'P1', status: 'todo', due_date: '' };
  modal(isNew ? '新建任务' : '编辑任务', `
    <label class="f"><span>任务标题</span><input id="m-title" value="${esc(v.title)}" placeholder="做什么 + 交付物" /></label>
    <div class="grid cols-2" style="margin-top:13px">
      <label class="f"><span>模块</span><select id="m-module">${MODULES.map((m) => `<option${m === v.module ? ' selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f"><span>优先级</span><select id="m-priority">${['P0', 'P1', 'P2'].map((p) => `<option${p === v.priority ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    <div class="grid cols-2" style="margin-top:13px">
      <label class="f"><span>状态</span><select id="m-status">
        <option value="todo"${v.status === 'todo' ? ' selected' : ''}>待办</option>
        <option value="doing"${v.status === 'doing' ? ' selected' : ''}>进行中</option>
        <option value="done"${v.status === 'done' ? ' selected' : ''}>已完成</option>
      </select></label>
      <label class="f"><span>截止日期</span><input id="m-due" type="date" value="${esc(v.due_date || '')}" /></label>
    </div>
    <label class="f" style="margin-top:13px"><span>备注 / 拆解要点</span><textarea id="m-notes">${esc(v.notes)}</textarea></label>
  `, `
    ${isNew ? '' : '<button class="btn ghost danger" data-act="del-task" data-id="' + t.id + '">删除</button>'}
    <div style="flex:1"></div>
    <button class="btn" data-act="modal-close">取消</button>
    <button class="btn primary" data-act="save-task" data-id="${isNew ? '' : t.id}">保存</button>
  `);
  const el = document.getElementById('m-title');
  if (el) el.focus();
}

function interviewEditor(iv) {
  const isNew = !iv;
  const v = iv || { company: '', position: '', stage: '一面', date: todayStr(), result: 'pending', questions: '', reflection: '' };
  modal(isNew ? '记录一场面试' : '编辑面试记录', `
    <div class="grid cols-2">
      <label class="f"><span>公司</span><input id="i-company" value="${esc(v.company)}" placeholder="如 字节跳动" /></label>
      <label class="f"><span>岗位</span><input id="i-position" value="${esc(v.position)}" placeholder="如 AI 产品经理实习生" /></label>
    </div>
    <div class="grid cols-3" style="margin-top:13px">
      <label class="f"><span>轮次</span><select id="i-stage">${['一面', '二面', '三面', 'HR 面', '笔试', '群面'].map((s) => `<option${s === v.stage ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f"><span>日期</span><input id="i-date" type="date" value="${esc(v.date || '')}" /></label>
      <label class="f"><span>结果</span><select id="i-result">
        <option value="pending"${v.result === 'pending' ? ' selected' : ''}>待结果</option>
        <option value="pass"${v.result === 'pass' ? ' selected' : ''}>通过</option>
        <option value="fail"${v.result === 'fail' ? ' selected' : ''}>未通过</option>
      </select></label>
    </div>
    <label class="f" style="margin-top:13px"><span>被问到的问题（一行一条）</span><textarea id="i-questions" placeholder="自我介绍&#10;讲讲你做的 Agent 项目&#10;竞品分析怎么做的">${esc(v.questions)}</textarea></label>
    <label class="f" style="margin-top:13px"><span>复盘：答得好/不好的地方</span><textarea id="i-reflection">${esc(v.reflection)}</textarea></label>
  `, `
    <button class="btn" data-act="modal-close">取消</button>
    <button class="btn primary" data-act="save-interview" data-id="${isNew ? '' : iv.id}">保存</button>
  `);
}

/* ================= 动作 ================= */
const ACTIONS = {
  tab(el) {
    S.tab = el.dataset.tab;
    if (S.tab === 'files') { S.files.entries = null; }
    render();
    document.getElementById('main').scrollTop = 0;
  },

  'new-task': () => taskEditor(null),

  'open-task'(el) {
    const t = S.data.tasks.find((x) => x.id === Number(el.dataset.id));
    if (t) taskEditor(t);
  },

  async 'toggle-task'(el, e) {
    e.stopPropagation();
    const id = Number(el.dataset.id);
    const status = el.dataset.status;
    if (status !== 'done') {
      const t = S.data.tasks.find((x) => x.id === id) || { id, title: '', module: '' };
      return reviewEditor(t);
    }
    el.classList.add('pop');
    try {
      await api('/api/tasks/' + id, 'PATCH', { status: 'todo' });
      await load();
      toast('已改回待办，那天的复盘还留着');
    } catch (err) { toast(err.message); }
  },

  async 'save-review'(el) {
    const content = document.getElementById('rv-content').value.trim();
    const learned = document.getElementById('rv-learned').value.trim();
    const minutes = Number(document.getElementById('rv-min').value) || 0;
    if (!content) return toast('先写下「实际做到哪一步」');
    if (!learned) return toast('再写下「学到了什么」');
    try {
      await api('/api/tasks/' + el.dataset.id + '/complete', 'POST', { content, learned, minutes });
      closeModal();
      await load();
      toast('完成，已记进复盘日记');
    } catch (err) { toast(err.message); }
  },

  async 'review-del'(el) {
    if (!confirm('删除这条复盘？任务本身仍保持已完成。')) return;
    await api('/api/reviews/' + el.dataset.id, 'DELETE');
    await load();
    toast('已删除这条复盘');
  },

  async 'save-task'(el) {
    const id = el.dataset.id;
    const body = {
      title: document.getElementById('m-title').value.trim(),
      notes: document.getElementById('m-notes').value,
      module: document.getElementById('m-module').value,
      priority: document.getElementById('m-priority').value,
      status: document.getElementById('m-status').value,
      due_date: document.getElementById('m-due').value || null
    };
    if (!body.title) return toast('标题不能为空');
    try {
      if (id) await api('/api/tasks/' + id, 'PATCH', body);
      else await api('/api/tasks', 'POST', body);
      closeModal();
      await load();
      toast('已保存');
    } catch (err) { toast(err.message); }
  },

  async 'del-task'(el) {
    if (!confirm('删除这个任务？')) return;
    await api('/api/tasks/' + el.dataset.id, 'DELETE');
    closeModal();
    await load();
    toast('已删除');
  },

  'filter'(el) {
    S.filter = el.dataset.module;
    render();
  },

  async 'quick-idea'(el) {
    const inp = document.getElementById('quick-idea');
    const v = inp.value.trim();
    if (!v) return;
    const target = document.querySelector('.deck-stage') || document.querySelector('[data-idea-target]');
    inp.value = '';
    const flying = flyPlane(el, target);
    let created = null;
    try {
      created = await api('/api/ideas', 'POST', { content: v });
    } catch (e) {
      toast(e.message);
      return;
    }
    await flying;
    S.newIdeaId = created.id;
    await load();
    setTimeout(() => { S.newIdeaId = null; }, 1200);
    toast('已飞进灵感库');
  },

  async 'add-idea'(el) {
    const c = document.getElementById('idea-input').value.trim();
    const tag = document.getElementById('idea-tag').value.trim();
    if (!c) return toast('内容不能为空');
    const target = document.querySelector('[data-idea-target]');
    const flying = flyPlane(el, target);
    let created = null;
    try {
      created = await api('/api/ideas', 'POST', { content: c, tag });
    } catch (e) {
      toast(e.message);
      return;
    }
    const t = document.getElementById('idea-input');
    if (t) t.value = '';
    await flying;
    S.newIdeaId = created.id;
    await load();
    setTimeout(() => { S.newIdeaId = null; }, 1200);
    toast('已飞进灵感库');
  },

  /* 点卡片 → 详情 */
  'open-idea'(el) {
    const it = S.data.ideas.find((x) => x.id === Number(el.dataset.id));
    if (it) ideaEditor(it);
  },

  async 'save-idea'(el) {
    const body = {
      content: document.getElementById('i2-content').value,
      tag: document.getElementById('i2-tag').value.trim(),
      pinned: document.getElementById('i2-pinned').value === '1'
    };
    if (!body.content.trim()) return toast('内容不能为空');
    try {
      await api('/api/ideas/' + el.dataset.id, 'PATCH', body);
      closeModal();
      await load();
      toast(body.pinned ? '已置顶' : '已保存');
    } catch (err) { toast(err.message); }
  },

  async 'idea-pin'(el) {
    const next = el.dataset.pinned === '1' ? 0 : 1;
    await api('/api/ideas/' + el.dataset.id, 'PATCH', { pinned: next });
    await load();
    toast(next ? '已置顶，会排在牌堆最上面' : '已取消置顶');
  },

  /* 洗牌抽一张：整叠晃一下，抽到的牌单独抽出来 */
  async 'deck-shuffle'(el) {
    const ideas = S.data.ideas;
    if (!ideas.length) return toast('还没有灵感可抽');
    const stage = document.querySelector('.deck-stage');
    if (stage) stage.classList.add('shuffling');
    let pick = ideas[0];
    let guard = 0;
    do {
      pick = ideas[Math.floor(Math.random() * ideas.length)];
      guard++;
    } while (ideas.length > 1 && pick.id === S.deck.drawnId && guard < 30);
    await new Promise((r) => setTimeout(r, 540));
    S.deck.drawnId = pick.id;
    await load();
    const tip = pick.content.replace(/\s+/g, ' ');
    toast('抽到：' + tip.slice(0, 14) + (tip.length > 14 ? '…' : ''));
  },

  async 'deck-return'(el) {
    S.deck.drawnId = null;
    await load();
  },

  async 'idea-to-task'(el) {
    await api('/api/ideas/' + el.dataset.id + '/to-task', 'POST', {});
    closeModal();
    S.tab = 'tasks';
    await load();
    document.getElementById('main').scrollTop = 0;
    toast('已变成任务，去看板里排时间');
  },

  async 'idea-del'(el) {
    if (!confirm('删除这条灵感？')) return;
    const id = Number(el.dataset.id);
    await api('/api/ideas/' + id, 'DELETE');
    if (S.deck.drawnId === id) S.deck.drawnId = null;
    await load();
  },

  'new-interview': () => interviewEditor(null),

  'open-interview'(el) {
    const iv = S.data.interviews.find((x) => x.id === Number(el.dataset.id));
    if (iv) interviewEditor(iv);
  },

  async 'save-interview'(el) {
    const body = {
      company: document.getElementById('i-company').value.trim(),
      position: document.getElementById('i-position').value.trim(),
      stage: document.getElementById('i-stage').value,
      date: document.getElementById('i-date').value,
      result: document.getElementById('i-result').value,
      questions: document.getElementById('i-questions').value,
      reflection: document.getElementById('i-reflection').value
    };
    if (!body.company) return toast('公司名不能为空');
    try {
      if (el.dataset.id) await api('/api/interviews/' + el.dataset.id, 'PATCH', body);
      else await api('/api/interviews', 'POST', body);
      closeModal();
      await load();
      toast('已保存');
    } catch (err) { toast(err.message); }
  },

  async 'del-interview'(el) {
    if (!confirm('删除这条面试记录？')) return;
    await api('/api/interviews/' + el.dataset.id, 'DELETE');
    await load();
  },

  async 'add-log'() {
    const body = {
      module: document.getElementById('log-module').value,
      category: document.getElementById('log-category').value,
      title: document.getElementById('log-title').value.trim(),
      date: document.getElementById('log-date').value,
      score: document.getElementById('log-score').value,
      duration: document.getElementById('log-duration').value
    };
    if (!body.title) return toast('写一句做了什么');
    await api('/api/logs', 'POST', body);
    await load();
    toast('已打卡');
  },

  async 'del-log'(el) {
    await api('/api/logs/' + el.dataset.id, 'DELETE');
    await load();
  },

  'file-folder'(el) {
    S.files.folderId = el.dataset.id;
    S.files.sub = '';
    S.files.entry = null;
    S.files.entries = null;
    render();
  },

  'file-nav'(el) {
    S.files.sub = el.dataset.sub || '';
    S.files.entry = null;
    S.files.entries = null;
    render();
  },

  async 'file-open'(el) {
    if (el.dataset.dir === '1') {
      S.files.sub = el.dataset.sub;
      S.files.entry = null;
      S.files.entries = null;
      render();
      return;
    }
    const sub = el.dataset.sub;
    const entry = S.files.entries.find((x) => joinSub(x.name) === sub);
    S.files.entry = Object.assign({}, entry, { sub });
    // 局部刷新，避免整页重绘
    const pane = document.getElementById('preview-pane');
    const cur = S.data.folders.find((x) => x.id === S.files.folderId);
    pane.innerHTML = renderPreview(cur);
    document.querySelectorAll('.f-item').forEach((n) => n.classList.toggle('active', n.dataset.sub === sub));
    const e = S.files.entry;
    if (['.md', '.markdown', '.txt', '.json', '.js', '.ts', '.py', '.tsx', '.jsx', '.css', '.html', '.csv', '.yml', '.yaml', '.sql', '.ipynb', '.log', '.java', '.c', '.cpp', '.go', '.rs', '.sh', '.bat', '.ps1', '.xml', '.toml', '.ini'].includes(e.ext)) {
      loadTextPreview(e);
    }
  },

  'file-close'() {
    S.files.entry = null;
    const pane = document.getElementById('preview-pane');
    const cur = S.data.folders.find((x) => x.id === S.files.folderId);
    pane.innerHTML = renderPreview(cur);
    document.querySelectorAll('.f-item').forEach((n) => n.classList.remove('active'));
  },

  async 'file-open-system'() {
    try {
      await api('/api/open', 'POST', { folder: S.files.folderId, sub: S.files.entry.sub });
    } catch (e) { toast(e.message); }
  },

  'preset'(el) {
    const map = {
      deepseek: ['https://api.deepseek.com/v1', 'deepseek-chat'],
      ark: ['https://ark.cn-beijing.volces.com/api/v3', 'ep-你的接入点ID'],
      openai: ['https://api.openai.com/v1', 'gpt-4o-mini'],
      qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-plus']
    };
    const cfg = map[el.dataset.provider];
    if (!cfg) return;
    document.getElementById('set-base').value = cfg[0];
    document.getElementById('set-model').value = cfg[1];
    toast('已填入，别忘了补 API Key');
  },

  async 'save-settings'() {
    const llm = {
      baseUrl: document.getElementById('set-base').value.trim(),
      model: document.getElementById('set-model').value.trim()
    };
    const key = document.getElementById('set-key').value.trim();
    if (key) llm.apiKey = key;
    try {
      await api('/api/settings', 'POST', { llm });
      await load();
      toast('已保存');
    } catch (e) { toast(e.message); }
  },

  async 'add-folder'() {
    const path = document.getElementById('folder-path').value.trim();
    const label = document.getElementById('folder-label').value.trim();
    if (!path) return toast('请填绝对路径');
    try {
      await api('/api/folders', 'POST', { path, label });
      await load();
      const inp = document.getElementById('folder-path');
      if (inp) inp.value = '';
      toast('已添加');
    } catch (e) { toast(e.message); }
  },

  async 'del-folder'(el) {
    if (!confirm('移除这个文件夹？（不会删除磁盘上的文件）')) return;
    await api('/api/folders/' + el.dataset.id, 'DELETE');
    await load();
  },

  async 'export-json'() {
    const d = S.data;
    const blob = new Blob([JSON.stringify({ tasks: d.tasks, ideas: d.ideas, interviews: d.interviews, logs: d.logs }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '工作台数据-' + todayStr() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出');
  },

  async 'run-plan'() {
    if (S.planning) return;
    const goal = document.getElementById('plan-goal').value.trim();
    if (!goal) return toast('先写下目标');
    S.planning = true;
    renderMain();
    try {
      const out = await api('/api/llm/plan', 'POST', {
        goal,
        module: document.getElementById('plan-module').value,
        days: document.getElementById('plan-days').value,
        hours: document.getElementById('plan-hours').value,
        context: document.getElementById('plan-context').value
      });
      S.plan = { summary: out.summary, tasks: out.tasks, skip: out.tasks.map(() => false) };
      toast('拆解完成，挑掉不想做的再入库');
    } catch (e) {
      toast(e.message);
    } finally {
      S.planning = false;
      renderMain();
    }
  },

  'plan-toggle'(el) {
    const i = Number(el.dataset.i);
    S.plan.skip[i] = !S.plan.skip[i];
    renderMain();
  },

  'plan-clear'() {
    S.plan = null;
    renderMain();
  },

  async 'plan-apply'() {
    const tasks = S.plan.tasks.filter((_, i) => !S.plan.skip[i]);
    if (!tasks.length) return toast('至少保留一个任务');
    await api('/api/tasks/bulk', 'POST', { tasks });
    S.plan = null;
    await load();
    S.tab = 'tasks';
    render();
    toast('已加入任务板');
  },

  'modal-close': () => closeModal(),
  'modal-mask'(el, e) {
    if (e.target.classList.contains('mask')) closeModal();
  }
};

/* ================= 事件绑定 ================= */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && !e.shiftKey) {
    if (e.target.id === 'quick-idea') { e.preventDefault(); ACTIONS['quick-idea'](); }
    if (e.target.id === 'idea-input') { e.preventDefault(); ACTIONS['add-idea'](); }
    if (e.target.id === 'folder-path') { e.preventDefault(); ACTIONS['add-folder'](); }
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    if (e.target.id === 'm-notes' || e.target.id === 'm-title') {
      const btn = document.querySelector('[data-act="save-task"]');
      if (btn) btn.click();
    }
  }
});

/* ================= 启动 ================= */
load().catch((e) => {
  document.getElementById('main').innerHTML = '<div class="empty">服务未启动或已断开：' + esc(e.message) + '</div>';
});
