const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

const NOTION_KEY = process.env.NOTION_KEY || 'ntn_你的TOKEN';
const CLAUDE_KEY = process.env.CLAUDE_KEY || '';
const INSP_DB = 'ecbcd501-bfd4-4de3-b0bd-57b7dc7a9be9';
const HOOK_DB = 'b079b0e7-95a8-42cb-bc7d-c1c9ab8be560';
const BENCH_DB = 'e8de72dd-8999-47ab-aa84-6678e3637ea3';

async function notionQuery(dbId, filter, sorts) {
  const body = { page_size: 100 };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  const r = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${NOTION_KEY}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify(body)
  });
  return r.json();
}

function getProp(page, name) {
  const p = page.properties[name];
  if (!p) return '';
  if (p.type === 'title') return p.title?.[0]?.text?.content || '';
  if (p.type === 'rich_text') return p.rich_text?.[0]?.text?.content || '';
  if (p.type === 'select') return p.select?.name || '';
  if (p.type === 'multi_select') return (p.multi_select || []).map(s => s.name);
  if (p.type === 'url') return p.url || '';
  if (p.type === 'number') return p.number;
  if (p.type === 'status') return p.status?.name || '';
  if (p.type === 'unique_id') return p.unique_id ? `${p.unique_id.prefix || ''}-${p.unique_id.number}` : '';
  return '';
}

app.get('/api/inspirations', async (req, res) => {
  try {
    const data = await notionQuery(INSP_DB, null, [{ property: '灵感ID', direction: 'descending' }]);
    const items = (data.results || []).map(p => ({
      id: getProp(p, '灵感ID'),
      title: getProp(p, '内容亮点'),
      account: getProp(p, '账号方向'),
      identity: getProp(p, '目标身份'),
      event: getProp(p, '事件类型'),
      format: getProp(p, '内容格式'),
      elements: getProp(p, '爆款元素'),
      concept: getProp(p, 'MAE版本概念'),
      compliance: getProp(p, '合规检查'),
      judgment: getProp(p, '内容判断'),
      source: getProp(p, '来源'),
      platform: getProp(p, '平台'),
      link: getProp(p, '链接'),
      status: getProp(p, '状态'),
      summary: getProp(p, 'AI拆解摘要')
    }));
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/hooks', async (req, res) => {
  try {
    const data = await notionQuery(HOOK_DB, null, [{ property: '钩子ID', direction: 'descending' }]);
    const items = (data.results || []).map(p => ({
      id: getProp(p, '钩子ID'),
      content: getProp(p, '钩子内容'),
      type: getProp(p, '钩子类型'),
      account: getProp(p, '适用账号'),
      identity: getProp(p, '适用身份'),
      example: getProp(p, '例句'),
      source: getProp(p, '来源')
    }));
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/benchmarks', async (req, res) => {
  try {
    const data = await notionQuery(BENCH_DB);
    const items = (data.results || []).map(p => ({
      id: getProp(p, '账号ID'),
      name: getProp(p, '账号名'),
      platform: getProp(p, '平台'),
      language: getProp(p, '语言'),
      reason: getProp(p, '对标原因'),
      types: getProp(p, '内容类型'),
      link: getProp(p, '链接'),
      followers: getProp(p, '粉丝量级')
    }));
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ai', async (req, res) => {
  if (!CLAUDE_KEY) return res.json({ text: 'Claude API key not configured. Add CLAUDE_KEY environment variable.' });
  const { mode, params } = req.body;
  const sys = 'You are MAE Global\'s AI content assistant. MAE empowers women aged 25-45 across all identities. Brand mission: help women find inner strength, see their value, live with confidence and beauty. NEVER quote this mission. CEO Kate @kateysy (real stories, no ad reading). Brand @maeglobalofficial (must have Key Message). Event First: Event>Emotion>Copy. 5 Events: Contrast, Result, Process, Conflict, Identity.';
  let prompt = '';
  if (mode === 'hook') {
    prompt = `Generate 5 hooks for MAE ${params.account}. Identity: ${params.identity}. Topic: ${params.topic}.\nReturn ONLY JSON array:\n[{"type":"悬念型/反差型/数字型/痛点型/金句型","hook":"3-second hook in Chinese","visual":"what viewer sees","why":"why it works"}]`;
  } else if (mode === 'script') {
    prompt = `Build a ${params.duration}s script for MAE ${params.account}.\nHook: ${params.hook}\nKey Message: ${params.km}\nReturn ONLY JSON:\n{"structure":[{"time":"0-3s","action":"screen action","text":"text shown","audio":"music"}],"shooting":"how to shoot","editing":"editing rhythm","caption":"IG caption + hashtags","target_identity":"which woman","she_feels":"what she feels"}`;
  } else if (mode === 'series') {
    prompt = `Expand series for MAE ${params.account}. Seed: ${params.name}. ${params.episodes} episodes.\nReturn ONLY JSON:\n{"series_name":"","core_suspense":"","target_identity":"","rhythm":"","episodes":[{"ep":1,"title":"","key_message":"","hook":"","format":"","she_feels":""}]}`;
  }
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 2000, system: sys, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    const text = data.content?.filter(c => c.type === 'text').map(c => c.text).join('') || '';
    res.json({ text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MAE Dashboard running on port ${PORT}`));
