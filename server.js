const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const NOTION_KEY = process.env.NOTION_KEY || '';
const CLAUDE_KEY = process.env.CLAUDE_KEY || '';
const INSP_DB = '3f2b821c14444d079502177652141530';
const HOOK_DB = 'f9f9b501cb1342e5a079b0a0c43ae46d';
const BENCH_DB = '2fae21035ba34b82ba7bc274087738ee';

async function notionQuery(dbId, filter, sorts) {
  if (!NOTION_KEY) return { results: [] };
  try {
    const body = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts) body.sorts = sorts;
    const r = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + NOTION_KEY, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!data.results) return { results: [] };
    return data;
  } catch (e) { return { results: [] }; }
}

function getProp(page, name) {
  var p = page.properties ? page.properties[name] : null;
  if (!p) return '';
  if (p.type === 'title') return p.title && p.title[0] ? p.title[0].text.content : '';
  if (p.type === 'rich_text') return p.rich_text && p.rich_text[0] ? p.rich_text[0].text.content : '';
  if (p.type === 'select') return p.select ? p.select.name : '';
  if (p.type === 'multi_select') return (p.multi_select || []).map(function(s) { return s.name; });
  if (p.type === 'url') return p.url || '';
  if (p.type === 'number') return p.number;
  if (p.type === 'status') return p.status ? p.status.name : '';
  if (p.type === 'unique_id') return p.unique_id ? (p.unique_id.prefix || '') + '-' + p.unique_id.number : '';
  return '';
}

app.get('/api/inspirations', async function(req, res) {
  try {
    var data = await notionQuery(INSP_DB, null, [{ property: '灵感ID', direction: 'descending' }]);
    var items = (data.results || []).map(function(p) {
      return {
        id: getProp(p, '灵感ID'), title: getProp(p, '内容亮点'), account: getProp(p, '账号方向'),
        identity: getProp(p, '目标身份'), event: getProp(p, '事件类型'), format: getProp(p, '内容格式'),
        elements: getProp(p, '爆款元素'), concept: getProp(p, 'MAE版本概念'), compliance: getProp(p, '合规检查'),
        judgment: getProp(p, '内容判断'), source: getProp(p, '来源'), platform: getProp(p, '平台'),
        link: getProp(p, '链接'), status: getProp(p, '状态'), summary: getProp(p, 'AI拆解摘要')
      };
    });
    res.json(items);
  } catch (e) { res.json([]); }
});

app.get('/api/hooks', async function(req, res) {
  try {
    var data = await notionQuery(HOOK_DB, null, [{ property: '钩子ID', direction: 'descending' }]);
    var items = (data.results || []).map(function(p) {
      return {
        id: getProp(p, '钩子ID'), content: getProp(p, '钩子内容'), type: getProp(p, '钩子类型'),
        account: getProp(p, '适用账号'), identity: getProp(p, '适用身份'), example: getProp(p, '例句'), source: getProp(p, '来源')
      };
    });
    res.json(items);
  } catch (e) { res.json([]); }
});

app.get('/api/benchmarks', async function(req, res) {
  try {
    var data = await notionQuery(BENCH_DB);
    var items = (data.results || []).map(function(p) {
      return {
        id: getProp(p, '账号ID'), name: getProp(p, '账号名'), platform: getProp(p, '平台'),
        language: getProp(p, '语言'), reason: getProp(p, '对标原因'), types: getProp(p, '内容类型'),
        link: getProp(p, '链接'), followers: getProp(p, '粉丝量级')
      };
    });
    res.json(items);
  } catch (e) { res.json([]); }
});

app.post('/api/ai', async function(req, res) {
  if (!CLAUDE_KEY) return res.json({ text: '{"error":"Claude API key not set. Add CLAUDE_KEY in Railway Variables."}' });
  var mode = req.body.mode, params = req.body.params;
  var sys = 'You are MAE Global AI content assistant. MAE empowers women 25-45 (boss,employee,mother,daughter,wife,homemaker). Mission: help women find inner strength, see their value, live with confidence. NEVER quote mission. CEO Kate @kateysy. Brand @maeglobalofficial. Event First: Event>Emotion>Copy.';
  var prompt = '';
  if (mode === 'hook') prompt = 'Generate 5 hooks for MAE ' + params.account + '. Identity: ' + params.identity + '. Topic: ' + params.topic + '. Return ONLY JSON array: [{"type":"悬念型/反差型/数字型/痛点型/金句型","hook":"Chinese text","visual":"what viewer sees","why":"why works"}]';
  else if (mode === 'script') prompt = 'Build ' + params.duration + 's script for MAE ' + params.account + '. Hook: ' + params.hook + '. KM: ' + params.km + '. Return ONLY JSON: {"structure":[{"time":"0-3s","action":"","text":"","audio":""}],"shooting":"","editing":"","caption":"","target_identity":"","she_feels":""}';
  else if (mode === 'series') prompt = 'Expand series for MAE ' + params.account + '. Seed: ' + params.name + '. ' + params.episodes + ' episodes. Return ONLY JSON: {"series_name":"","core_suspense":"","target_identity":"","rhythm":"","episodes":[{"ep":1,"title":"","key_message":"","hook":"","format":"","she_feels":""}]}';
  try {
    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system: sys, messages: [{ role: 'user', content: prompt }] })
    });
    var data = await r.json();
    var text = (data.content || []).filter(function(c) { return c.type === 'text'; }).map(function(c) { return c.text; }).join('');
    res.json({ text: text });
  } catch (e) { res.json({ text: '{"error":"' + e.message + '"}' }); }
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('MAE Dashboard on port ' + PORT); });
