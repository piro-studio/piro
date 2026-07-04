/* ===== PIRO Admin Dashboard ===== */
(function () {
  'use strict';

  let sb = null;          // Supabase client
  let currentFilter = 'all';
  let currentConvId = null;
  let allConversations = [];
  let realtimeSub = null;

  // ── Helpers ──
  function statusLabel(s) {
    return { open: 'باز', lead: 'لید', contacted: 'تماس‌شده', converted: 'تبدیل‌شده', closed: 'بسته' }[s] || s;
  }

  function statusClass(s) {
    return 'st-' + (s || 'open');
  }

  function relTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'همین الان';
    if (m < 60) return m + ' دقیقه پیش';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ساعت پیش';
    return Math.floor(h / 24) + ' روز پیش';
  }

  function toLocalTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  }

  // ── Auth ──
  async function doLogin() {
    const email = document.getElementById('adminEmail').value.trim();
    const pass = document.getElementById('adminPass').value;
    const err = document.getElementById('loginErr');
    const btn = document.getElementById('loginBtn');

    if (!email || !pass) { err.textContent = 'ایمیل و رمز عبور الزامی است.'; return; }

    btn.disabled = true;
    btn.textContent = '...';
    err.textContent = '';

    const { error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      err.textContent = 'ایمیل یا رمز عبور اشتباه است.';
      btn.disabled = false;
      btn.textContent = 'ورود به پنل';
      return;
    }
    await checkAdminAndLoad();
  }

  async function checkAdminAndLoad() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    // Check admin_users table
    const { data } = await sb.from('admin_users').select('id').eq('id', user.id).maybeSingle();
    if (!data) {
      await sb.auth.signOut();
      document.getElementById('loginErr').textContent = 'شما دسترسی ادمین ندارید.';
      return;
    }

    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').classList.add('ready');
    loadDashboard();
  }

  async function doLogout() {
    await sb.auth.signOut();
    location.reload();
  }

  // ── Dashboard ──
  async function loadDashboard() {
    await Promise.all([loadStats(), loadConversations()]);
    subscribeRealtime();
  }

  async function loadStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      { count: total },
      { count: todayCount },
      { count: leads },
      { count: converted }
    ] = await Promise.all([
      sb.from('conversations').select('*', { count: 'exact', head: true }),
      sb.from('conversations').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString()),
      sb.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'lead'),
      sb.from('conversations').select('*', { count: 'exact', head: true }).eq('status', 'converted'),
    ]);

    document.getElementById('statTotal').textContent = total ?? 0;
    document.getElementById('statToday').textContent = todayCount ?? 0;
    document.getElementById('statLeads').textContent = leads ?? 0;
    document.getElementById('statConverted').textContent = converted ?? 0;
  }

  async function loadConversations() {
    const { data, error } = await sb
      .from('conversations')
      .select('*')
      .order('last_message_at', { ascending: false })
      .limit(200);

    if (error) { console.error(error); return; }
    allConversations = data || [];
    renderList();
  }

  function renderList() {
    const list = document.getElementById('convList');
    const filtered = currentFilter === 'all'
      ? allConversations
      : allConversations.filter(c => c.status === currentFilter);

    if (!filtered.length) {
      list.innerHTML = '<div class="no-convs">گفتگویی یافت نشد</div>';
      return;
    }

    list.innerHTML = filtered.map(c => `
      <div class="conv-item${c.id === currentConvId ? ' active' : ''}" data-id="${c.id}" onclick="selectConv('${c.id}')">
        <div class="conv-name">${c.visitor_name || 'بازدیدکننده ناشناس'}</div>
        ${c.visitor_phone ? `<div class="conv-phone">${c.visitor_phone}</div>` : ''}
        <div class="conv-meta">
          <span class="conv-time">${relTime(c.last_message_at)}</span>
          <span class="conv-status ${statusClass(c.status)}">${statusLabel(c.status)}</span>
        </div>
      </div>
    `).join('');
  }

  // ── Select conversation ──
  async function selectConv(id) {
    currentConvId = id;
    renderList(); // update active state

    const conv = allConversations.find(c => c.id === id);
    if (!conv) return;

    // Show detail
    document.getElementById('detailEmpty').style.display = 'none';
    const dc = document.getElementById('detailContent');
    dc.style.display = 'flex';
    dc.style.flexDirection = 'column';

    document.getElementById('detailName').textContent = conv.visitor_name || 'بازدیدکننده ناشناس';
    document.getElementById('detailPhone').textContent = conv.visitor_phone || '';
    document.getElementById('statusSelect').value = conv.status || 'open';
    document.getElementById('noteInput').value = conv.note || '';

    // Load messages
    const { data: msgs } = await sb
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    const box = document.getElementById('detailMessages');
    box.innerHTML = (msgs || []).map(m => `
      <div class="msg-bubble ${m.role}">
        ${escapeHtml(m.content)}
        <div class="msg-time">${toLocalTime(m.created_at)}</div>
      </div>
    `).join('');
    box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(str) {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  async function updateStatus() {
    if (!currentConvId) return;
    const status = document.getElementById('statusSelect').value;
    await sb.from('conversations').update({ status }).eq('id', currentConvId);
    const idx = allConversations.findIndex(c => c.id === currentConvId);
    if (idx !== -1) allConversations[idx].status = status;
    renderList();
    loadStats();
  }

  async function saveNote() {
    if (!currentConvId) return;
    const note = document.getElementById('noteInput').value.trim();
    await sb.from('conversations').update({ note }).eq('id', currentConvId);
    const idx = allConversations.findIndex(c => c.id === currentConvId);
    if (idx !== -1) allConversations[idx].note = note;
  }

  // ── Filters ──
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    renderList();
  });

  // ── Realtime ──
  function subscribeRealtime() {
    realtimeSub = sb
      .channel('admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        loadConversations();
        loadStats();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        if (payload.new.conversation_id === currentConvId) {
          const m = payload.new;
          const box = document.getElementById('detailMessages');
          const div = document.createElement('div');
          div.className = 'msg-bubble ' + m.role;
          div.innerHTML = escapeHtml(m.content) + `<div class="msg-time">${toLocalTime(m.created_at)}</div>`;
          box.appendChild(div);
          box.scrollTop = box.scrollHeight;
        }
      })
      .subscribe((status) => {
        document.getElementById('rtBadge').style.background =
          status === 'SUBSCRIBED' ? '#27ae60' : '#e74c3c';
      });
  }

  // ── Enter key for login ──
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') {
      doLogin();
    }
  });

  // ── Expose to window (for onclick handlers in HTML) ──
  window.doLogin = doLogin;
  window.doLogout = doLogout;
  window.selectConv = selectConv;
  window.updateStatus = updateStatus;
  window.saveNote = saveNote;

  // ── Init ──
  function init() {
    if (typeof SUPABASE_URL === 'undefined' || !SUPABASE_URL || !SUPABASE_ANON) {
      document.getElementById('loginErr').textContent = 'SUPABASE_URL یا SUPABASE_ANON تنظیم نشده.';
      return;
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

    // Check existing session
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session) checkAdminAndLoad();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
