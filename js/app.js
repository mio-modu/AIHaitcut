/* =========================================================
   app.js — 한 화면 3단 스튜디오
   [원본/촬영]  →  [헤어 라인 메뉴]  →  [AI 예상 이미지]
   좌: 손님 원본(촬영 진입) · 중: 스타일 실루엣 메뉴 · 우: 생성 결과
   개인정보 동의(촬영 직전 모달) / 예상이미지 확인(결과 하단) = 필수 게이트.
   ========================================================= */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const screens = $('#screens');

  let S;
  function resetSession(keepConsent) {
    stopCamera();
    S = {
      consentDone: keepConsent && S ? S.consentDone : false,
      consent: keepConsent && S ? S.consent : { retain: false, retainDays: 7, isMinor: false },
      faceImage: null,
      selectedCardIds: [],
      generating: false,
      results: [],
      shown: 0,
      understood: false,
      stream: null,
      genElapsed: 0,
      genTimer: null,
    };
  }
  function refreshCredit() { $('#creditCount').textContent = LumainData.getCredit(); }

  // ================= 스튜디오 (3단) =================
  function renderStudio() {
    stopCamera();
    const el = div('studio');
    el.innerHTML = `
      <section class="col col-original">
        <div class="col-head"><span class="t">Customer · 손님 원본</span><span class="c" id="origTag">대기 중</span></div>
        <div class="col-body" id="origBody"></div>
      </section>

      <section class="col col-menu">
        <div class="col-head"><span class="t">Style Menu · 헤어 라인</span><span class="c" id="menuCount">선택 없음</span></div>
        <div class="col-body scroll"><div class="menu-grid" id="menuGrid"></div></div>
        <div class="col-foot">
          <div class="fcount"><div class="n" id="footN">0개 선택</div><div class="s">최대 4개 · 실패 시 미차감</div></div>
          <button class="primary-btn gen-cta" id="genCta" disabled>미리보기 생성</button>
        </div>
      </section>

      <section class="col col-result">
        <div class="col-head"><span class="t">AI Preview · 예상 이미지</span><span class="c" id="resTag"></span></div>
        <div class="col-body" id="resBody"></div>
      </section>`;
    screens.innerHTML = '';
    screens.appendChild(el);

    // 메뉴 그리드
    const grid = $('#menuGrid');
    const cards = LumainData.listCards({ gender: 'male' });   // 지금은 남성 위주
    if (!cards.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="ico">✂</div>
        스타일 카드가 없습니다.<br>상단 "스타일 관리"에서 등록하세요.</div>`;
    } else {
      cards.forEach(c => {
        const card = styleCardEl(c);
        if (S.selectedCardIds.includes(c.id)) card.classList.add('selected');
        card.onclick = () => toggleSelect(c.id, card);
        grid.appendChild(card);
      });
    }
    $('#genCta').onclick = onGenerate;

    updateOriginal();
    updateResult();
    updateMenuFoot();
  }

  // ---- 왼쪽: 원본 / 촬영 ----
  function updateOriginal() {
    const body = $('#origBody'); if (!body) return;
    $('#origTag').textContent = S.faceImage ? '촬영 완료' : '대기 중';
    if (!S.faceImage) {
      body.innerHTML = `
        <div class="stage-box">
          <span class="corner-tag">Lookbook · 기본 화면</span>
          <div class="stage-idle">
            <div class="kline"></div>
            <h2>손님 사진을<br>촬영해주세요</h2>
            <p>시술 전, 내 얼굴로 미리 봅니다</p>
            <div class="btns">
              <button class="primary-btn" id="btnShoot">사진 촬영</button>
              <button class="ghost-btn" id="btnGallery">갤러리 선택</button>
            </div>
          </div>
        </div>`;
      $('#btnShoot').onclick = () => requireConsent(startCamera);
      $('#btnGallery').onclick = () => requireConsent(pickFile);
    } else {
      body.innerHTML = `
        <div class="stage-box">
          <span class="corner-tag">Customer Photo · 원본</span>
          <img class="stage-img" src="${S.faceImage}" alt="손님 원본">
        </div>
        <div class="stage-extra">
          <div class="stage-actions">
            <button class="ghost-btn" id="btnRetake">다시 촬영</button>
            <button class="ghost-btn" id="btnRegallery">다른 사진</button>
          </div>
        </div>`;
      $('#btnRetake').onclick = () => requireConsent(startCamera);
      $('#btnRegallery').onclick = () => requireConsent(pickFile);
    }
  }

  async function startCamera() {
    const body = $('#origBody');
    body.innerHTML = `
      <div class="stage-box">
        <span class="corner-tag">Camera · 정면 촬영</span>
        <video id="video" autoplay playsinline style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"></video>
        <div class="cam-guide"><div class="oval"></div></div>
      </div>
      <div class="stage-extra">
        <div class="stage-actions">
          <button class="primary-btn" id="btnCapture">● 촬영</button>
          <button class="ghost-btn" id="btnCancelCam">취소</button>
        </div>
      </div>`;
    $('#btnCancelCam').onclick = () => { stopCamera(); updateOriginal(); };
    try {
      S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 960 }, audio: false });
      const v = $('#video'); v.srcObject = S.stream;
      $('#btnCapture').onclick = () => {
        const cv = document.createElement('canvas');
        cv.width = v.videoWidth; cv.height = v.videoHeight;
        const ctx = cv.getContext('2d'); ctx.translate(cv.width, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0);
        S.faceImage = cv.toDataURL('image/jpeg', 0.92);
        stopCamera(); updateOriginal(); updateMenuFoot();
      };
    } catch (err) {
      toast('카메라를 열 수 없습니다. 갤러리에서 선택하세요. (' + err.name + ')');
      updateOriginal();
    }
  }

  function pickFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      if (!inp.files[0]) return;
      stopCamera();
      S.faceImage = await fileToDataUrl(inp.files[0], 1280);
      updateOriginal(); updateMenuFoot();
    };
    inp.click();
  }

  // ---- 가운데: 스타일 선택 ----
  function toggleSelect(id, cardEl) {
    const i = S.selectedCardIds.indexOf(id);
    if (i >= 0) { S.selectedCardIds.splice(i, 1); cardEl.classList.remove('selected'); }
    else {
      if (S.selectedCardIds.length >= 4) return toast('최대 4개까지 선택할 수 있습니다.');
      S.selectedCardIds.push(id); cardEl.classList.add('selected');
    }
    updateMenuFoot();
  }
  function updateMenuFoot() {
    const n = S.selectedCardIds.length;
    const mc = $('#menuCount'); if (mc) mc.textContent = n ? `${n}개 선택` : '선택 없음';
    const fn = $('#footN'); if (fn) fn.textContent = `${n}개 선택`;
    const cta = $('#genCta'); if (!cta) return;
    cta.disabled = !(n >= 1 && S.faceImage && !S.generating);
    cta.textContent = !S.faceImage ? '사진을 먼저 촬영' : (S.generating ? '생성 중…' : '미리보기 생성');
  }

  // ---- 오른쪽: AI 결과 ----
  function updateResult() {
    const body = $('#resBody'); if (!body) return;
    const tag = $('#resTag');

    if (S.generating) {
      if (tag) tag.textContent = '생성 중';
      const cards = S.selectedCardIds.map(id => LumainData.getCard(id)).filter(Boolean);
      body.innerHTML = `
        <div class="stage-box">
          <span class="corner-tag">Generating · 생성 중</span>
          <div class="stage-gen">
            <div class="elapsed" id="elapsed">0<span>s</span></div>
            <h2>${LumainGen.usingGemini() ? '얼굴을 보존하며 헤어만 바꾸는 중' : '데모 미리보기를 합성하는 중'}</h2>
            <div class="genbar"></div>
            <div class="lines">${cards.map((c, i) => `<div class="gl" id="gl_${i}">· ${escapeHtml(c.name)}</div>`).join('')}</div>
            <div class="note">스타일당 시간이 걸릴 수 있습니다. 잠시만 기다려주세요.</div>
          </div>
        </div>`;
      return;
    }

    if (!S.results.length) {
      if (tag) tag.textContent = '';
      body.innerHTML = `
        <div class="stage-box">
          <span class="corner-tag">Preview · 대기</span>
          <div class="result-empty">
            <div class="ic">✧</div>
            <p>가운데에서 스타일을 고르고<br><b style="color:var(--text)">미리보기 생성</b>을 누르면<br>결과가 여기에 표시됩니다.</p>
          </div>
        </div>`;
      return;
    }

    // 결과 표시
    const r = S.results[S.shown] || S.results.find(x => x.dataUrl) || S.results[0];
    const card = r ? LumainData.getCard(r.cardId) : null;
    if (tag) tag.textContent = card ? card.name : '';
    body.innerHTML = `
      <div class="stage-box">
        <span class="corner-tag">Preview · AI 예상 이미지</span>
        ${r && r.error
          ? `<div class="result-empty"><div class="ic" style="color:var(--danger)">✕</div>
             <p style="color:var(--danger)">생성 실패<br><span class="muted">${escapeHtml(r.error).slice(0,90)}</span><br>크레딧은 차감되지 않았습니다.</p></div>`
          : `<img class="stage-img" src="${r.dataUrl}" alt="예상 이미지">`}
      </div>
      <div class="stage-extra">
        ${S.results.length > 1 ? `<div class="result-strip">${S.results.map((x, i) => x.error
            ? `<div class="rs err ${i===S.shown?'on':''}" data-i="${i}">✕</div>`
            : `<div class="rs ${i===S.shown?'on':''}" data-i="${i}"><img src="${x.dataUrl}"></div>`).join('')}</div>` : ''}
        <div class="confirm-inline ${S.understood?'checked':''}" id="cUnderstand">
          <div class="box">✓</div>
          <div class="ct"><b>예상 이미지</b>이며 시술 조건에 따라 <b>실제 결과는 다를 수 있음</b>을 이해했습니다.</div>
        </div>
        <div class="stage-actions">
          <button class="ghost-btn" id="btnRestart">처음부터</button>
          <button class="primary-btn" id="btnConfirm" ${S.understood?'':'disabled'}>이 스타일로 확정</button>
        </div>
      </div>`;

    $$('.result-strip .rs').forEach(rs => rs.onclick = () => { S.shown = +rs.dataset.i; updateResult(); });
    const ci = $('#cUnderstand');
    ci.onclick = () => { S.understood = ci.classList.toggle('checked'); const b = $('#btnConfirm'); if (b) b.disabled = !S.understood; };
    $('#btnRestart').onclick = () => { resetSession(true); renderStudio(); };
    $('#btnConfirm').onclick = onConfirm;
  }

  // ================= 생성 =================
  async function onGenerate() {
    if (!S.faceImage) return toast('손님 사진을 먼저 촬영하세요.');
    if (S.selectedCardIds.length < 1) return toast('스타일을 하나 이상 고르세요.');
    if (LumainData.getCredit() < S.selectedCardIds.length)
      return toast('크레딧이 부족합니다. (필요: ' + S.selectedCardIds.length + ')');

    const cards = S.selectedCardIds.map(id => LumainData.getCard(id)).filter(Boolean);
    S.results = []; S.shown = 0; S.understood = false; S.generating = true;
    updateResult(); updateMenuFoot();

    S.genElapsed = 0;
    S.genTimer = setInterval(() => { S.genElapsed++; const e = $('#elapsed'); if (e) e.innerHTML = `${S.genElapsed}<span>s</span>`; }, 1000);

    for (let i = 0; i < cards.length; i++) {
      const line = $('#gl_' + i); if (line) { line.className = 'gl on'; line.textContent = `▸ ${cards[i].name} — 생성 중…`; }
      try {
        const r = await LumainGen.generatePreview({ faceImage: S.faceImage, styleCard: cards[i], onProgress: () => {} });
        S.results.push({ cardId: cards[i].id, ...r });
        LumainData.chargeCredit(1);
        if (line) { line.className = 'gl ok'; line.textContent = `✓ ${cards[i].name}${r.source.startsWith('demo') ? ' (데모)' : ''}`; }
      } catch (err) {
        S.results.push({ cardId: cards[i].id, dataUrl: null, source: 'error', error: err.message });
        if (line) { line.className = 'gl'; line.style.color = 'var(--danger)'; line.textContent = `✕ ${cards[i].name} — 실패`; }
      }
    }
    clearInterval(S.genTimer); S.genTimer = null;
    S.generating = false;
    refreshCredit();
    const firstOk = S.results.findIndex(r => r.dataUrl);
    S.shown = firstOk >= 0 ? firstOk : 0;
    updateResult(); updateMenuFoot();
  }

  function onConfirm() {
    if (!S.understood) return;
    const r = S.results[S.shown];
    const card = r ? LumainData.getCard(r.cardId) : null;
    const retain = S.consent.retain;
    if (!retain) { S.faceImage = null; }
    openDone(card, retain);
  }

  // ================= 모달들 =================
  function requireConsent(next) {
    if (S.consentDone) return next();
    openConsent(() => { S.consentDone = true; next(); });
  }

  function openConsent(onAgree) {
    const bd = div('modal-backdrop');
    bd.innerHTML = `
      <div class="modal">
        <div class="eyebrow">필수 동의</div>
        <h2>얼굴 사진 수집·이용 동의</h2>
        <div class="sub">얼굴 사진(민감정보)을 다룹니다. 동의 없이는 촬영할 수 없습니다.</div>
        <table class="consent-table">
          <tr><td>수집 항목</td><td>손님의 얼굴 정면 사진</td></tr>
          <tr><td>이용 목적</td><td>헤어스타일 미리보기(예상 이미지) 생성</td></tr>
          <tr><td>제3자 처리</td><td>AI 생성 API(Google Gemini) 경유. <b>학습에는 사용하지 않습니다.</b></td></tr>
          <tr><td>보관 기간</td><td><b>생성 직후 자동 파기(기본값).</b> 아래 동의 시에만 N일 보관 후 자동 삭제.</td></tr>
          <tr><td>미동의 시</td><td>서비스 이용이 불가합니다.</td></tr>
        </table>
        <div class="check-row" id="cMain"><div class="box">✓</div>
          <div class="ctext">위 내용에 동의하고 얼굴 사진의 수집·이용 및 AI API 처리에 동의합니다.<span class="req">필수</span></div></div>
        <div class="check-row" id="cRetain"><div class="box">✓</div>
          <div class="ctext">(선택) 상담·기록을 위해 결과를
            <select id="retainDays" style="width:auto;display:inline-block;padding:3px 7px;margin:0 3px">
              <option value="7">7일</option><option value="30">30일</option><option value="90">90일</option></select>
            보관에 동의합니다.</div></div>
        <div class="minor-toggle">
          <div class="check-row" id="cMinor"><div class="box">✓</div>
            <div class="ctext">손님이 <b>만 14세 미만</b>입니다.</div></div>
          <div id="guardianWrap" hidden>
            <div class="check-row" id="cGuardian"><div class="box">✓</div>
              <div class="ctext">법정대리인(보호자)이 동석하여 동의합니다.<span class="req">필수</span></div></div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="ghost-btn" id="cCancel">취소</button>
          <button class="primary-btn" id="cAgree" disabled>동의하고 촬영</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const st = { main: false, retain: false, minor: false, guardian: false };
    const agree = $('#cAgree', bd);
    const refresh = () => {
      agree.disabled = !(st.main && (!st.minor || st.guardian));
      S.consent.retain = st.retain;
      S.consent.retainDays = parseInt($('#retainDays', bd).value, 10);
      S.consent.isMinor = st.minor;
    };
    bindCheck($('#cMain', bd), v => { st.main = v; refresh(); });
    bindCheck($('#cRetain', bd), v => { st.retain = v; refresh(); });
    bindCheck($('#cMinor', bd), v => { st.minor = v; $('#guardianWrap', bd).hidden = !v; if (!v) { st.guardian = false; $('#cGuardian', bd).classList.remove('checked'); } refresh(); });
    bindCheck($('#cGuardian', bd), v => { st.guardian = v; refresh(); });
    $('#retainDays', bd).onchange = refresh;
    $('#cCancel', bd).onclick = () => bd.remove();
    bd.onclick = e => { if (e.target === bd) bd.remove(); };
    agree.onclick = () => { bd.remove(); onAgree(); };
  }

  function openDone(card, retain) {
    const bd = div('modal-backdrop');
    bd.innerHTML = `
      <div class="modal" style="text-align:center">
        <div class="done-icon" style="margin-top:6px">✓</div>
        <h2 style="font-size:26px">시술을 시작하세요</h2>
        <p style="color:var(--text-dim);margin:10px 0 0;font-weight:300;line-height:1.6">
          손님이 <b style="color:var(--accent-2)">${escapeHtml(card?.name || '선택한 스타일')}</b> 방향을 선택했습니다.<br>예상 이미지임을 확인하셨습니다.</p>
        <div class="purge-note" style="text-align:left">${retain
          ? `🗄 <b style="color:var(--accent-2)">${S.consent.retainDays}일 보관</b>에 동의하여 결과가 저장됩니다. 기간 후 자동 삭제됩니다. (원본 얼굴 사진은 보관하지 않음)`
          : `🔥 보관 미동의 — 원본과 결과 이미지를 <b>방금 자동 파기</b>했습니다.`}</div>
        <div class="modal-actions" style="justify-content:center">
          <button class="primary-btn big-btn" id="dNext">다음 손님</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    // 다음 손님 = 새 사람 → 동의 처음부터 다시
    $('#dNext', bd).onclick = () => { bd.remove(); resetSession(false); renderStudio(); };
    bd.onclick = e => { if (e.target === bd) { bd.remove(); resetSession(false); renderStudio(); } };
  }

  function openStyleManager() {
    const bd = div('modal-backdrop');
    bd.innerHTML = `
      <div class="modal" style="width:min(880px,100%)">
        <div class="row-between" style="margin-bottom:18px">
          <div><div class="eyebrow">Portfolio</div><h2>스타일 카드 관리</h2></div>
          <button class="primary-btn" id="smAdd">＋ 새 카드</button>
        </div>
        <div class="menu-grid" id="smGrid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))"></div>
        <div class="modal-actions"><button class="ghost-btn" id="smClose">닫기</button></div>
      </div>`;
    document.body.appendChild(bd);
    const paint = () => {
      const grid = $('#smGrid', bd); grid.innerHTML = '';
      const cards = LumainData.listCards();
      if (!cards.length) grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="ico">✂</div>등록된 카드가 없습니다.</div>`;
      cards.forEach(c => {
        const el = styleCardEl(c);
        const builtin = LumainData.isBuiltin(c.id);
        if (builtin) el.classList.add('is-builtin');
        el.onclick = () => (builtin ? openBuiltinCardModal : openCardModal)(c, paint);
        grid.appendChild(el);
      });
    };
    paint();
    $('#smAdd', bd).onclick = () => openCardModal(null, paint);
    $('#smClose', bd).onclick = () => { bd.remove(); renderStudio(); };
    bd.onclick = e => { if (e.target === bd) { bd.remove(); renderStudio(); } };
  }

  // 내장 카탈로그 카드 = 읽기 전용. 열면 상세만 보여주고,
  // 고치고 싶으면 "복제해서 편집"으로 커스텀 사본을 만들게 한다.
  // (예전엔 그냥 저장하면 정면/측면·프롬프트가 빠진 반쪽 사본이 몰래 하나 더 생겼다)
  function openBuiltinCardModal(card, after) {
    const bd = div('modal-backdrop');
    const p = card.prompt_params || {};
    const t = card.tags || {};
    bd.innerHTML = `
      <div class="modal" style="width:min(640px,100%)">
        <div class="eyebrow">Built-in · 기본 카탈로그</div>
        <h2>${escapeHtml(card.name)}</h2>
        <div class="sub">${escapeHtml(card.name_en || '')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px">
          ${[[card.front_image, '정면'], [card.side_image, '측면']].filter(x => x[0]).map(([src, lb]) => `
            <div><div class="thumb-upload" style="cursor:default"><img src="${src}" alt="${escapeAttr(card.name + ' ' + lb)}"></div>
            <div style="text-align:center;margin-top:6px;font-size:11px;color:var(--text-faint);letter-spacing:.1em">${lb}</div></div>`).join('')}
        </div>
        <div class="field" style="margin-top:16px"><label>태그</label>
          <div class="tags" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            ${[t.length, t.perm, t.difficulty].filter(Boolean).map(x => `<span class="tag">${escapeHtml(x)}</span>`).join('')}
          </div></div>
        ${p.cut || p.top || p.finish ? `<div class="field" style="margin-top:14px"><label>AI 지시문</label>
          <div class="purge-note" style="margin-top:8px;line-height:1.7">
            ${[p.cut && `<b>Cut</b> ${escapeHtml(p.cut)}`, p.top && `<b>Top</b> ${escapeHtml(p.top)}`,
               p.finish && `<b>Finish</b> ${escapeHtml(p.finish)}`].filter(Boolean).join('<br>')}
          </div></div>` : ''}
        <div class="purge-note" style="margin-top:16px">기본 카탈로그 카드는 <b>수정·삭제할 수 없습니다.</b>
          내용을 바꾸려면 사본을 만들어 편집하세요.</div>
        <div class="modal-actions">
          <div style="flex:1"></div>
          <button class="ghost-btn" id="bClose">닫기</button>
          <button class="primary-btn" id="bDup">복제해서 편집</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    $('#bClose', bd).onclick = () => bd.remove();
    bd.onclick = e => { if (e.target === bd) bd.remove(); };
    $('#bDup', bd).onclick = () => {
      bd.remove();
      // 정면·측면·영문명·프롬프트까지 통째로 들고 간다 (id 만 새로 발급).
      // 편집기는 name_ko 를 우선으로 읽으므로 둘 다 갱신해야 "사본"이 붙는다.
      const base = card.name_ko || card.name;
      openCardModal({ ...card, id: null, name_ko: base + ' 사본', name: base + ' 사본' }, after);
    };
  }

  function openCardModal(card, after) {
    const isEdit = !!(card && card.id);
    const src = card || {};
    const data = {
      name: src.name_ko || src.name || '',
      name_en: src.name_en || '',
      desc: (src.desc && src.desc !== src.name_en) ? src.desc : '',
      gender: src.gender || 'male',
      front_image: src.front_image || src.image || '',
      side_image: src.side_image || '',
      tags: { ...(src.tags || {}) },
      prompt_params: src.prompt_params ? { ...src.prompt_params } : undefined,
    };
    const bd = div('modal-backdrop');
    const shot = (key, label) => `
      <div><div class="thumb-upload" id="up_${key}" data-key="${key}">${
        data[key] ? `<img src="${data[key]}">` : `＋<br>${label}`}</div>
        <div style="text-align:center;margin-top:6px;font-size:11px;color:var(--text-faint);letter-spacing:.1em">${label}</div></div>`;

    bd.innerHTML = `
      <div class="modal" style="width:min(720px,100%)">
        <h2>${isEdit ? '스타일 카드 수정' : '새 스타일 카드'}</h2>
        <div class="sub">정면·측면 2장을 올리면 AI가 옆·뒤 길이까지 참고합니다. (없으면 헤어 라인으로 표시)</div>
        <div style="display:grid;grid-template-columns:120px 120px 1fr;gap:16px;margin-top:16px">
          ${shot('front_image', '정면')}
          ${shot('side_image', '측면')}
          <div>
            <div class="field"><label>스타일명</label><input id="fName" value="${escapeAttr(data.name)}" placeholder="예: 쉐도우펌"></div>
            <div class="field" style="margin-top:12px"><label>영문명 (선택)</label><input id="fNameEn" value="${escapeAttr(data.name_en)}" placeholder="예: Shadow Perm"></div>
            <div class="field" style="margin-top:12px"><label>성별</label>
              <select id="fGender">
                <option value="male"${data.gender === 'male' ? ' selected' : ''}>남성</option>
                <option value="female"${data.gender === 'female' ? ' selected' : ''}>여성</option>
              </select></div>
          </div>
        </div>
        <div class="field" style="margin-top:14px"><label>설명 / AI 지시 포인트 (선택)</label>
          <textarea id="fDesc" rows="2" placeholder="예: 옆은 타이트하게, 앞머리는 눈썹 살짝 덮게">${escapeHtml(data.desc)}</textarea></div>
        <div id="tagGroups" style="margin-top:18px"></div>
        <div class="modal-actions">
          ${isEdit ? '<button class="danger-btn" id="delCard">삭제</button>' : ''}
          <div style="flex:1"></div>
          <button class="ghost-btn" id="cancelCard">취소</button>
          <button class="primary-btn" id="saveCard">저장</button>
        </div>
      </div>`;
    document.body.appendChild(bd);

    const tg = $('#tagGroups', bd);
    Object.entries(LumainData.TAG_OPTIONS).forEach(([key, opts]) => {
      const label = { length: '길이', perm: '펌/질감', difficulty: '난이도' }[key] || key;
      const wrap = div('field'); wrap.innerHTML = `<label>${label}</label><div class="tag-picker" data-key="${key}"></div>`;
      const picker = $('.tag-picker', wrap);
      opts.forEach(o => {
        const b = document.createElement('button');
        b.className = 'tag-opt' + (data.tags[key] === o ? ' on' : ''); b.textContent = o;
        b.onclick = () => { data.tags[key] = (data.tags[key] === o) ? '' : o; $$('.tag-opt', picker).forEach(x => x.classList.toggle('on', x.textContent === data.tags[key])); };
        picker.appendChild(b);
      });
      tg.appendChild(wrap);
    });

    $$('.thumb-upload', bd).forEach(box => {
      box.onclick = () => {
        const key = box.dataset.key;
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = async () => {
          if (!inp.files[0]) return;
          data[key] = await fileToDataUrl(inp.files[0], 800);
          box.innerHTML = `<img src="${data[key]}">`;
        };
        inp.click();
      };
    });

    $('#cancelCard', bd).onclick = () => bd.remove();
    bd.onclick = e => { if (e.target === bd) bd.remove(); };
    if (isEdit) $('#delCard', bd).onclick = () => {
      if (!confirm('이 카드를 삭제할까요?')) return;
      if (LumainData.deleteCard(card.id)) { bd.remove(); after && after(); }
      else toast('기본 카탈로그 카드는 삭제할 수 없습니다.');
    };
    $('#saveCard', bd).onclick = () => {
      const name = $('#fName', bd).value.trim();
      if (!name) return toast('스타일명을 입력하세요.');
      try {
        LumainData.upsertCard({
          id: card?.id || null,
          name_ko: name,
          name_en: $('#fNameEn', bd).value.trim(),
          gender: $('#fGender', bd).value,
          desc: $('#fDesc', bd).value.trim(),
          front_image: data.front_image,
          side_image: data.side_image,
          tags: data.tags,
          prompt_params: data.prompt_params,
        });
      } catch (e) {
        // 사진 2장이 base64 로 들어가므로 브라우저 저장 한도를 넘길 수 있다.
        return toast(/quota|exceed/i.test(e.name + e.message)
          ? '저장 공간이 가득 찼습니다. 기존 카드를 정리하거나 사진 용량을 줄여주세요.'
          : '저장에 실패했습니다: ' + e.message);
      }
      bd.remove(); after && after();
    };
  }

  function openHistory() {
    const bd = div('modal-backdrop');
    bd.innerHTML = `
      <div class="modal">
        <div class="eyebrow">History</div>
        <h2>생성 이력</h2>
        <div class="sub">보관에 동의한 결과만 기록됩니다.</div>
        <div class="purge-note">이력 저장은 <b>2단계(백엔드)</b>에서 매장 계정별로 동작합니다. 현재는 보관 동의 시 브라우저에만 임시 저장됩니다.</div>
        <div class="modal-actions"><button class="ghost-btn" id="hClose">닫기</button></div>
      </div>`;
    document.body.appendChild(bd);
    $('#hClose', bd).onclick = () => bd.remove();
    bd.onclick = e => { if (e.target === bd) bd.remove(); };
  }

  // 이미지 편집 모델 프리셋 (2026-07 기준 이미지 1장 단가)
  const MODEL_PRESETS = [
    { id: 'gemini-3.1-flash-lite-image', label: '나노바나나 2 라이트 · $0.0336 — 가장 저렴·빠름 (권장)' },
    { id: 'gemini-3.1-flash-image', label: '나노바나나 2 · $0.067 — 품질 우선' },
    { id: 'gemini-2.5-flash-image', label: '2.5 플래시 이미지 · $0.039 — 구버전' },
  ];

  function openSettings() {
    const s = LumainGen.getSettings();
    const bd = div('modal-backdrop');
    bd.innerHTML = `
      <div class="modal">
        <div class="eyebrow">AI Engine</div>
        <h2>AI 엔진 설정</h2>
        <div class="sub">Gemini 키를 입력하면 실제 생성이 켜집니다. 없으면 데모로 동작합니다.</div>
        <div class="field"><label>생성 모드</label>
          <select id="setMode">
            <option value="auto"${s.mode==='auto'?' selected':''}>자동 (키 있으면 Gemini, 없으면 데모)</option>
            <option value="gemini"${s.mode==='gemini'?' selected':''}>항상 Gemini</option>
            <option value="demo"${s.mode==='demo'?' selected':''}>항상 데모</option>
          </select></div>
        <div class="field" style="margin-top:14px"><label>Gemini API 키</label>
          <input id="setKey" type="password" value="${escapeAttr(s.geminiKey)}" placeholder="AIza..."></div>
        <div class="field" style="margin-top:14px"><label>모델</label>
          <select id="setModelPick">
            ${MODEL_PRESETS.map(m => `<option value="${m.id}"${s.model === m.id ? ' selected' : ''}>${m.label}</option>`).join('')}
            <option value="__custom"${MODEL_PRESETS.some(m => m.id === s.model) ? '' : ' selected'}>직접 입력</option>
          </select>
          <input id="setModel" style="margin-top:8px" value="${escapeAttr(s.model)}" placeholder="gemini-3.1-flash-lite-image">
          <div class="purge-note" style="margin-top:8px">단가는 이미지 1장 기준입니다. 라이트가 가장 싸고 빠르지만,
            얼굴 보존이 흔들리면 <b>나노바나나 2</b>로 올려보세요.</div></div>
        <div class="field" style="margin-top:14px"><label>결과 배경 (누끼)</label>
          <select id="setBg">
            <option value="studio"${s.background==='studio'?' selected':''}>스튜디오 라이트 그레이 — 배경 정리 (권장)</option>
            <option value="white"${s.background==='white'?' selected':''}>순백 누끼 — 완전 흰 배경</option>
            <option value="keep"${s.background==='keep'?' selected':''}>원본 배경 유지</option>
          </select>
          <div class="purge-note" style="margin-top:8px">매장 내부가 그대로 찍히는 걸 막고 머리 모양에 시선이 가게 합니다.
            순백은 밝은 모발 끝이 배경에 묻힐 수 있어, 잔머리 경계는 <b>스튜디오 그레이</b>가 더 잘 살아납니다.</div></div>
        <div class="field" style="margin-top:14px"><label>견본 모델 얼굴 가리기</label>
          <select id="setMask">
            <option value="on"${s.maskRefFace !== false ? ' selected' : ''}>가리고 전송 (권장)</option>
            <option value="off"${s.maskRefFace === false ? ' selected' : ''}>원본 그대로 전송</option>
          </select>
          <div class="purge-note" style="margin-top:8px;color:var(--danger);border-color:rgba(255,90,110,.3)">
            ⚠ 끄면 <b style="color:var(--danger)">결과에 견본 모델 얼굴이 나올 수 있습니다.</b>
            직접 올린 카드에서 머리가 가려지는 경우에만 끄세요.</div></div>
        <div class="field" style="margin-top:14px"><label>피부 보정</label>
          <select id="setSkin">
            <option value="light"${s.skinCleanup !== 'none' ? ' selected' : ''}>가볍게 정리 — 톤·유분·잡티 (권장)</option>
            <option value="none"${s.skinCleanup === 'none' ? ' selected' : ''}>원본 그대로</option>
          </select></div>
        <div class="field" style="margin-top:14px"><label>자세 교정</label>
          <select id="setPose">
            <option value="fix"${s.posture !== 'keep' ? ' selected' : ''}>정면·바른 자세로 교정 (권장)</option>
            <option value="keep"${s.posture === 'keep' ? ' selected' : ''}>원본 자세 유지</option>
          </select>
          <div class="purge-note" style="margin-top:8px">보정은 <b>얼굴 동일성보다 우선하지 않도록</b> 지시됩니다.
            그래도 인물이 달라 보이면 두 항목을 "원본"으로 두세요.</div></div>
        <div class="purge-note" style="margin-top:16px;color:var(--danger);border-color:rgba(255,90,110,.3)">
          ⚠ <b style="color:var(--danger)">보안:</b> 지금은 단일 웹앱이라 키가 이 브라우저에 저장됩니다.
          원장님 <b style="color:var(--danger)">본인 태블릿 1대</b>에서만 쓰세요. 손님/직원에게 여는 단계엔 백엔드(2단계)로 옮겨야 합니다.</div>
        <div class="modal-actions">
          <button class="ghost-btn" id="setCancel">취소</button>
          <button class="primary-btn" id="setSave">저장</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    $('#setCancel', bd).onclick = () => bd.remove();
    bd.onclick = e => { if (e.target === bd) bd.remove(); };
    // 프리셋을 고르면 입력칸을 채워준다. "직접 입력"이면 입력칸만 쓴다.
    const pick = $('#setModelPick', bd), modelInput = $('#setModel', bd);
    const syncModelInput = () => {
      const custom = pick.value === '__custom';
      modelInput.style.display = custom ? '' : 'none';
      if (!custom) modelInput.value = pick.value;
    };
    pick.onchange = syncModelInput;
    syncModelInput();
    $('#setSave', bd).onclick = () => {
      LumainGen.saveSettings({
        mode: $('#setMode', bd).value, geminiKey: $('#setKey', bd).value.trim(),
        model: modelInput.value.trim() || LumainGen.DEFAULTS.model, faceGuard: true,
        background: $('#setBg', bd).value,
        maskRefFace: $('#setMask', bd).value === 'on',
        skinCleanup: $('#setSkin', bd).value,
        posture: $('#setPose', bd).value,
      });
      bd.remove(); toast('설정을 저장했습니다.'); renderStudio();
    };
  }

  // ================= 헤어 라인 실루엣 =================
  function hairSilhouette(tags) {
    const len = (tags && tags.length) || '미디엄';
    const perm = (tags && tags.perm) || '';
    const curl = /C컬|S컬|히피|웨이브|허쉬|빌드|롤|펌/.test(perm);
    const Ly = { '숏': 84, '단발': 104, '미디엄': 124, '롱': 143 }[len] || 120;
    function side(x, dir) {
      if (curl) {
        let d = `M ${x},62 `; let y = 62; const steps = Math.max(2, Math.round((Ly - 62) / 15));
        for (let i = 0; i < steps; i++) { y += 15; d += `q ${7 * dir},4 0,15 `; }
        return d;
      }
      return `M ${x},62 C ${x + 3 * dir},${(62 + Ly) / 2} ${x + 2 * dir},${Ly - 8} ${x + 4 * dir},${Ly} `;
    }
    const shoulders = Ly > 122 ? '' : `<path d="M32,126 Q60,111 88,126"/>`;
    return `<div class="sil-wrap"><svg class="sil" viewBox="0 0 120 152" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" preserveAspectRatio="xMidYMid meet">
      <path d="M 30,66 C 24,20 96,20 90,66"/>
      <path d="${side(30, -1)}"/>
      <path d="${side(90, 1)}"/>
      <ellipse cx="60" cy="70" rx="20" ry="26"/>
      <path d="M52,93 L52,103 M68,93 L68,103"/>
      ${shoulders}
    </svg></div>`;
  }

  function styleCardEl(c) {
    const el = div('style-card'); el.dataset.id = c.id;
    const t = c.tags || {};
    const tagHtml = [
      t.length && `<span class="tag">${t.length}</span>`,
      t.perm && `<span class="tag">${t.perm}</span>`,
      t.difficulty && `<span class="tag diff">${t.difficulty}</span>`,
    ].filter(Boolean).join('');

    // 정면(기본) + 측면. 전환은 썸네일 위 버튼으로 — 태블릿엔 호버가 없고,
    // 선택 상태와 뷰 상태는 서로 독립이어야 한다(고른 뒤에도 정면을 볼 수 있게).
    const front = c.front_image || c.image || '';
    const side = c.side_image || '';
    const img = (cls, src, lb) =>
      `<img class="${cls}" src="${src}" alt="${escapeAttr(c.name)} ${lb}" loading="lazy" decoding="async">`;
    const thumb = front
      ? img('front', front, '정면') +
        (side ? img('side', side, '측면') + '<button type="button" class="view-toggle">측면 보기</button>' : '')
      : hairSilhouette(t);

    el.innerHTML = `
      <div class="thumb">${thumb}<div class="select-badge">✓</div></div>
      <div class="meta">
        <div class="name">${escapeHtml(c.name)}</div>
        ${c.name_en ? `<div class="name-en">${escapeHtml(c.name_en)}</div>` : ''}
        <div class="tags">${tagHtml}</div>
      </div>`;

    const vt = $('.view-toggle', el);
    if (vt) vt.onclick = e => {
      e.stopPropagation();                       // 뷰 전환이 선택을 건드리지 않게
      const on = el.classList.toggle('show-side');
      vt.textContent = on ? '정면 보기' : '측면 보기';
    };
    return el;
  }

  // ================= 헬퍼 =================
  function bindCheck(row, cb) {
    if (!row) return;
    row.onclick = e => { if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return; cb(row.classList.toggle('checked')); };
  }
  function stopCamera() { if (S && S.stream) { S.stream.getTracks().forEach(t => t.stop()); S.stream = null; } }
  function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
  function escapeHtml(s = '') { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function escapeAttr(s = '') { return escapeHtml(s).replace(/'/g, '&#39;'); }
  function fileToDataUrl(file, maxW) {
    return new Promise((res) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxW / img.width);
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          res(cv.toDataURL('image/jpeg', 0.9));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  let toastTimer;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast';
      t.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#171B21;border:1px solid rgba(255,255,255,.16);color:#EEF1F5;padding:13px 22px;z-index:200;box-shadow:0 12px 30px rgba(0,0,0,.6);font-size:14px;font-weight:600;letter-spacing:-.01em;transition:opacity .3s';
      document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.opacity = '0', 2600);
  }

  // ================= 초기화 =================
  function init() {
    resetSession(false);
    refreshCredit();
    $('#brandHome').onclick = () => { resetSession(false); renderStudio(); };
    $('#navStyles').onclick = openStyleManager;
    $('#navHistory').onclick = openHistory;
    $('#navSettings').onclick = openSettings;
    renderStudio();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
