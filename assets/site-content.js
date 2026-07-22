/* ================================================================
   PIRO — Site Settings Loader
   یک بار site_settings را از Supabase می‌خواند و در المان‌های
   data-site-text/data-site-href جایگزین می‌کند. اگر دیتابیس در دسترس
   نبود یا مقداری خالی بود، متن استاتیک موجود در HTML دست‌نخورده می‌ماند.
   نکته سازگاری با تاگل زبان (assets/main.js → applyLang):
   برای فیلدهایی که نسخه EN جدا دارند (آدرس/ساعات کاری)، هم data-en
   و هم متن فعلی را به‌روزرسانی می‌کنیم تا بعداً toggle زبان هم مقدار
   درست را نشان بدهد.

   کش محلی: این تنظیمات (تلفن/آدرس/ساعات کاری) به‌ندرت عوض می‌شوند، ولی
   قبلاً هر بار لودشدنِ هر صفحه یک کوئری کامل به Supabase می‌زد — یعنی
   یک round-trip شبکه‌ی اضافه، جدا از کوئری محصولات. حالا نتیجه را در
   localStorage با اعتبار ۱ ساعت نگه می‌داریم؛ در همون بازه، صفحات بعدی
   اصلاً به شبکه نمی‌زنند و مستقیم از کش می‌خونن.
   ================================================================ */
(function () {
  const CACHE_KEY = 'piro_site_settings_cache_v1';
  const CACHE_TTL_MS = 60 * 60 * 1000; // ۱ ساعت

  function isEnActive() {
    return localStorage.getItem('piro_lang') === 'en';
  }
  // برای فیلدهای بدون نیاز به ترجمه (تلفن، ایمیل)
  function applyText(key, value) {
    if (!value) return;
    document.querySelectorAll(`[data-site-text="${key}"]`).forEach((el) => {
      el.textContent = value;
    });
  }
  // برای فیلدهای دوزبانه که المانشان data-en دارد (آدرس، ساعات کاری)
  function applyBilingual(key, valueFa, valueEn) {
    document.querySelectorAll(`[data-site-text="${key}"]`).forEach((el) => {
      if (valueFa) el.setAttribute('data-fa', valueFa);
      if (valueEn) el.setAttribute('data-en', valueEn);
      const chosen = isEnActive() ? (valueEn || valueFa) : (valueFa || valueEn);
      if (chosen) el.textContent = chosen;
    });
  }
  function applyHref(key, href) {
    if (!href) return;
    document.querySelectorAll(`[data-site-href="${key}"]`).forEach((el) => {
      el.href = href;
    });
  }
  function applySettings(data) {
    applyText('phone1', data.phone_1);
    applyText('phone2', data.phone_2);
    applyText('email', data.email);
    applyBilingual('address', data.address_fa, data.address_en);
    applyBilingual('hours', data.working_hours_fa, data.working_hours_en);
    if (data.instagram_handle) applyHref('instagram', `https://instagram.com/${data.instagram_handle}`);
    if (data.whatsapp) applyHref('whatsapp', `https://wa.me/${data.whatsapp}`);
    if (data.email) applyHref('mailto', `mailto:${data.email}`);
    if (data.phone_1) applyHref('tel1', `tel:${data.phone_1.replace(/[^0-9]/g, '')}`);
    if (data.phone_2) applyHref('tel2', `tel:${data.phone_2.replace(/[^0-9]/g, '')}`);
  }
  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.ts !== 'number') return null;
      if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
      return parsed.data || null;
    } catch (e) {
      return null;
    }
  }
  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
    } catch (e) {
      // localStorage پر یا غیرفعال — مشکلی نیست، فقط کش نمی‌شه
    }
  }
  async function loadSiteSettings() {
    if (!window.PIRO || !window.PIRO.db) return;
    try {
      const cached = readCache();
      if (cached) {
        applySettings(cached);
        return;
      }
      const { data, error } = await window.PIRO.db.from('site_settings').select('*').eq('id', 1).single();
      if (error || !data) return;
      writeCache(data);
      applySettings(data);
    } catch (e) {
      console.error('[PIRO] site-content load failed', e);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSiteSettings);
  } else {
    loadSiteSettings();
  }
  window.PIRO = window.PIRO || {};
  // برای وقتی که خودِ ادمین تنظیمات رو عوض می‌کنه و می‌خواد بدونِ رفرش
  // کامل، بلافاصله ببینتش (کش رو هم پاک می‌کنیم تا مقدار قدیمی نمونه).
  window.PIRO.reloadSiteContent = function () {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    return loadSiteSettings();
  };
})();
