/* ================================================================
   PIRO — Supabase Client Config
   ================================================================ */

const SUPABASE_URL  = 'https://oebexlccwcidcwandxpx.supabase.co';
const SUPABASE_ANON = 'sb_publishable_cZjKXwvCUkZqhiIs3K49Zg_Whrbdg93';

// اطمینان از اینکه کتابخانه Supabase بارگذاری شده
if (typeof window.supabase === 'undefined') {
  console.error('[PIRO] Supabase CDN not loaded. Make sure the script tag is before this file.');
}

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ── Session ID (سبد خرید بدون ورود) ── */
function getSessionId() {
  let sid = localStorage.getItem('piro_sid');
  if (!sid) {
    sid = crypto.randomUUID();
    localStorage.setItem('piro_sid', sid);
  }
  return sid;
}

/* ── وضعیت کاربر فعلی ── */
// getSession() لوکاله (بدون شبکه)؛ فقط وقتی سشنی واقعاً هست سراغ getUser()
// (که با سرور اعتبارسنجی می‌کنه) می‌ریم — تا بازدیدکننده‌ی مهمان روی هر
// صفحه یک round-trip شبکه‌ای مفت برای چک کردن auth نداشته باشه.
async function getCurrentUser() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) return null;
  const { data: { user } } = await db.auth.getUser();
  return user;
}

/* ── رویداد تغییر وضعیت Auth ── */
db.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session) {
    _mergeLocalCartToSupabase(session.user.id);
    document.dispatchEvent(new CustomEvent('piro:auth', { detail: { user: session.user } }));
  }
  if (event === 'SIGNED_OUT') {
    document.dispatchEvent(new CustomEvent('piro:auth', { detail: { user: null } }));
  }
});

/* ادغام سبد خرید localStorage به Supabase هنگام ورود */
async function _mergeLocalCartToSupabase(userId) {
  let localItems;
  try { localItems = JSON.parse(localStorage.getItem('piro_cart_items') || '[]'); }
  catch { return; }
  if (!localItems.length) return;

  const rows = localItems.map(i => ({
    user_id:       userId,
    product_id:    i.product_id,
    variant_label: i.variant_label || null,
    quantity:      i.quantity || 1,
  }));

  for (const row of rows) {
    const { data: existing } = await db.from('cart_items')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('product_id', row.product_id)
      .eq('variant_label', row.variant_label ?? '')
      .maybeSingle();

    if (existing) {
      await db.from('cart_items')
        .update({ quantity: existing.quantity + row.quantity, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await db.from('cart_items').insert(row);
    }
  }

  localStorage.removeItem('piro_cart_items');
  localStorage.setItem('piro_cart_count', '0');
}

window.PIRO = window.PIRO || {};
Object.assign(window.PIRO, { db, getSessionId, getCurrentUser });
