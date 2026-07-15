/* ================================================================
   PIRO — Database Helper Functions
   نیاز به: supabase-client.js (قبل از این فایل بارگذاری شود)
   ================================================================ */

(function () {
  const { db, getSessionId, getCurrentUser } = window.PIRO;

  /* ────────────────────────────────────────────
     PRODUCTS
  ──────────────────────────────────────────── */

  async function getProducts({ category, sub, featured } = {}) {
    let query = db.from('products').select('*').eq('is_active', true);

    if (category) query = query.eq('category', category);
    if (sub)      query = query.eq('sub', sub);
    if (featured) query = query.eq('is_featured', true);

    query = query.order('var_group', { ascending: true })
                 .order('var_order', { ascending: true });

    const { data, error } = await query;
    if (error) { console.error('[PIRO] getProducts:', error.message); return null; }
    return data;
  }

  async function getProduct(id) {
    const { data, error } = await db.from('products').select('*').eq('id', id).single();
    if (error) { console.error('[PIRO] getProduct:', error.message); return null; }
    return data;
  }

  async function getCategories() {
    const { data, error } = await db.from('categories').select('*').eq('is_active', true).order('sort_order');
    if (error) { console.error('[PIRO] getCategories:', error.message); return null; }
    return data;
  }

  /* مسیر عکس محصول — پشتیبانی از نام فایل ساده (images/xxx.jpg) و
     لینک کامل آپلودشده از پنل ادمین (Supabase Storage) */
  function resolveImg(name) {
    if (!name) return '';
    return /^https?:\/\//.test(name) ? name : `images/${name}`;
  }

  /* تبدیل ردیف خام Supabase (snake_case) به شکل PIRO_PRODUCTS (camelCase)
     catMap: { [categoryId]: {name_fa, name_en} } — برای catFa/catEn/catSlug */
  function mapSupabaseProduct(p, catMap = {}) {
    const mainCat = catMap[p.category] || {};
    return {
      id:           p.id,
      varGroup:     p.var_group,
      varOrder:     p.var_order,
      variantLabel: p.variant_label,
      c:            p.category,
      sub:          p.sub,
      fa:           p.name_fa,
      en:           p.name_en,
      price:        p.price,
      img:          p.image,
      img2:         p.image2,
      imgPos:       p.img_pos || undefined,
      catFa:        mainCat.name_fa || '',
      catEn:        mainCat.name_en || '',
      catSlug:      p.category,
      imgs:         (p.imgs && p.imgs.length) ? p.imgs : [p.image].filter(Boolean),
      alts:         p.alts || [],
      techImg:      p.tech_img || null,
      descFa:       p.desc_fa || '',
      descEn:       p.desc_en || '',
      storyFa:      p.story_fa || [],
      storyEn:      p.story_en || [],
      specs:        p.specs || [],
      careFa:       p.care_fa || [],
      careEn:       p.care_en || [],
      companion:    p.companion || null,
      installFa:    p.install_fa || '',
      installEn:    p.install_en || '',
      badge:        p.badge,
    };
  }

  /* import از آرایه JS موجود در shop.html — فقط یک بار اجرا شود */
  async function importProducts(productsArray) {
    const rows = productsArray.map(p => ({
      id:            p.id,
      var_group:     p.varGroup   || null,
      var_order:     p.varOrder   || 0,
      variant_label: p.variantLabel || null,
      category:      p.c,
      sub:           p.sub        || null,
      name_fa:       p.fa,
      name_en:       p.en,
      price:         p.price      || null,
      price_num:     p.price ? parseFloat(
                       p.price.replace(/[,،۰-۹]/g, c =>
                         '۰۱۲۳۴۵۶۷۸۹'.includes(c)
                           ? String.fromCharCode(c.charCodeAt(0) - 0x06F0 + 0x30)
                           : c === ',' ? '' : c
                       )
                     ) : null,
      image:         p.img        || null,
      image2:        p.img2       || null,
      badge:         p.badge      || null,
      is_active:     true,
    }));

    const { error } = await db.from('products').upsert(rows, { onConflict: 'id' });
    if (error) { console.error('[PIRO] importProducts:', error.message); return false; }
    console.log(`[PIRO] ${rows.length} محصول وارد شد ✓`);
    return true;
  }

  /* ────────────────────────────────────────────
     CART
     - مهمان: localStorage  (کلید: piro_cart_items)
     - وارد‌شده: Supabase cart_items table
  ──────────────────────────────────────────── */

  function _localCartGet() {
    try { return JSON.parse(localStorage.getItem('piro_cart_items') || '[]'); }
    catch { return []; }
  }
  function _localCartSet(items) {
    localStorage.setItem('piro_cart_items', JSON.stringify(items));
    localStorage.setItem('piro_cart_count', items.reduce((s, i) => s + i.quantity, 0));
  }

  async function getCart() {
    const user = await getCurrentUser();

    if (!user) {
      // مهمان — از localStorage
      return _localCartGet();
    }

    // کاربر وارد‌شده — از Supabase
    const { data, error } = await db.from('cart_items').select(`
      id, product_id, variant_label, quantity, created_at,
      products ( id, name_fa, name_en, price, price_num, image, category )
    `).eq('user_id', user.id).order('created_at');
    if (error) { console.error('[PIRO] getCart:', error.message); return []; }
    return data;
  }

  async function addToCart(productId, variantLabel = null, qty = 1) {
    const user = await getCurrentUser();

    if (!user) {
      // مهمان — localStorage
      const items = _localCartGet();
      const idx = items.findIndex(i => i.product_id === productId && i.variant_label === variantLabel);
      if (idx >= 0) {
        items[idx].quantity += qty;
      } else {
        items.push({ product_id: productId, variant_label: variantLabel, quantity: qty, id: Date.now() + '' });
      }
      _localCartSet(items);
      await refreshCartCount();
      return true;
    }

    // کاربر وارد‌شده — Supabase
    const { data: existing } = await db.from('cart_items')
      .select('id, quantity')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .eq('variant_label', variantLabel ?? '')
      .maybeSingle();

    if (existing) {
      const { error } = await db.from('cart_items')
        .update({ quantity: existing.quantity + qty, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) { console.error('[PIRO] addToCart update:', error.message); return false; }
    } else {
      const { error } = await db.from('cart_items').insert({
        user_id: user.id, product_id: productId, variant_label: variantLabel, quantity: qty,
      });
      if (error) { console.error('[PIRO] addToCart insert:', error.message); return false; }
    }

    await refreshCartCount();
    return true;
  }

  async function updateCartQty(itemId, qty) {
    if (qty < 1) return removeFromCart(itemId);
    const user = await getCurrentUser();

    if (!user) {
      const items = _localCartGet();
      const idx = items.findIndex(i => i.id == itemId);
      if (idx >= 0) items[idx].quantity = qty;
      _localCartSet(items);
      await refreshCartCount();
      return true;
    }

    const { error } = await db.from('cart_items')
      .update({ quantity: qty, updated_at: new Date().toISOString() })
      .eq('id', itemId);
    if (error) { console.error('[PIRO] updateCartQty:', error.message); return false; }
    await refreshCartCount();
    return true;
  }

  async function removeFromCart(itemId) {
    const user = await getCurrentUser();

    if (!user) {
      _localCartSet(_localCartGet().filter(i => i.id != itemId));
      await refreshCartCount();
      return true;
    }

    const { error } = await db.from('cart_items').delete().eq('id', itemId);
    if (error) { console.error('[PIRO] removeFromCart:', error.message); return false; }
    await refreshCartCount();
    return true;
  }

  async function clearCart() {
    const user = await getCurrentUser();

    if (!user) {
      _localCartSet([]);
      await refreshCartCount();
      return true;
    }

    const { error } = await db.from('cart_items').delete().eq('user_id', user.id);
    if (error) { console.error('[PIRO] clearCart:', error.message); return false; }
    await refreshCartCount();
    return true;
  }

  async function refreshCartCount() {
    const items = await getCart();
    const total = items.reduce((s, i) => s + (i.quantity || 0), 0);
    const badge = document.getElementById('cartCount');
    if (badge) badge.textContent = total;
    localStorage.setItem('piro_cart_count', total);
  }

  /* ────────────────────────────────────────────
     WISHLIST
  ──────────────────────────────────────────── */

  async function toggleWishlist(productId) {
    const user = await getCurrentUser();
    if (!user) {
      document.dispatchEvent(new CustomEvent('piro:need-auth'));
      return false;
    }

    const { data: existing } = await db.from('wishlists')
      .select('id')
      .eq('user_id', user.id)
      .eq('product_id', productId)
      .maybeSingle();

    if (existing) {
      await db.from('wishlists').delete().eq('id', existing.id);
      return false; // removed
    } else {
      await db.from('wishlists').insert({ user_id: user.id, product_id: productId });
      return true;  // added
    }
  }

  async function getWishlist() {
    const user = await getCurrentUser();
    if (!user) return [];
    const { data } = await db.from('wishlists')
      .select('product_id, products ( id, name_fa, name_en, price, image )')
      .eq('user_id', user.id);
    return data || [];
  }

  /* ────────────────────────────────────────────
     NEWSLETTER
  ──────────────────────────────────────────── */

  async function subscribeNewsletter(email) {
    const { error } = await db.from('newsletter_subscribers').insert({ email });
    if (error) {
      if (error.code === '23505') return { ok: false, msg: 'این ایمیل قبلاً ثبت شده است.' };
      console.error('[PIRO] subscribe:', error.message);
      return { ok: false, msg: 'خطایی رخ داد. لطفاً دوباره تلاش کنید.' };
    }
    return { ok: true, msg: 'عضویت شما با موفقیت ثبت شد!' };
  }

  /* ────────────────────────────────────────────
     CONTACT
  ──────────────────────────────────────────── */

  async function sendContactMessage({ name, email, phone, subject, message }) {
    const { error } = await db.from('contact_messages').insert({ name, email, phone, subject, message });
    if (error) { console.error('[PIRO] contact:', error.message); return false; }
    return true;
  }

  // فرم تماس همین را صدا می‌زند — لید مستقیم در CRM پیرو (پنل ادمین) ثبت می‌شود.
  const _isLocalHost = /^(localhost|127\.)/.test(location.hostname);
  const CRM_WEBHOOK_URL = _isLocalHost
    ? 'http://localhost:3000/api/webhooks/site-signup'
    : 'https://piro-admin.vercel.app/api/webhooks/site-signup';

  async function sendCrmLead({ name, phone, email, subject, message }) {
    try {
      const res = await fetch(CRM_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name, phone, email, subject, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, msg: data?.error || 'خطایی رخ داد. لطفاً دوباره تلاش کنید.' };
      return { ok: true };
    } catch (err) {
      console.error('[PIRO] sendCrmLead:', err.message);
      return { ok: false, msg: 'ارتباط برقرار نشد. لطفاً دوباره تلاش کنید.' };
    }
  }

  /* ────────────────────────────────────────────
     AUTH
  ──────────────────────────────────────────── */

  async function signUp(email, password, fullName) {
    const { data, error } = await db.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } }
    });
    if (error) return { ok: false, msg: error.message };
    return { ok: true, user: data.user };
  }

  async function signIn(email, password) {
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, msg: error.message };
    return { ok: true, user: data.user };
  }

  async function signOut() {
    await db.auth.signOut();
  }

  async function resetPassword(email) {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password.html'
    });
    if (error) return { ok: false, msg: error.message };
    return { ok: true };
  }

  /* ────────────────────────────────────────────
     CHATBOT
  ──────────────────────────────────────────── */

  async function getChatSession() {
    const sid = getSessionId();
    const user = await getCurrentUser();

    let query = db.from('chat_sessions').select('*');
    if (user) {
      query = query.eq('user_id', user.id);
    } else {
      query = query.eq('session_id', sid);
    }

    const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data;
  }

  async function saveChatMessage(messages, context = {}) {
    const sid = getSessionId();
    const user = await getCurrentUser();

    const existing = await getChatSession();
    const payload = {
      session_id: sid,
      user_id:    user?.id || null,
      messages,
      context,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await db.from('chat_sessions').update(payload).eq('id', existing.id);
    } else {
      await db.from('chat_sessions').insert(payload);
    }
  }

  /* ────────────────────────────────────────────
     ORDERS
  ──────────────────────────────────────────── */

  async function createOrder(shippingAddress, notes = '') {
    const user = await getCurrentUser();
    if (!user) return { ok: false, msg: 'برای ثبت سفارش باید وارد شوید.' };

    const cartItems = await getCart();
    if (!cartItems.length) return { ok: false, msg: 'سبد خرید خالی است.' };

    const total = cartItems.reduce((s, i) =>
      s + (i.products?.price_num || 0) * i.quantity, 0);

    const { data, error } = await db.from('orders').insert({
      user_id:          user.id,
      total_num:        total,
      items:            cartItems.map(i => ({
        product_id:     i.product_id,
        name_fa:        i.products?.name_fa,
        name_en:        i.products?.name_en,
        price_num:      i.products?.price_num,
        variant_label:  i.variant_label,
        quantity:       i.quantity,
      })),
      shipping_address: shippingAddress,
      notes,
    }).select().single();

    if (error) { console.error('[PIRO] createOrder:', error.message); return { ok: false, msg: error.message }; }

    await clearCart();
    return { ok: true, order: data };
  }

  /* ── Export ── */
  Object.assign(window.PIRO, {
    // Products
    getProducts, getProduct, getCategories, importProducts, mapSupabaseProduct, resolveImg,
    // Cart
    getCart, addToCart, updateCartQty, removeFromCart, clearCart, refreshCartCount,
    // Wishlist
    toggleWishlist, getWishlist,
    // Newsletter
    subscribeNewsletter,
    // Contact
    sendContactMessage, sendCrmLead,
    // Auth
    signUp, signIn, signOut, resetPassword,
    // Chatbot
    getChatSession, saveChatMessage,
    // Orders
    createOrder,
  });

  // بارگذاری اولیه تعداد سبد خرید
  refreshCartCount().catch(() => {});

})();
