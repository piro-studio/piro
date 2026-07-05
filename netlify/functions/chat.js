/* ===== PIRO Chatbot — Netlify Serverless Function =====
   Phase 1: Dynamic product catalog (RAG) + user personalization + session memory
   - Products fetched live from Supabase → no hallucination
   - User first name injected if logged in → warmer tone
   - Chat history saved/loaded from chat_sessions table
======================================================== */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL             = 'claude-haiku-4-5-20251001';
const MAX_TOKENS        = 400;
const MAX_HISTORY       = 10;

// اگه HTTPS_PROXY در محیط تعریف شده (توسعه محلی ایران)، از undici ProxyAgent استفاده کن
let _dispatcher = undefined;
if (process.env.HTTPS_PROXY) {
  try {
    const { ProxyAgent } = require('undici');
    _dispatcher = new ProxyAgent(process.env.HTTPS_PROXY);
  } catch {}
}
const proxyFetch = (url, opts) => {
  const { fetch: uFetch } = require('undici');
  return _dispatcher ? uFetch(url, { ...opts, dispatcher: _dispatcher }) : fetch(url, opts);
};

// کش کاتالوگ — یه‌بار از Supabase می‌خونه، بعد در حافظه نگه می‌داره
let catalogCache = null;
let catalogCacheTime = 0;
const CATALOG_TTL = 5 * 60 * 1000; // 5 دقیقه

/* ── Base system prompt (brand rules, never changes) ─────────────── */
const BASE_PROMPT = `تو دستیار خانه پیرو (PIRO Furniture) هستی — برند مبلمان لاکچری با سبک جپندی در تهران.

═══════════════ مهم‌ترین قانون: پاسخ به سلام ═══════════════
وقتی مشتری فقط سلام گفت یا احوال‌پرسی ساده کرد:
پاسخ اشتباه: «از کدام محصول علاقه‌مندید؟ کاناپه، تخت یا میز؟»
پاسخ درست: «سلام! خوش اومدی. چطور می‌تونم کمکت کنم؟»
فقط همین — یک جمله. هیچ محصولی، هیچ دسته‌بندی، هیچ سوال درباره خرید.

═══════════════ قانون زبان ═══════════════
زبان پاسخ را بر اساس زبان آخرین پیام مشتری انتخاب کن:
- اگر فارسی نوشت → فارسی پاسخ بده. از کلمات انگلیسی یا فارسی‌سازی‌شده (مثل «فرنچر») پرهیز کن؛ بگو «مبلمان».
- اگر انگلیسی نوشت → کاملاً به انگلیسی پاسخ بده. Natural, professional English.
هرگز دو زبان را در یک پاسخ قاطی نکن. از ایموجی استفاده نکن.

═══════════════ حوزه کاری ═══════════════
فقط درباره خانه پیرو، محصولات، مواد، ارسال، قیمت‌ها و اطلاعات فروشگاه صحبت کن.
اگر سوال خارج از این حوزه بود، با احترام بگو: «متأسفانه در این زمینه اطلاعاتی ندارم. فقط در مورد مبلمان خانه پیرو می‌تونم کمک کنم.»
هرگز برند دیگری معرفی یا مقایسه نکن.

═══════════════ قانون عدم تخمین ═══════════════
اگر مطمئن نیستی، حدس نزن. بگو: «برای پاسخ دقیق با همکارانم تماس بگیرید: ۰۲۱-۲۶۷۴-۶۷۲۴»
این قانون اجباری است برای: موجودی انبار، تخفیف‌های خاص، تاریخ دقیق تحویل، سفارش اختصاصی.

═══════════════ فرمت پاسخ ═══════════════
۱. پاسخ کوتاه و مفید (۲ تا ۴ جمله — نه بیشتر)
۲. اگر سوال درباره محصول، قیمت، متریال یا مشاوره خرید بود، در انتها یک محصول مرتبط معرفی کن:
   «✦ پیشنهاد من: [نام محصول] — [یک جمله دلیل]»
   برای احوال‌پرسی، پیگیری سفارش یا سوال درباره فروشگاه: این بخش را حذف کن.

═══════════════ شخصیت و لحن ═══════════════
- صمیمی، دلسوز، دوستانه — مثل دوستی آگاه که از مبلمان خوب لذت می‌بره
- هرگز فشار فروش نیاور
- وقتی از چوب و کیفیت حرف می‌زنی با علاقه و احساس بگو

═══════════════ اطلاعات برند ═══════════════
نام: خانه پیرو (PIRO Furniture) | سبک: جپندی | فلسفه: «هر قطعه خانه پیرو، داستان یک درخت است»
چوب: راش یکپارچه اروپایی ۱۰۰٪ | پوشش: روغن گیاهی روبیو مونوکوت بلژیک | پارچه: مرغوب ترکیه

═══════════════ ارسال و خرید ═══════════════
تولید: ۶۰ روز کاری | ارسال تهران: رایگان | خارج تهران: با هماهنگی
پرداخت: نقدی یا اقساط ۱۲ ماهه دیجی‌پی

═══════════════ فروشگاه و تماس ═══════════════
آدرس: تهران، سعادت‌آباد، مجتمع دیدا، طبقه دوم
ساعت: شنبه تا پنجشنبه ۱۰ صبح تا ۹ شب
تلفن: ۰۲۱-۲۶۷۴-۶۷۲۴ و ۰۲۱-۲۶۷۴-۶۹۳۴ | اینستاگرام: piro_ir@`;

/* ── Fallback catalog (used if Supabase is unavailable) ─────────── */
const FALLBACK_CATALOG = `【 کانپه و نشیمن 】
کاناپه تهران: تک‌نفره ۷۸M | دونفره ۱۰۵M | سه‌نفره ۱۳۸M | ال‌شکل ۱۴۵M | شزلون ۱۱۵M
کاناپه پالما: تک‌نفره ۶۵.۵M | دونفره ۹۲M | سه‌نفره ۱۱۲.۷M | ال‌شکل ۱۳۵M | شزلون ۱۰۵M
کاناپه هرموسا (جدید): تک‌نفره ۸۵M | دونفره ۱۲۹M | سه‌نفره ۱۶۵M
کاناپه موژه: تک‌نفره ۸۶.۵M | دونفره ۱۳۸M
کاناپه گوردو: تک‌نفره ۶۶M | دونفره ۸۸M | با شزلون ۱۱۵M
کاناپه شیتو: دونفره ۸۸M | سه‌نفره ۱۱۵M | ال‌شکل ۱۳۵M | شزلون ۱۰۵M
کاناپه دیبا: دونفره ۹۸.۵M | سه‌نفره ۱۲۵M
کاناپه هنکا: تک‌نفره ۸۶.۵M
مبل راحتی بلاندو: ۶۱M | مبل راحتی لَم | صندلی زِن | صندلی هیرکانی | صندلی لین
نیمکت همدم: ۵۵M | نیمکت لَت: ۱۲۰cm ۴۵M | ۱۵۰cm ۵۲.۸M | ۲۰۰cm ۶۵M
نیمکت موگنسن: ۳۵M | استول بار الف: ۱۴.۵M | استول بار لین
【 اتاق خواب 】
تخت نوشا: ۹۰×۲۰۰ ۷۱.۵M | ۱۶۰×۲۰۰ ۷۸M | تخت لیندا ۱۶۰: ۸۵M
تخت ندا (جدید): ۹۰×۲۰۰ ۷۵M | ۱۶۰×۲۰۰ ۸۸M | تخت الارا ۱۶۰: ۱۰۴.۵M
پاتختی مونو | پاتختی مود | دراور مود | دراور مود بزرگ | رخت‌آویز تانا: ۲۸M
【 میز ناهارخوری 】
ارسباران (جدید): ۶نفره ۱۱۲M | ۸نفره ۱۳۵M | سِرکا: ۴نفره ۷۱.۵M | ۸نفره ۹۵M
کایا ۴نفره: ۷۵.۹M | مود | OX: ۹۵M | تاک: ۸۵M | پیانورا: ۷۸M | سیمپل: ۶۵M
【 میز جلومبلی 】
EMI: ۷۱.۵M | EN: ۲۸M | کازوکو: ۳۸M | سنسیلا: ۲۵M | شونین: ۳۲M | سیمپل: ۲۸M
【 میز عسلی 】
EN: ۴۹.۵M | مور: ۲۲M | نیک: ۱۵M | سنسیلا: ۱۸M | شونین: ۱۸M
【 سایر میزها 】
میز بار آلتو: ۴۹.۵M | اِتود: ۹۵M | رَین: ۷۸M | اسکچ: ۵۵M | میز آرایش سنس: ۴۵M
【 کنسول و دکوراسیون 】
سایدبورد مود کوچک: ۶۲M | بزرگ: ۸۸M | کنسول مود: ۱۱۰cm ۳۵M | ۱۳۰cm ۴۵M
میز TV لارگو | مود۲ | مود۳ | کابینت مود: ۵۵M | آینه میرو: ۱۵.۵M
شلف شین: ۲طبقه ۳۵M | ۳طبقه ۴۵M | بلند ۷۵M | عریض ۶۵M | شلف پیزو: ۱۸M
آباژور کیدو: ۱۶.۵M | آباژور رَش: ۱۸M | باکس طبیعی: بزرگ ۱۲۶.۵M | کوچک ۶۵M`;

/* ── Supabase helpers ─────────────────────────────────────────────── */
function supabaseHeaders() {
  return {
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function fetchProducts() {
  // برگرداندن از کش اگه تازه باشه (5 دقیقه)
  if (catalogCache && (Date.now() - catalogCacheTime) < CATALOG_TTL) {
    return catalogCache;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  try {
    const res = await proxyFetch(
      `${url}/rest/v1/products?select=name_fa,name_en,price,sub,category,badge,variant_label,var_group&is_active=eq.true&order=category,sub,var_group,var_order`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(800) }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    catalogCache = formatProductCatalog(rows);
    catalogCacheTime = Date.now();
    return catalogCache;
  } catch {
    return null;
  }
}

function formatProductCatalog(rows) {
  // گروه‌بندی بر اساس var_group — هر گروه در یک خط
  const groups = {};
  for (const r of rows) {
    const key = r.var_group || r.name_fa;
    if (!groups[key]) groups[key] = { name: r.name_fa, sub: r.sub, variants: [] };
    const label = r.variant_label ? `${r.variant_label} ${r.price || ''}` : (r.price || '');
    if (label.trim()) groups[key].variants.push(label.trim());
  }

  // دسته‌بندی
  const cats = { living: '【 نشیمن 】', bedroom: '【 اتاق خواب 】', tables: '【 میزها 】', console: '【 کنسول 】' };
  const bycat = {};
  for (const [, g] of Object.entries(groups)) {
    const cat = rows.find(r => r.name_fa === g.name)?.category || 'other';
    if (!bycat[cat]) bycat[cat] = [];
    const varStr = g.variants.length > 1 ? g.variants.join(' | ') : (g.variants[0] || '');
    bycat[cat].push(`${g.name}${varStr ? ': ' + varStr : ''}`);
  }

  let out = '';
  for (const [cat, lines] of Object.entries(bycat)) {
    out += `\n${cats[cat] || '【 سایر 】'}\n${lines.join('\n')}\n`;
  }
  return out.trim();
}

/* ── Session (memory) helpers ─────────────────────────────────────── */
async function loadSession(sessionId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !sessionId) return null;

  try {
    const res = await proxyFetch(
      `${url}/rest/v1/chat_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=messages&limit=1`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(800) }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    const msgs = rows[0].messages || [];
    return msgs.slice(-MAX_HISTORY);
  } catch {
    return null;
  }
}

async function saveSession(sessionId, user, messages, reply) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !sessionId) return;

  const updated = [
    ...messages.slice(-MAX_HISTORY),
    { role: 'assistant', content: reply },
  ].slice(-MAX_HISTORY);

  try {
    // Upsert: create or update session
    await proxyFetch(`${url}/rest/v1/chat_sessions`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        session_id: sessionId,
        messages: updated,
        updated_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(800),
    });
  } catch {
    // Non-critical — ignore save errors
  }
}

/* ── Lead capture (conversations/messages → admin/index.html) ────── */
function extractPhone(text) {
  const m = String(text).match(/0?9\d{9}\b/);
  if (!m) return null;
  return m[0].startsWith('0') ? m[0] : '0' + m[0];
}

async function findOrCreateConversation(sessionId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !sessionId) return null;
  try {
    const getRes = await proxyFetch(
      `${url}/rest/v1/conversations?session_id=eq.${encodeURIComponent(sessionId)}&select=id,visitor_phone,status&limit=1`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(800) }
    );
    const rows = getRes.ok ? await getRes.json() : [];
    if (rows.length) return rows[0];

    const createRes = await proxyFetch(`${url}/rest/v1/conversations`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({ session_id: sessionId }),
      signal: AbortSignal.timeout(800),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    return created[0] || null;
  } catch {
    return null;
  }
}

async function saveLeadTurn(sessionId, userText, reply) {
  const url = process.env.SUPABASE_URL;
  const conv = await findOrCreateConversation(sessionId);
  if (!conv) return;

  const patch = { last_message_at: new Date().toISOString() };
  const phone = extractPhone(userText);
  if (phone && !conv.visitor_phone) {
    patch.visitor_phone = phone;
    if (!conv.status || conv.status === 'open') patch.status = 'lead';
  }

  try {
    await proxyFetch(`${url}/rest/v1/conversations?id=eq.${conv.id}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(800),
    });

    await proxyFetch(`${url}/rest/v1/messages`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify([
        { conversation_id: conv.id, role: 'user', content: userText },
        { conversation_id: conv.id, role: 'assistant', content: reply },
      ]),
      signal: AbortSignal.timeout(800),
    });
  } catch {
    // Non-critical — ignore save errors
  }
}

/* ── Build dynamic system prompt ─────────────────────────────────── */
function buildSystemPrompt(catalog, user) {
  let userCtx = '';
  if (user && user.firstName) {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const orderNote = user.orderCount > 0
      ? `قبلاً ${user.orderCount} سفارش داشته.`
      : 'هنوز سفارشی ثبت نکرده.';
    const contact = user.mobile ? `موبایل: ${user.mobile}` : '';
    userCtx = `\n═══════════════ مشتری لاگین‌شده ═══════════════\n` +
      `نام: ${fullName}${contact ? ' | ' + contact : ''}\n` +
      `${orderNote}\n` +
      `در مکالمه از اسم کوچکش «${user.firstName}» استفاده کن. مثلاً «${user.firstName} جان» یا «${user.firstName} عزیز».\n`;
  } else {
    userCtx = `\n═══════════════ مشتری ناشناس ═══════════════\nمشتری لاگین نکرده. مستقیم و محترمانه باهاش صحبت کن.\n`;
  }

  const catalogSection = `\n═══════════════ کاتالوگ محصولات (از دیتابیس) ═══════════════\n${catalog || FALLBACK_CATALOG}\n`;

  return BASE_PROMPT + userCtx + catalogSection;
}

/* ── Main handler ─────────────────────────────────────────────────── */
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let messages, user, sessionId;
  try {
    ({ messages, user, sessionId } = JSON.parse(event.body));
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('invalid');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  // Sanitize messages
  const sanitized = messages.slice(-MAX_HISTORY).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 2000),
  }));

  // Parallel: fetch products + load session memory
  const [catalog, history] = await Promise.all([
    fetchProducts(),
    loadSession(sessionId),
  ]);

  const systemPrompt = buildSystemPrompt(catalog, user);
  // وقتی history موجود است، پیام جدید کاربر را به آن اضافه کن
  const latestMsg = sanitized[sanitized.length - 1];
  const chatMessages = history ? [...history, latestMsg].slice(-MAX_HISTORY) : sanitized;

  try {
    const response = await proxyFetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: chatMessages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Upstream API error' }) };
    }

    const data  = await response.json();
    const reply = data.content?.[0]?.text || '';

    // Save session + lead (non-blocking)
    saveSession(sessionId, user, chatMessages, reply);
    saveLeadTurn(sessionId, latestMsg.content, reply);

    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
