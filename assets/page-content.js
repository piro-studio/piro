/* ================================================================
   PIRO — Page Content Loader
   جدول pages را برای صفحه فعلی (از body[data-page-key]) می‌خواند و
   بخش‌های تگ‌دار رو با محتوای مدیریت‌شده در پنل ادمین پر می‌کند.

   نکته: این محتوا فقط برای نسخه فارسی (پیش‌فرض) اعمال می‌شود — چون
   پنل ادمین فعلاً فقط نسخه فارسی این بخش‌ها رو ویرایش می‌کنه. اگر
   کاربر قبلاً زبان انگلیسی رو انتخاب کرده باشه (piro_lang=en)، این
   اسکریپت کاری نمی‌کنه و متن استاتیک/ترجمه‌شده HTML دست‌نخورده می‌ماند.
   ================================================================ */

(function () {
  function isEnActive() {
    return localStorage.getItem('piro_lang') === 'en';
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function setHtml(id, value) {
    if (value == null) return;
    const el = document.getElementById(id);
    if (el) el.innerHTML = value;
  }
  function setText(id, value) {
    if (value == null) return;
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }
  function setList(id, items, html) {
    const el = document.getElementById(id);
    if (!el || !items || !items.length) return;
    el.innerHTML = items.map(html).join('');
  }

  function renderAbout(c) {
    if (c.hero) {
      setHtml('pgHeroTitle', c.hero.titleFa);
      setText('pgHeroEyebrow', c.hero.eyebrow);
      setText('pgHeroTagline', c.hero.tagline);
    }
    if (c.manifesto) {
      setText('pgQuoteEn', c.manifesto.quoteEn);
      setText('pgQuoteFa', c.manifesto.quoteFa);
      setText('pgCitation', c.manifesto.citation);
    }
    if (c.whoWeAre) {
      setText('pgWwaEyebrow', c.whoWeAre.eyebrow);
      setText('pgWwaTitle', c.whoWeAre.title);
      setList('pgWwaParas', c.whoWeAre.paragraphs, (p) => `<p>${esc(p)}</p>`);
    }
    setList('pgPillars', c.pillars, (p) => `
      <div class="pillar reveal">
        <span class="num">${esc(p.numberLabel)}</span>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.body)}</p>
      </div>`);
    if (c.designApproach) {
      setText('pgDaEyebrow', c.designApproach.eyebrow);
      setText('pgDaTitle', c.designApproach.title);
      setList('pgDaParas', c.designApproach.paragraphs, (p) => `<p>${esc(p)}</p>`);
      setText('pgDaCta', c.designApproach.ctaLabel);
    }
    setList('pgStats', c.stats, (s) => `
      <div class="ab-stat">
        <div class="n lat">${esc(s.number)}</div>
        <div class="l">${esc(s.label)}</div>
      </div>`);
  }

  function renderContact(c) {
    if (c.hero) setHtml('pgHeroTitle', c.hero.title);
    if (c.showroom) {
      setText('pgShowroomTitle', c.showroom.title);
      setList('pgShowroomParas', c.showroom.paragraphs, (p) => `<p>${esc(p)}</p>`);
      setText('pgFactoryAddress', c.showroom.factoryAddress);
    }
  }

  function renderInstallments(c) {
    if (c.hero) setHtml('pgHeroTitle', c.hero.title);
    setList('pgCreditStats', c.creditStats, (s) => `
      <div class="credit-stat reveal">
        <span class="num">${esc(s.num)}</span>
        <span class="unit">${esc(s.unit)}</span>
        <span class="label">${esc(s.label)}</span>
      </div>`);
    setList('pgSteps', c.steps, (s, i) => `
      <div class="step">
        <div class="step-num">${i + 1}</div>
        <div class="step-body"><h3>${esc(s.title)}</h3><p>${esc(s.body)}</p></div>
      </div>`);
    setList('pgTerms', c.terms, (t) => `
      <div class="term-item">
        <div><strong>${esc(t.title)}</strong><p>${esc(t.body)}</p></div>
      </div>`);
    setText('pgDocumentsIntro', c.documentsIntro);
    setList('pgDocuments', c.documents, (d) => `
      <div class="doc-card reveal">
        <div><strong>${esc(d.title)}</strong><p>${esc(d.body)}</p></div>
      </div>`);
    if (c.cta) {
      setText('pgCtaTitle', c.cta.title);
      setText('pgCtaBody', c.cta.body);
    }
  }

  function renderGuide(c) {
    if (c.howToBuy) {
      setText('pgHtbIntro', c.howToBuy.intro);
      setList('pgHtbSteps', c.howToBuy.steps, (s, i) => `
        <div class="step">
          <div class="step-num">${i + 1}</div>
          <div class="step-body"><h3>${esc(s.title)}</h3><p>${s.body ?? ''}</p></div>
        </div>`);
    }
    if (c.shipping) {
      setText('pgShipIntro', c.shipping.intro);
      setList('pgShipRegions', c.shipping.regions, (r) => `
        <tr><td>${esc(r.name)}</td><td>${esc(r.cost)}</td><td>${esc(r.time)}</td></tr>`);
    }
    if (c.warranty) {
      setText('pgWarrantyIntro', c.warranty.intro);
      setList('pgWarrantyItems', c.warranty.items, (w) => `
        <div class="warranty-item">
          <div><h3>${esc(w.title)}</h3><p>${esc(w.body)}</p></div>
        </div>`);
    }
  }

  const RENDERERS = {
    about: renderAbout,
    contact: renderContact,
    installments: renderInstallments,
    guide: renderGuide,
  };

  async function loadPageContent() {
    const pageKey = document.body && document.body.dataset.pageKey;
    if (!pageKey || !RENDERERS[pageKey]) return;
    if (isEnActive()) return; // فعلاً فقط نسخه فارسی مدیریت می‌شود
    if (!window.PIRO || !window.PIRO.db) return;
    try {
      const { data, error } = await window.PIRO.db.from('pages').select('content').eq('key', pageKey).single();
      if (error || !data || !data.content) return;
      RENDERERS[pageKey](data.content);
    } catch (e) {
      console.error('[PIRO] page-content load failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPageContent);
  } else {
    loadPageContent();
  }
})();
