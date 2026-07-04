/* ===== PIRO — Supabase backend integration =====
   برای فعال‌سازی:
   1) در supabase.com یک پروژه رایگان بسازید.
   2) مقادیر زیر را از Project Settings → API کپی کنید.
   3) جداول را طبق SUPABASE_SETUP.md بسازید.
   اگر این مقادیر خالی بمانند، سایت به‌صورت خودکار به حالت دموی محلی (localStorage) برمی‌گردد.
*/

const SUPABASE_URL  = "";   // مثال: https://xxxx.supabase.co
const SUPABASE_ANON = "";   // کلید anon public

const PiroDB = {
  client: null,
  enabled: false,

  init() {
    if (SUPABASE_URL && SUPABASE_ANON && window.supabase) {
      this.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      this.enabled = true;
    }
    return this.enabled;
  },

  // Supabase Auth uses email; we synthesize a stable email from the mobile number.
  _email(mobile) { return `u${mobile}@piro.app`; },

  async register({ firstName, lastName, nationalId, mobile, password }) {
    const { data, error } = await this.client.auth.signUp({
      email: this._email(mobile),
      password,
      options: { data: { firstName, lastName, mobile } }
    });
    if (error) return { ok: false, msg: error.message };

    // store profile (national id) in a protected table guarded by RLS
    const uid = data.user && data.user.id;
    if (uid) {
      const { error: pErr } = await this.client.from('profiles').insert({
        id: uid, first_name: firstName, last_name: lastName,
        national_id: nationalId, mobile
      });
      if (pErr) return { ok: false, msg: pErr.message };
    }
    return { ok: true, user: { firstName, lastName, nationalId, mobile } };
  },

  async login(identifier, password) {
    // identifier may be mobile or national id; resolve mobile if national id given
    let mobile = identifier;
    if (/^\d{10}$/.test(identifier)) {
      const { data } = await this.client.from('profiles').select('mobile').eq('national_id', identifier).maybeSingle();
      if (data) mobile = data.mobile;
    }
    const { error } = await this.client.auth.signInWithPassword({
      email: this._email(mobile), password
    });
    if (error) return { ok: false, msg: 'اطلاعات ورود نادرست است.' };
    return { ok: true };
  },

  async logout() { await this.client.auth.signOut(); },

  async current() {
    const { data: { user } } = await this.client.auth.getUser();
    if (!user) return null;
    const { data: prof } = await this.client.from('profiles').select('*').eq('id', user.id).maybeSingle();
    return prof ? {
      firstName: prof.first_name, lastName: prof.last_name,
      nationalId: prof.national_id, mobile: prof.mobile,
      createdAt: user.created_at, orders: [], wishlist: [], addresses: []
    } : null;
  }
};
