const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 500;
const MAX_HISTORY = 10;

let catalogCache = null;
let catalogCacheTime = 0;
const CATALOG_TTL = 5 * 60 * 1000;

const BASE_PROMPT = `تو مشاور خانه پیرو (PIRO Furniture) هستی — برند مبلمان دست‌ساز از چوب طبیعی در تهران.

═══════════════ شخصیت و فلسفه ═══════════════
خانه پیرو فقط مبل نمی‌فروشه — یه حس می‌فروشه. حس آرامش، اصالت و زندگی با کیفیت.
تو مثل یه دوست متخصص هستی که مشتری بهش اعتماد داره.
نه فروشنده اصرارکننده، نه ربات سرد — یه مشاور واقعی که دلسوزانه کمک می‌کنه.

═══════════════ قوانین پاسخ‌دهی ═══════════════
۱. فقط به همان چیزی پاسخ بده که پرسیده شده
۲. ۲. اگر قیمت پرسیده شد: فقط اعداد قیمت بده. هیچ جمله دیگری نزن. نه ارسال، نه اقساط، نه پیشنهاد
۳. پیشنهاد سایز یا مدل: فقط بعد از دونستن متراژ و سبک فضا
۴. پیشنهاد محصول: فقط وقتی مشتری راهنمایی خواست
۵. درباره جنس: فقط اطلاعات مرتبط با همان محصول
۶. هرگز حدس نزن — اگه نمی‌دونی صادقانه بگو
۷. پاسخ‌ها کوتاه، دقیق و با احترام

═══════════════ قانون زبان ═══════════════
فارسی بنویسه → فارسی جواب بده | انگلیسی بنویسه → انگلیسی جواب بده
هرگز دو زبان رو قاطی نکن. بدون ایموجی.

═══════════════ حوزه کاری ═══════════════
فقط درباره خانه پیرو، محصولات، قیمت‌ها، ارسال و اطلاعات فروشگاه.
سوال نامرتبط: «من فقط در مورد مبلمان خانه پیرو می‌تونم کمک کنم.»

═══════════════ وقتی مطمئن نیستی ═══════════════
برای موجودی، تخفیف خاص، تاریخ دقیق تحویل، سفارش اختصاصی:
«برای پاسخ دقیق با تیم ما تماس بگیرید: -6724-2674-021»

═══════════════ اطلاعات برند ═══════════════
نام: خانه پیرو (PIRO Furniture) | سبک: جپندی-اسکاندیناوی
فلسفه: «هر قطعه خانه پیرو، داستان یک درخت است»
چوب: راش یکپارچه اروپایی | پوشش: روبیو مونوکوت بلژیک



═══════════════ فروشگاه ═══════════════
تهران، سعادت‌آباد، مجتمع دیدا، طبقه دوم
شنبه تا پنجشنبه ۱۰ صبح تا ۹ شب
تلفن: ۰۲۱-۲۶۷۴-۶۷۲۴ | اینستاگرام: piro_ir@`;

const FALLBACK_CATALOG = `【 کاناپه و نشیمن 】
کاناپه تهران: تک‌نفره ۷۸M | دونفره ۱۰۵M | سه‌نفره ۱۳۸M | ال‌شکل ۱۴۵M | شزلون ۱۱۵M
کاناپه پالما: تک‌نفره ۶۵.۵M | دونفره ۹۲M | سه‌نفره ۱۱۲.۷M | ال‌شکل ۱۳۵M | شزلون ۱۰۵M
کاناپه هرموسا (جدید): تک‌نفره ۸۵M | دونفره ۱۲۹M | سه‌نفره ۱۶۵M
کاناپه موژه: تک‌نفره ۸۶.۵M | دونفره ۱۳۸M
کاناپه گوردو: تک‌نفره ۶۶M | دونفره ۸۸M | با شزلون ۱۱۵M
کاناپه شیتو: دونفره ۸۸M | سه‌نفره ۱۱۵M | ال‌شکل ۱۳۵M | شزلون ۱۰۵M
کاناپه دیبا: دونفره ۹۸.۵M | سه‌نفره ۱۲۵M
کاناپه هنکا: تک‌نفره ۸۶.۵M
مبل راحتی بلاندو: ۶۱M | صندلی زِن | صندلی هیرکانی | صندلی لین
نیمکت همدم: ۵۵M | نیمکت لَت: ۱۲۰cm ۴۵M | ۱۵۰cm ۵۲.۸M | ۲۰۰cm ۶۵M
نیمکت موگنسن: ۳۵M | استول بار الف: ۱۴.۵M
【 اتاق خواب 】
تخت نوشا: ۹۰x200 ۷۱.۵M | ۱۶۰x200 ۷۸M | تخت لیندا ۱۶۰: ۸۵M
تخت ندا (جدید): ۹۰x200 ۷۵M | ۱۶۰x200 ۸۸M | تخت الارا ۱۶۰: ۱۰۴.۵M
پاتختی مونو | پاتختی مود | دراور مود | دراور مود بزرگ | رخت‌آویز تانا: ۲۸M
【 میز ناهارخوری 】
ارسباران (جدید): ۶نفره ۱۱۲M | ۸نفره ۱۳۵M
سِرکا: ۴نفره ۷۱.۵M | ۸نفره ۹۵M
کایا ۴نفره: ۷۵.۹M | OX: ۹۵M | تاک: ۸۵M | پیانورا: ۷۸M | سیمپل: ۶۵M
【 میز جلومبلی 】
EMI: ۷۱.۵M | EN: ۲۸M | کازوکو: ۳۸M | سنسیلا: ۲۵M | شونین: ۳۲M
【 میز عسلی 】
EN: ۴۹.۵M | مور: ۲۲M | نیک: ۱۵M | سنسیلا: ۱۸M | شونین: ۱۸M
【 سایر میزها 】
میز بار آلتو: ۴۹.۵M | اتود: ۹۵M | رین: ۷۸M | اسکچ: ۵۵M | میز آرایش سنس: ۴۵M
【 کنسول و دکوراسیون 】
سایدبورد مود کوچک: ۶۲M | بزرگ: ۸۸M
کنسول مود: ۱۱۰cm ۳۵M | ۱۳۰cm ۴۵M
میز TV لارگو | مود۲ | مود۳ | کابینت مود: ۵۵M | آینه میرو: ۱۵.۵M
شلف شین: ۲طبقه ۳۵M | ۳طبقه ۴۵M | بلند ۷۵M | عریض ۶۵M | شلف پیزو: ۱۸M
آباژور کیدو: ۱۶.۵M | آباژور رش: ۱۸M`;

function supabaseHeaders() {
  return {
    'apikey': process.env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function fetchProducts() {
  if (catalogCache && (Date.now() - catalogCacheTime) < CATALOG_TTL) {
    return catalogCache;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  try {
    const res = await fetch(
      `${url}/rest/v1/products?select=name_fa,price,sub,category,variant_label,var_group&is_active=eq.true&order=category,sub,var_group`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(2000) }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;

    const groups = {};
    for (const r of rows) {
      const k = r.var_group || r.name_fa;
      if (!groups[k]) groups[k] = { name: r.name_fa, category: r.category, variants: [] };
      const label = r.variant_label ? `${r.variant_label} ${r.price || ''}` : (r.price || '');
      if (label.trim()) groups[k].variants.push(label.trim());
    }

    const cats = { living: 'نشیمن', bedroom: 'اتاق خواب', tables: 'میزها', console: 'کنسول' };
    const bycat = {};
    for (const g of Object.values(groups)) {
      const cat = g.category || 'other';
      if (!bycat[cat]) bycat[cat] = [];
      const varStr = g.variants.join(' | ');
      bycat[cat].push(`${g.name}${varStr ? ': ' + varStr : ''}`);
    }

    let out = '';
    for (const [cat, lines] of Object.entries(bycat)) {
      out += `\n【 ${cats[cat] || 'سایر'} 】\n${lines.join('\n')}\n`;
    }
    catalogCache = out.trim();
    catalogCacheTime = Date.now();
    return catalogCache;
  } catch {
    return null;
  }
}

async function fetchUserOrders(userId) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key || !userId) return null;

  try {
    const res = await fetch(
      `${url}/rest/v1/orders?user_id=eq.${userId}&select=order_number,status,total_amount,created_at&order=created_at.desc&limit=5`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(2000) }
    );
    if (!res.ok) return null;
    const orders = await res.json();
        if (!orders.length) return 'هنوز سفارشی ثبت نشده.';

    const statusMap = {
      'pending': 'در انتظار تایید',
      'confirmed': 'تایید شده',
      'in_production': 'در حال تولید',
      'ready': 'آماده ارسال',
      'shipped': 'ارسال شده',
      'delivered': 'تحویل داده شده',
      'cancelled': 'لغو شده'
    };

    return orders.map(o =>
      `سفارش ${o.order_number}: ${statusMap[o.status] || o.status} — ${Number(o.total_amount).toLocaleString('fa-IR')} تومان`
    ).join('\n');
  } catch {
    return null;
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
    const getRes = await fetch(
      `${url}/rest/v1/conversations?session_id=eq.${encodeURIComponent(sessionId)}&select=id,visitor_phone,status&limit=1`,
      { headers: supabaseHeaders(), signal: AbortSignal.timeout(1500) }
    );
    const rows = getRes.ok ? await getRes.json() : [];
    if (rows.length) return rows[0];

    const createRes = await fetch(`${url}/rest/v1/conversations`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), 'Prefer': 'return=representation' },
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
    await fetch(`${url}/rest/v1/conversations?id=eq.${conv.id}`, {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(1500),
    });

    await fetch(`${url}/rest/v1/messages`, {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify([
        { conversation_id: conv.id, role: 'user', content: userText },
        { conversation_id: conv.id, role: 'assistant', content: reply },
      ]),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
}

function buildSystemPrompt(catalog, user, orders) {
  let userCtx = '';
  if (user && user.firstName) {
    userCtx = `\n═══════════════ مشتری لاگین‌شده ═══════════════\n`;
    userCtx += `نام: ${user.firstName} ${user.lastName || ''}\n`;
    userCtx += `از اسم کوچکش «${user.firstName}» استفاده کن — صمیمی ولی محترم.\n`;
    if (orders) userCtx += `\nسفارشات اخیر:\n${orders}\n`;
  } else {
    userCtx = `\n═══════════════ مشتری مهمان ═══════════════\nمشتری لاگین نکرده. محترمانه و مستقیم باهاش صحبت کن.\n`;
  }

  const catalogSection = `\n═══════════════ کاتالوگ محصولات ═══════════════\n${catalog || FALLBACK_CATALOG}\n`;
  return BASE_PROMPT + userCtx + catalogSection;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let messages, user, sessionId;
  try {
    ({ messages, user, sessionId } = req.body);
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('invalid');
  } catch {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const sanitized = messages.slice(-MAX_HISTORY).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content).slice(0, 2000),
  }));

  const [catalog, orders] = await Promise.all([
    fetchProducts(),
    user?.id ? fetchUserOrders(user.id) : Promise.resolve(null),
  ]);

  const systemPrompt = buildSystemPrompt(catalog, user, orders);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
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
        messages: sanitized,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic error:', err);
      return res.status(502).json({ error: 'Upstream API error' });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || '';
    const lines = reply.split('\n').filter(line => {
  const l = line.trim();
  if (!l) return false;
  if (l.startsWith('✦') || l.startsWith('پیشنهاد') || l.startsWith('+')) return false;
  if (l.includes('پیشنهاد من:')) return false;
  return true;
});
const cleanReply = lines.join('\n').trim();
    const lastUserMsg = sanitized[sanitized.length - 1];
    // باید await شود — Vercel بعد از پاسخ، اجرای پرامیس‌های معلق را تضمین نمی‌کند
    await saveLeadTurn(sessionId, lastUserMsg?.content || '', cleanReply).catch(() => {});
    return res.status(200).json({ reply: cleanReply });

  } catch (err) {
    console.error('Function error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}