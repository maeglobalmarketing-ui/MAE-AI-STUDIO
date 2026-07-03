const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const NOTION_KEY = process.env.MAE_NOTION_TOKEN || process.env.NOTION_KEY || '';
const CLAUDE_KEY = process.env.MAE_CLAUDE_KEY || process.env.CLAUDE_KEY || '';
const INSP_DB  = '3f2b821c14444d079502177652141530';
const HOOK_DB  = 'f9f9b501cb1342e5a079b0a0c43ae46d';
const BENCH_DB = '2fae21035ba34b82ba7bc274087738ee';

// --- Notion query with real logging (no silent swallow) ---
async function notionQuery(label, dbId) {
  if (!NOTION_KEY) { console.log('[' + label + '] NO NOTION_KEY'); return []; }
  try {
    const r = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + NOTION_KEY,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ page_size: 100 })
    });
    const data = await r.json();
    if (!r.ok) {
      console.log('[' + label + '] Notion ERROR ' + r.status + ': ' + (data.code || '') + ' - ' + (data.message || JSON.stringify(data)));
      return [];
    }
    console.log('[' + label + '] OK - ' + (data.results ? data.results.length : 0) + ' rows');
    return data.results || [];
  } catch (e) {
    console.log('[' + label + '] FETCH FAILED: ' + e.message);
    return [];
  }
}

// --- read any Notion property type into a plain value ---
function getProp(page, name) {
  var p = page.properties ? page.properties[name] : null;
  if (!p) return '';
  if (p.type === 'title') return p.title && p.title[0] ? p.title[0].plain_text : '';
  if (p.type === 'rich_text') return p.rich_text && p.rich_text[0] ? p.rich_text[0].plain_text : '';
  if (p.type === 'select') return p.select ? p.select.name : '';
  if (p.type === 'multi_select') return (p.multi_select || []).map(function(s){return s.name;}).join(', ');
  if (p.type === 'url') return p.url || '';
  if (p.type === 'number') return p.number;
  if (p.type === 'status') return p.status ? p.status.name : '';
  if (p.type === 'unique_id') return p.unique_id ? (p.unique_id.prefix || '') + '-' + p.unique_id.number : '';
  return '';
}

// grab the title regardless of what the title column is named
function getTitle(page) {
  var props = page.properties || {};
  for (var k in props) {
    if (props[k] && props[k].type === 'title') {
      var t = props[k].title;
      return t && t[0] ? t[0].plain_text : '';
    }
  }
  return '';
}

// --- routes: field names match the frontend (title/desc/type/account/url etc.) ---
app.get('/api/inspirations', async function(req, res) {
  var rows = await notionQuery('INSP', INSP_DB);
  res.json(rows.map(function(p) {
    return {
      title:   getTitle(p) || getProp(p,'内容亮点'),
      desc:    getProp(p,'AI拆解摘要') || getProp(p,'MAE版本概念'),
      type:    getProp(p,'内容格式') || getProp(p,'事件类型'),
      account: getProp(p,'账号方向'),
      url:     getProp(p,'链接')
    };
  }));
});

app.get('/api/hooks', async function(req, res) {
  var rows = await notionQuery('HOOK', HOOK_DB);
  res.json(rows.map(function(p) {
    return {
      hook: getTitle(p) || getProp(p,'钩子内容'),
      type: getProp(p,'钩子类型'),
      account: getProp(p,'适用账号'),
      identity: getProp(p,'适用身份'),
      note: getProp(p,'例句') || getProp(p,'适用身份')
    };
  }));
});

app.get('/api/benchmarks', async function(req, res) {
  var rows = await notionQuery('BENCH', BENCH_DB);
  res.json(rows.map(function(p) {
    return {
      name: getTitle(p) || getProp(p,'账号名'),
      lang: getProp(p,'语言'),
      note: getProp(p,'对标原因') || getProp(p,'内容类型'),
      url: getProp(p,'链接')
    };
  }));
});

// --- AI tools ---
app.post('/api/ai', async function(req, res) {
  if (!CLAUDE_KEY) return res.json({ error: 'AI 未配置：请在 Railway 加 CLAUDE_KEY 变量。' });
  var tool = req.body.tool, input = req.body.input || '';
  var sys = 'You are MAE Global\'s AI content assistant. MAE empowers women aged 25-45 across all identities (boss, employee, mother, daughter, wife, homemaker). Brand mission (NEVER quote directly, always embody): help women find inner strength, see their value, live with confidence and beauty. CEO Kate @kateysy tells real stories, never reads ad copy. Brand @maeglobalofficial must have a Key Message. Principle: Event First (Event > Emotion > Copy). 5 event types: Contrast, Result, Process, Conflict, Identity. The test: would a specific woman feel 被看见了 or 被启发了 after watching? Reply in Chinese.';
  var prompt;
  if (tool === 'hook') prompt = '为以下主题生成 5 个高共鸣的开场钩子（前3秒抓住观众）。每个钩子一行，标注钩子类型。主题：' + input;
  else if (tool === 'script') prompt = '基于以下钩子或想法，写一条完整短视频脚本：包含钩子、3-4个场景节拍、以及落点。想法：' + input;
  else if (tool === 'series') prompt = '基于以下成功选题，扩展成一整季（8集）系列，每集给标题+一句话看点。选题：' + input;
  else prompt = input;

  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': CLAUDE_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: sys,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    var data = await r.json();
    if (!r.ok) { console.log('[AI] ERROR: ' + JSON.stringify(data)); return res.json({ error: 'AI 调用失败：' + (data.error ? data.error.message : r.status) }); }
    var text = (data.content || []).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('\n');
    res.json({ result: text || '没有返回内容。' });
  } catch (e) {
    res.json({ error: '生成失败：' + e.message });
  }
});

// health check
app.get('/api/health', function(req, res) {
  res.json({ ok: true, hasNotionKey: !!NOTION_KEY, hasClaudeKey: !!CLAUDE_KEY });
});

var PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log('MAE Dashboard on port ' + PORT); });
