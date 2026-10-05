import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSilver, extractResponseText, normalizeAiModel, parseStructuredResponse, selectRelevantNews } from '../src/ai.mjs';

const analysis = {
  summary: '白银短期仍可能保持震荡。',
  horizons: [
    { label: '未来1天', up: 40, flat: 35, down: 25, view: '震荡偏强', reasons: ['美元变化'] },
    { label: '未来3天', up: 35, flat: 40, down: 25, view: '区间震荡', reasons: ['事件风险'] },
    { label: '未来1周', up: 45, flat: 30, down: 25, view: '偏强震荡', reasons: ['工业需求'] },
    { label: '未来1个月', up: 40, flat: 30, down: 30, view: '双向波动', reasons: ['宏观政策'] },
  ],
  news: [],
  risks: ['公开信息可能变化'],
};

test('DeepSeek model migration and structured response parsing are tolerant', () => {
  assert.equal(normalizeAiModel('deepseek-v4-flash'), 'deepseek-v4-flash');
  assert.equal(normalizeAiModel('deepseek-v4-pro'), 'deepseek-v4-pro');
  assert.deepEqual(parseStructuredResponse(`\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``), analysis);
  assert.equal(extractResponseText({ output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), '{"ok":true}');
});

test('AI request uses supplied Rongtongjin news, stable sampling, and accepts fenced JSON', async () => {
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'resp-1', status: 'completed', model: 'deepseek-flash', output: [{ type: 'message', content: [{ type: 'output_text', text: `\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\`` }] }] }) };
  };
  const result = await analyzeSilver({ apiKey: 'sk-test', model: 'deepseek-v4-flash' }, { status: 'connected', market: '开盘中', quotes: [{ code: 'JZJ_ag', bid: 14.5, ask: 14.6, bidTime: Date.now(), askTime: Date.now() }] }, { fetchImpl, news: [{ id:'n1', publishedAt:Date.now(), title:'美元指数回落', content:'贵金属走强', source:'金十数据', url:'https://example.com/n1' }] });
  assert.equal(request.model, 'deepseek-v4-flash');
  assert.deepEqual(request.reasoning, { effort: 'none' });
  assert.equal(request.temperature, 0.15);
  assert.equal(request.tools, undefined);
  assert.match(request.input, /美元指数回落/);
  assert.equal(request.max_output_tokens, 6000);
  assert.equal(result.horizons.length, 4);
  assert.equal(result.horizons[0].up + result.horizons[0].flat + result.horizons[0].down, 100);
});

test('AI incomplete responses return an understandable error', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }) });
  await assert.rejects(() => analyzeSilver({ apiKey: 'sk-test', model: 'deepseek-flash' }, {}, { fetchImpl }), /生成不完整/);
});

test('AI news selection keeps silver-relevant and important items',()=>{
  const selected=selectRelevantNews([{id:'1',title:'无关公司新闻'},{id:'2',title:'白银工业需求变化'},{id:'3',title:'其他事件',important:true}]);
  assert.deepEqual(selected.map(item=>item.id),['2','3']);
});
