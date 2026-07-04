-- ================================================================
-- PIRO Furniture — Supabase Schema
-- اجرا کنید در: Supabase Dashboard → SQL Editor → New Query
-- ================================================================

-- ───────────────────────────────────────────
-- 1. PRODUCTS
-- ───────────────────────────────────────────
create table if not exists public.products (
  id           text primary key,
  var_group    text,
  var_order    int  default 0,
  variant_label text,
  category     text not null,          -- living | bedroom | tables | console
  sub          text,                   -- sofa | lounge | chair | ...
  name_fa      text not null,
  name_en      text not null,
  price        text,                   -- قیمت فارسی  e.g. ۷۸,۰۰۰,۰۰۰
  price_num    numeric,                -- قیمت عددی برای مرتب‌سازی
  image        text,                   -- نام فایل  e.g. tehran1.jpg
  image2       text,
  badge        text,                   -- جدید | پرفروش | تخفیف
  is_featured  boolean default false,
  is_active    boolean default true,
  created_at   timestamptz default now()
);

-- ───────────────────────────────────────────
-- 2. NEWSLETTER SUBSCRIBERS
-- ───────────────────────────────────────────
create table if not exists public.newsletter_subscribers (
  id           uuid primary key default gen_random_uuid(),
  email        text unique not null,
  created_at   timestamptz default now()
);

-- ───────────────────────────────────────────
-- 3. CONTACT MESSAGES
-- ───────────────────────────────────────────
create table if not exists public.contact_messages (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  phone        text,
  subject      text,
  message      text not null,
  is_read      boolean default false,
  created_at   timestamptz default now()
);

-- ───────────────────────────────────────────
-- 4. CART ITEMS  (session or user based)
-- ───────────────────────────────────────────
create table if not exists public.cart_items (
  id            uuid primary key default gen_random_uuid(),
  session_id    text,
  user_id       uuid references auth.users(id) on delete cascade,
  product_id    text references public.products(id) on delete cascade,
  variant_label text,
  quantity      int not null default 1,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ───────────────────────────────────────────
-- 5. WISHLISTS
-- ───────────────────────────────────────────
create table if not exists public.wishlists (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  product_id    text references public.products(id) on delete cascade,
  created_at    timestamptz default now(),
  unique(user_id, product_id)
);

-- ───────────────────────────────────────────
-- 6. ORDERS
-- ───────────────────────────────────────────
create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id),
  status           text default 'pending',  -- pending | confirmed | shipped | delivered
  total_num        numeric not null,
  items            jsonb not null,           -- snapshot of cart at order time
  shipping_address jsonb,
  notes            text,
  created_at       timestamptz default now()
);

-- ───────────────────────────────────────────
-- 7. CHATBOT SESSIONS
-- ───────────────────────────────────────────
create table if not exists public.chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  session_id  text not null,
  user_id     uuid references auth.users(id),
  messages    jsonb default '[]',
  context     jsonb default '{}',           -- product context, last viewed etc.
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ───────────────────────────────────────────
-- 8. ROW LEVEL SECURITY
-- ───────────────────────────────────────────

-- Products: همه می‌توانند بخوانند، فقط admin می‌تواند ویرایش کند
alter table public.products           enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.contact_messages   enable row level security;
alter table public.cart_items         enable row level security;
alter table public.wishlists          enable row level security;
alter table public.orders             enable row level security;
alter table public.chat_sessions      enable row level security;

-- Products: public read
create policy "products_public_read"
  on public.products for select using (is_active = true);

-- Newsletter: anyone can subscribe
create policy "newsletter_public_insert"
  on public.newsletter_subscribers for insert with check (true);

-- Contact: anyone can send
create policy "contact_public_insert"
  on public.contact_messages for insert with check (true);

-- Cart: فقط کاربر وارد‌شده (مهمان از localStorage استفاده می‌کند)
create policy "cart_user_read"
  on public.cart_items for select
  using (user_id = auth.uid());

create policy "cart_user_insert"
  on public.cart_items for insert
  with check (user_id = auth.uid());

create policy "cart_user_update"
  on public.cart_items for update
  using (user_id = auth.uid());

create policy "cart_user_delete"
  on public.cart_items for delete
  using (user_id = auth.uid());

-- Wishlist: authenticated users only
create policy "wishlist_user_all"
  on public.wishlists for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Orders: users see their own orders
create policy "orders_user_read"
  on public.orders for select using (user_id = auth.uid());

create policy "orders_user_insert"
  on public.orders for insert with check (user_id = auth.uid());

-- Chat sessions: هر session_id (بدون تأیید هویت) یا کاربر لاگین‌شده
create policy "chat_session_all"
  on public.chat_sessions for all
  using (true)
  with check (true);

-- ───────────────────────────────────────────
-- 9. HELPER FUNCTION: merge session cart → user cart on login
-- ───────────────────────────────────────────
create or replace function public.merge_cart(p_session_id text, p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  -- Upsert: if same product exists for user, add quantity
  insert into public.cart_items (session_id, user_id, product_id, variant_label, quantity)
  select null, p_user_id, product_id, variant_label, quantity
  from public.cart_items
  where session_id = p_session_id
  on conflict do nothing;

  -- Delete the session cart
  delete from public.cart_items where session_id = p_session_id;
end;
$$;

-- ───────────────────────────────────────────
-- 10. نکته: برای import محصولات موجود
-- فایل assets/db.js → تابع importProducts() را اجرا کنید
-- یا از SQL Editor این فایل را import کنید:
-- ───────────────────────────────────────────

-- ───────────────────────────────────────────
-- 11. CHATBOT LEADS  (پنل ادمین → admin/index.html)
-- هر گفتگو یک ردیف conversations دارد که با session_id
-- (همان piro_sid سمت کاربر) پیدا/ساخته می‌شود؛ پیام‌ها در messages ذخیره می‌شوند.
-- نوشتن این دو جدول فقط از سمت سرور (functions/api/chat.js با SERVICE_ROLE) انجام می‌شود.
-- ───────────────────────────────────────────
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  session_id      text unique not null,
  visitor_name    text,
  visitor_phone   text,
  status          text default 'open',   -- open | lead | contacted | converted | closed
  note            text,
  last_message_at timestamptz default now(),
  created_at      timestamptz default now()
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  role            text not null,        -- user | assistant
  content         text not null,
  created_at      timestamptz default now()
);

-- admin_users: فقط یک لیست عضویت — هیچ سطر عمومی insert نمی‌شود
create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade
);

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.admin_users   enable row level security;

-- فقط کاربرانی که در admin_users هستند می‌توانند گفتگوها/پیام‌ها را بخوانند یا وضعیت را عوض کنند
create policy "admin_read_conversations" on public.conversations for select
  using ( exists (select 1 from public.admin_users a where a.id = auth.uid()) );
create policy "admin_update_conversations" on public.conversations for update
  using ( exists (select 1 from public.admin_users a where a.id = auth.uid()) );
create policy "admin_read_messages" on public.messages for select
  using ( exists (select 1 from public.admin_users a where a.id = auth.uid()) );

-- هر کاربر فقط می‌تواند چک کند خودش ادمین هست یا نه
create policy "admin_read_self" on public.admin_users for select
  using ( auth.uid() = id );

-- ───────────────────────────────────────────
-- 12. برای افزودن یک ادمین جدید:
-- ۱) در Authentication → Users یک کاربر با ایمیل/رمز بسازید
-- ۲) در SQL Editor اجرا کنید (uuid را از همان صفحه کپی کنید):
--    insert into public.admin_users (id) values ('<user-uuid>');
-- ───────────────────────────────────────────
