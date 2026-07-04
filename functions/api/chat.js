/* ===== PIRO Chatbot — Cloudflare Pages Function =====
   /api/chat  →  functions/api/chat.js
   - Native fetch (no proxy needed — Cloudflare runs outside Iran)
   - context.env instead of process.env
   - new Response() instead of { statusCode, body }
======================================================= */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL             = 'claude-haiku-4-5-20251001';
const MAX_TOKENS        = 400;
const MAX_HISTORY       = 10;

// In-memory catalog cache (lives within a single Worker isolate)
let catalogCache     = null;
let catalogCacheTime = 0;
const CATALOG_TTL    = 5 * 60 * 1000;

/* ── Base system prompt ────────────────────────────────────────────── */
const BASE_PROMPT = `تو دستیار خانه پیرو (PIRO Furniture) هستی — برند مبلمان لاکچری با سبک جپندی در تهران.

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

═══════════════ مهم‌ترین قانون: پاسخ به سلام ═══════════════
وقتی مشتری فقط سلام گفت یا احوال‌پرسی ساده کرد:
پاسخ اشتباه: «از کدام محصول علاقه‌مندید؟ کاناپه، تخت یا میز؟»
پاسخ درست: «سلام! خوش اومدی. چطور می‌تونم کمکت کنم؟»
فقط همین — یک جمله. هیچ محصولی، هیچ دسته‌بندی، هیچ سوال درباره خرید.

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

/* ── Fallback catalog ─────────────────────────────────────────────── */
const FALLBACK_CATALOG = `【 کاناپه و نشیمن 】
کاناپه تهران: تک‌نفره ۷۸M | دونفره ۱۰۵M | سه‌نفره ۱۳۸M | ال‌شکل ۱۴۵M | شزلون ۱۱۵M
کاناپه پالما: تک‌نفره ۶۵.۵M | دونفره ۹۲M | سه‌نفره ۱۱۲.۷M | ال‌شکل ۱۳۵M | شزلون ۱۰۵M
کاناپه هرموسا (جدید): تک‌نفره ۸۵M | دونفره ۱۲۹M | سه‌نفره ۱۶۵M
کاناپه موژه: تک‌نفره ۸۶.۵M | دونفره ۱۳۸M
کاناپه گوردو: تک‌نفره ۶۶M | دونفره ۸۸M | با شزلون ۱۱۵M
کاناپه شیتو: دونفره ۸۸M | سه‌نفره ۱۱۵M | ال‌شکل ۱۳۵M | شزلون ۱۰۵M
کاناپه دیبا: دونفره ۹۸.۵M | سه‌نفره ۱۲۵M
کاناپه هنکا: تک‌نفره ۸۶.۵M
مبل راحتی بلاندو: ۶۱M | نیمکت همدم: ۵۵M | استول بار الف: ۱۴.۵M
【 اتاق خواب 】
تخت نوشا: ۹۰×۲۰۰ ۷۱.۵M | ۱۶۰×۲۰۰ ۷۸M | تخت لیندا ۱۶۰: ۸۵M
تخت ندا (جدید): ۹۰×۲۰۰ ۷۵M | ۱۶۰×۲۰۰ ۸۸M | تخت الارا ۱۶۰: ۱۰۴.۵M
پاتختی مونو | پاتختی مود | دراور مود | رخت‌آویز تانا: ۲۸M
【 میز ناهارخوری 】
ارسباران (جدید): ۶نفره ۱۱۲M | ۸نفره ۱۳۵M | سِرکا: ۴نفره ۷۱.۵M | ۸نفره ۹۵M
کایا ۴نفره: ۷۵.۹M | OX: ۹۵M | تاک: ۸۵M | پیانورا: ۷۸M | سیمپل: ۶۵M
【 میز جلومبلی 】
EMI: ۷۱.۵M | EN: ۲۸M | کازوکو: ۳۸M | سنسیلا: ۲۵M | شونین: ۳۲M
【 کنسول و دکوراسیون 】
سایدبورد مود کوچک: ۶۲M | بزرگ: ۸۸M | کنسول مود: ۱۱۰cm ۳۵M | ۱۳۰cm ۴۵M
شلف شین: ۲طبقه ۳۵M | ۳طبقه ۴۵M | آباژور کیدو: ۱۶.۵M`;

/* ── Supabase helpers ─────────────────────────────────────────────── */
function supabaseHeaders(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function fetchProducts(env) {
  if (catalogCache && (Date.now() - catalogCacheTime) < CATALOG_TTL) {
    return catalogCache;
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;

  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/products?select=name_fa,price,sub,category,variant_label,var_group&is_active=eq.true&order=category,sub,var_group`,
      { headers: supabaseHeaders(env), signal: AbortSignal.timeout(2000) }
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
  const groups = {};
  for (const r of rows) {
    const key = r.var_group || r.name_fa;
    if (!groups[key]) groups[key] = { name: r.name_fa, category: r.category, variants: [] };
    const label = r.variant_label ? `${r.variant_label} ${r.price || ''}` : (r.price || '');
    if (label.trim()) groups[key].variants.push(label.trim());
  }

  const catLabels = { living: '【 نشیمن 】', bedroom: '【 اتاق خواب 】', tables: '【 میزها 】', console: '【 کنسول 】' };
  const bycat = {};
  for (const g of Object.values(groups)) {
    const cat = g.category || 'other';
    if (!bycat[cat]) bycat[cat] = [];
    const varStr = g.variants.join(' | ');
    bycat[cat].push(`${g.name}${varStr ? ': ' + varStr : ''}`);
  }

  return Object.entries(bycat)
    .map(([cat, lines]) => `${catLabels[cat] || '【 سایر 】'}\n${lines.join('\n')}`)
    .join('\n');
}

/* ── Session helpers ─────────────────────────────────────────────── */
async function loadSession(env, sessionId) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !sessionId) return null;
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/chat_sessions?session_id=eq.${encodeURIComponent(sessionId)}&select=messages&limit=1`,
      { headers: supabaseHeaders(env), signal: AbortSignal.timeout(1500) }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    return (rows[0].messages || []).slice(-MAX_HISTORY);
  } catch {
    return null;
  }
}

async function saveSession(env, sessionId, messages, reply) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !sessionId) return;
  const updated = [...messages.slice(-MAX_HISTORY), { role: 'assistant', content: reply }].slice(-MAX_HISTORY);
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/chat_sessions`, {
      method: 'POST',
      headers: { ...supabaseHeaders(env), 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ session_id: sessionId, messages: updated, updated_at: new Date().toISOString() }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

/* ── Lead capture (conversations/messages → admin/index.html) ────── */
function extractPhone(text) {
  const m = String(text).match(/0?9\d{9}\b/);
  if (!m) return null;
  return m[0].startsWith('0') ? m[0] : '0' + m[0];
}

async function findOrCreateConversation(env, sessionId) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !sessionId) return null;
  try {
    const getRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/conversations?session_id=eq.${encodeURIComponent(sessionId)}&select=id,visitor_phone,status&limit=1`,
      { headers: supabaseHeaders(env), signal: AbortSignal.timeout(1500) }
    );
    const rows = getRes.ok ? await getRes.json() : [];
    if (rows.length) return rows[0];

    const createRes = await fetch(`${env.SUPABASE_URL}/rest/v1/conversations`, {
      method: 'POST',
      headers: { ...supabaseHeaders(env), 'Prefer': 'return=representation' },
      body: JSON.stringify({ session_id: sessionId }),
      signal: AbortSignal.timeout(1500),
    });
    if (!createRes.ok) return null;
    const created = await createRes.json();
    return created[0] || null;
  } catch {
    return null;
  }
}

async function saveLeadTurn(env, sessionId, userText, reply) {
  const conv = await findOrCreateConversation(env, sessionId);
  if (!conv) return;

  const patch = { last_message_at: new Date().toISOString() };
  const phone = extractPhone(userText);
  if (phone && !conv.visitor_phone) {
    patch.visitor_phone = phone;
    if (!conv.status || conv.status === 'open') patch.status = 'lead';
  }

  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/conversations?id=eq.${conv.id}`, {
      method: 'PATCH',
      headers: supabaseHeaders(env),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(1500),
    });

    await fetch(`${env.SUPABASE_URL}/rest/v1/messages`, {
      method: 'POST',
      headers: supabaseHeaders(env),
      body: JSON.stringify([
        { conversation_id: conv.id, role: 'user', content: userText },
        { conversation_id: conv.id, role: 'assistant', content: reply },
      ]),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

/* ── System prompt builder ────────────────────────────────────────── */
function buildSystemPrompt(catalog, user) {
  let userCtx;
  if (user && user.firstName) {
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const orderNote = user.orderCount > 0 ? `قبلاً ${user.orderCount} سفارش داشته.` : 'هنوز سفارشی ثبت نکرده.';
    const contact = user.mobile ? ` | موبایل: ${user.mobile}` : '';
    userCtx = `\n═══════════════ مشتری لاگین‌شده ═══════════════\nنام: ${fullName}${contact}\n${orderNote}\nدر مکالمه از اسم کوچکش «${user.firstName}» استفاده کن.\n`;
  } else {
    userCtx = `\n═══════════════ مشتری ناشناس ═══════════════\nمشتری لاگین نکرده. مستقیم و محترمانه باهاش صحبت کن.\n`;
  }
  const catalogSection = `\n═══════════════ کاتالوگ محصولات ═══════════════\n${catalog || FALLBACK_CATALOG}\n`;
  return BASE_PROMPT + userCtx + catalogSection;
}

/* ── CORS headers ─────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

/* ── Main handler ─────────────────────────────────────────────────── */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let messages, user, sessionId;
  try {
    ({ messages, user, sessionId } = await request.json());
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('invalid');
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers: CORS });
  }

  const sanitized = messages.slice(-MAX_HISTORY).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 2000),
  }));

  const [catalog, history] = await Promise.all([
    fetchProducts(env),
    loadSession(env, sessionId),
  ]);

  const systemPrompt = buildSystemPrompt(catalog, user);
  // وقتی history موجود است، پیام جدید کاربر را به آن اضافه کن
  const latestMsg = sanitized[sanitized.length - 1];
  const chatMessages = history ? [...history, latestMsg].slice(-MAX_HISTORY) : sanitized;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages: chatMessages }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return new Response(JSON.stringify({ error: 'Upstream API error' }), { status: 502, headers: CORS });
    }

    const data  = await response.json();
    const reply = data.content?.[0]?.text || '';

    context.waitUntil(saveSession(env, sessionId, chatMessages, reply));
    context.waitUntil(saveLeadTurn(env, sessionId, latestMsg.content, reply));

    return new Response(JSON.stringify({ reply }), { status: 200, headers: CORS });

  } catch (err) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: CORS });
  }
}
