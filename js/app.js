/* =========================================================
   app.js — 화면 전환 + 응대 플로우 + 설정
   ========================================================= */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const screens = $('#screens');
  const discBar = $('#disclaimer-bar');

  // 응대 세션 (한 손님 1회)
  let session = null;
  function newSession() {
    session = {
      consent: { collected: false, retain: false, retainDays: 7, isMinor: false, guardianOk: false },
      faceImage: null,      // dataURL
      selectedCardIds: [],
      results: [],          // { cardId, dataUrl, source, error }
      pickedIndex: null,
      understoodEstimate: false,
      stream: null,
    };
  }

  // ---------- 라우터 ----------
  const routes = {
    home: renderHome,
    styles: renderStyles,
    consent: renderConsent,
    capture: renderCapture,
    select: renderSelect,
    generating: renderGenerating,
    results: renderResults,
    done: renderDone,
  };
  function go(route) {
    stopCamera();
    discBar.hidden = !['generating', 'results'].includes(route);
    screens.innerHTML = '';
    (routes[route] || renderHome)();
    screens.scrollTop = 0;
  }

  function refreshCredit() { $('#creditCount').textContent = LumainData.getCredit(); }

  // ================= 홈 =================
  function renderHome() {
    const cards = LumainData.listCards();
    const el = div('screen');
    el.innerHTML = `
      <div class="home-grid">
        <div class="hero-card">
          <div>
            <div class="eyebrow">매장 응대 도구</div>
            <h2>손님 얼굴에 <span>이 미용실이 실제로 해낸 스타일</span>을<br/>미리 얹어 봅니다.</h2>
            <p>정면 사진 한 장이면 됩니다. 촬영 → 동의 → 스타일 선택 → 예상 이미지 확인.
               "이렇게 됩니다"가 아니라 <b>"이런 방향이에요"</b>를 함께 보는 도구입니다.</p>
          </div>
          <div class="hero-actions">
            <button class="primary-btn big-btn" id="startGreet">＋ 손님 응대 시작</button>
            <button class="ghost-btn big-btn" id="goStyles">스타일 카드 관리</button>
          </div>
        </div>
        <div class="stat-col">
          <div class="stat-card"><div class="num">${cards.length}</div>
            <div class="lbl">등록된 스타일 카드<small>원장님 시술컷이 곧 상품이 됩니다</small></div></div>
          <div class="stat-card"><div class="num">${LumainData.getCredit()}</div>
            <div class="lbl">남은 생성 크레딧<small>생성 실패 시 미차감</small></div></div>
          <div class="stat-card"><div class="num">${LumainGen.usingGemini() ? 'ON' : 'DEMO'}</div>
            <div class="lbl">AI 엔진 상태<small>${LumainGen.usingGemini() ? 'Gemini 실연동 중' : '데모 모드 · 설정에서 키 입력'}</small></div></div>
        </div>
      </div>

      <div class="row-between" style="margin-top:26px">
        <div>
          <div class="eyebrow">최근 등록 스타일</div>
        </div>
        <button class="ghost-btn" id="goStyles2">전체 보기 →</button>
      </div>
      <div class="card-grid" id="homeCards" style="margin-top:14px"></div>
    `;
    screens.appendChild(el);
    const grid = $('#homeCards');
    cards.slice(0, 6).forEach(c => grid.appendChild(styleCardEl(c, false)));
    $('#startGreet').onclick = beginGreeting;
    $('#goStyles').onclick = () => go('styles');
    $('#goStyles2').onclick = () => go('styles');
  }

  function beginGreeting() {
    if (LumainData.listCards().length === 0) {
      toast('먼저 스타일 카드를 1개 이상 등록해 주세요.');
      go('styles'); return;
    }
    newSession();
    go('consent');
  }

  // ================= 스타일 카드 관리 =================
  function renderStyles() {
    const el = div('screen');
    el.innerHTML = `
      <div class="screen-head row-between">
        <div>
          <div class="eyebrow">스타일 카드</div>
          <h1>포트폴리오 스타일 카드</h1>
          <p>원장님이 실제 시술한 결과를 등록하면, 손님 얼굴로 미리보기가 만들어집니다. (매장별 격리 저장)</p>
        </div>
        <button class="primary-btn" id="addCardBtn">＋ 새 스타일 카드</button>
      </div>
      <div class="card-grid" id="styleGrid"></div>
    `;
    screens.appendChild(el);
    const grid = $('#styleGrid');
    const cards = LumainData.listCards();
    if (cards.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="ico">✂️</div>
        아직 스타일 카드가 없습니다.<br/>오른쪽 위 "새 스타일 카드"로 시작하세요.</div>`;
    } else {
      cards.forEach(c => {
        const card = styleCardEl(c, false);
        card.onclick = () => openCardModal(c);
        grid.appendChild(card);
      });
    }
    $('#addCardBtn').onclick = () => openCardModal(null);
  }

  function styleCardEl(c, selectable) {
    const el = div('style-card');
    el.dataset.id = c.id;
    const tags = c.tags || {};
    const tagHtml = [
      tags.length && `<span class="tag">${tags.length}</span>`,
      tags.color && `<span class="tag">${tags.color}</span>`,
      tags.perm && `<span class="tag">${tags.perm}</span>`,
      tags.difficulty && `<span class="tag diff">${tags.difficulty}</span>`,
    ].filter(Boolean).join('');
    el.innerHTML = `
      <div class="thumb">
        ${c.image ? `<img src="${c.image}" alt="">` : `<div class="ph">✂️</div>`}
        <div class="select-badge">✓</div>
      </div>
      <div class="meta">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="tags">${tagHtml}</div>
      </div>`;
    return el;
  }

  // 카드 등록/수정 모달
  function openCardModal(card) {
    const isEdit = !!card;
    const data = card ? JSON.parse(JSON.stringify(card)) : { name: '', desc: '', image: '', tags: {} };
    const backdrop = div('modal-backdrop');
    backdrop.innerHTML = `
      <div class="modal">
        <h2>${isEdit ? '스타일 카드 수정' : '새 스타일 카드'}</h2>
        <div class="sub">실제 시술 결과 사진을 올리면 미리보기 품질이 좋아집니다.</div>
        <div style="display:grid;grid-template-columns:150px 1fr;gap:20px">
          <div>
            <div class="thumb-upload" id="thumbUp">${data.image ? `<img src="${data.image}">` : '＋<br>시술컷'}</div>
            <input type="file" id="thumbFile" accept="image/*" hidden>
          </div>
          <div>
            <div class="field"><label>스타일명</label>
              <input id="fName" value="${escapeAttr(data.name)}" placeholder="예: 레이어드 단발 · 애쉬브라운"></div>
            <div class="field" style="margin-top:12px"><label>설명 (선택)</label>
              <textarea id="fDesc" rows="2" placeholder="시술 포인트">${escapeHtml(data.desc || '')}</textarea></div>
          </div>
        </div>
        <div id="tagGroups" style="margin-top:18px"></div>
        <div class="modal-actions">
          ${isEdit ? '<button class="danger-btn" id="delCard">삭제</button>' : ''}
          <div class="spacer" style="flex:1"></div>
          <button class="ghost-btn" id="cancelCard">취소</button>
          <button class="primary-btn" id="saveCard">저장</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    // 태그 그룹
    const tg = $('#tagGroups', backdrop);
    Object.entries(LumainData.TAG_OPTIONS).forEach(([key, opts]) => {
      const label = { length: '길이', color: '컬러', perm: '펌/질감', difficulty: '난이도' }[key];
      const wrap = div('field');
      wrap.innerHTML = `<label>${label}</label><div class="tag-picker" data-key="${key}"></div>`;
      const picker = $('.tag-picker', wrap);
      opts.forEach(o => {
        const b = document.createElement('button');
        b.className = 'tag-opt' + (data.tags[key] === o ? ' on' : '');
        b.textContent = o;
        b.onclick = () => {
          data.tags[key] = (data.tags[key] === o) ? '' : o;
          $$('.tag-opt', picker).forEach(x => x.classList.toggle('on', x.textContent === data.tags[key]));
        };
        picker.appendChild(b);
      });
      tg.appendChild(wrap);
    });

    const thumbUp = $('#thumbUp', backdrop), thumbFile = $('#thumbFile', backdrop);
    thumbUp.onclick = () => thumbFile.click();
    thumbFile.onchange = async () => {
      if (!thumbFile.files[0]) return;
      data.image = await fileToDataUrl(thumbFile.files[0], 800);
      thumbUp.innerHTML = `<img src="${data.image}">`;
    };
    $('#cancelCard', backdrop).onclick = () => backdrop.remove();
    backdrop.onclick = e => { if (e.target === backdrop) backdrop.remove(); };
    if (isEdit) $('#delCard', backdrop).onclick = () => {
      if (confirm('이 스타일 카드를 삭제할까요?')) { LumainData.deleteCard(card.id); backdrop.remove(); go('styles'); }
    };
    $('#saveCard', backdrop).onclick = () => {
      const name = $('#fName', backdrop).value.trim();
      if (!name) { toast('스타일명을 입력해 주세요.'); return; }
      LumainData.upsertCard({ id: card?.id, name, desc: $('#fDesc', backdrop).value.trim(), image: data.image, tags: data.tags });
      backdrop.remove(); go('styles');
    };
  }

  // ================= 1. 개인정보 동의 =================
  function renderConsent() {
    const el = div('screen');
    el.innerHTML = `
      ${stepper('consent')}
      <div class="consent-wrap">
        <div class="screen-head">
          <div class="eyebrow">1단계 · 개인정보 동의 (필수)</div>
          <h1>얼굴 사진 수집·이용 동의</h1>
          <p>이 서비스는 얼굴 사진(민감정보)을 다룹니다. 동의 없이는 진행할 수 없습니다.</p>
        </div>
        <div class="consent-box">
          <table class="consent-table">
            <tr><td>수집 항목</td><td>손님의 얼굴 정면 사진</td></tr>
            <tr><td>이용 목적</td><td>헤어스타일 미리보기(예상 이미지) 생성</td></tr>
            <tr><td>제3자 처리</td><td>AI 생성 API(Google Gemini) 경유하여 이미지가 처리됩니다. <b>학습에는 사용하지 않습니다.</b></td></tr>
            <tr><td>보관 기간</td><td><b>생성 직후 자동 파기(기본값).</b> 아래에서 동의한 경우에만 정해진 기간 보관 후 자동 삭제.</td></tr>
            <tr><td>전송 보안</td><td>전송 구간 암호화(HTTPS). 매장 계정과 손님 데이터는 분리 저장.</td></tr>
            <tr><td>미동의 시</td><td>서비스 이용이 불가합니다.</td></tr>
          </table>

          <div class="check-row" id="cMain">
            <div class="box">✓</div>
            <div class="ctext">위 내용을 확인하였으며, 얼굴 사진의 수집·이용 및 AI API 처리에 동의합니다.<span class="req">필수</span></div>
          </div>

          <div class="check-row" id="cRetain">
            <div class="box">✓</div>
            <div class="ctext">(선택) 시술 상담·기록을 위해 생성 결과를
              <select id="retainDays" style="width:auto;display:inline-block;padding:4px 8px;margin:0 4px">
                <option value="7">7일</option><option value="30">30일</option><option value="90">90일</option>
              </select>
              보관하는 데 동의합니다. 기간 후 자동 삭제됩니다.</div>
          </div>

          <div class="minor-toggle">
            <div class="check-row" id="cMinor">
              <div class="box">✓</div>
              <div class="ctext">손님이 <b>만 14세 미만 미성년자</b>입니다.</div>
            </div>
            <div id="guardianWrap" hidden>
              <div class="check-row" id="cGuardian">
                <div class="box">✓</div>
                <div class="ctext">법정대리인(보호자)이 동석하여 위 수집·이용에 동의합니다.<span class="req">필수</span></div>
              </div>
            </div>
          </div>
        </div>
        <div class="action-bar">
          <button class="link-btn" id="cancelGreet">← 응대 취소</button>
          <div class="spacer"></div>
          <button class="primary-btn big-btn" id="toCapture" disabled>동의하고 촬영 →</button>
        </div>
      </div>`;
    screens.appendChild(el);

    const state = { main: false, retain: false, minor: false, guardian: false };
    const toCapture = $('#toCapture');
    function refresh() {
      const ok = state.main && (!state.minor || state.guardian);
      toCapture.disabled = !ok;
      session.consent.collected = state.main;
      session.consent.retain = state.retain;
      session.consent.retainDays = parseInt($('#retainDays').value, 10);
      session.consent.isMinor = state.minor;
      session.consent.guardianOk = state.guardian;
    }
    bindCheck($('#cMain'), v => { state.main = v; refresh(); });
    bindCheck($('#cRetain'), v => { state.retain = v; refresh(); });
    bindCheck($('#cMinor'), v => { state.minor = v; $('#guardianWrap').hidden = !v; if (!v) { state.guardian = false; $('#cGuardian')?.classList.remove('checked'); } refresh(); });
    bindCheck($('#cGuardian'), v => { state.guardian = v; refresh(); });
    $('#retainDays').onchange = refresh;
    $('#cancelGreet').onclick = () => { if (confirm('응대를 취소할까요?')) go('home'); };
    toCapture.onclick = () => go('capture');
  }

  function bindCheck(row, cb) {
    if (!row) return;
    row.onclick = e => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'OPTION') return;
      const on = row.classList.toggle('checked');
      cb(on);
    };
  }

  // ================= 2. 촬영 =================
  function renderCapture() {
    const el = div('screen');
    el.innerHTML = `
      ${stepper('capture')}
      <div class="screen-head">
        <div class="eyebrow">2단계 · 촬영</div>
        <h1>손님 정면 사진 촬영</h1>
        <p>얼굴이 타원 안에 들어오도록, 정면·밝은 곳에서 촬영하세요.</p>
      </div>
      <div class="capture-grid">
        <div>
          <div class="cam-stage" id="camStage">
            <div class="cam-empty" id="camEmpty">
              <div class="ico">📷</div>
              카메라를 시작하거나 사진을 업로드하세요.
              <div class="muted" style="margin-top:8px">※ 카메라는 https 또는 localhost에서만 켜집니다.<br>파일 업로드는 어디서나 가능합니다.</div>
            </div>
            <video id="video" autoplay playsinline hidden></video>
            <img id="shot" hidden>
            <div class="cam-guide" id="camGuide" hidden><div class="oval"></div></div>
          </div>
          <div class="action-bar">
            <button class="ghost-btn" id="startCam">📷 카메라 시작</button>
            <button class="primary-btn" id="takeShot" hidden>● 촬영</button>
            <button class="ghost-btn" id="retake" hidden>다시 촬영</button>
            <label class="ghost-btn" for="uploadFace" style="cursor:pointer">🖼 사진 업로드</label>
            <input type="file" id="uploadFace" accept="image/*" hidden>
          </div>
        </div>
        <div class="capture-side">
          <div class="hint-box">
            <h3>좋은 결과를 위한 촬영 팁</h3>
            <ul>
              <li>정면을 바라보고 어깨까지 나오게</li>
              <li>앞머리로 이마·얼굴을 가리지 않기</li>
              <li>밝고 그림자 적은 곳</li>
              <li>모자·큰 액세서리 제거</li>
            </ul>
          </div>
          <div class="file-drop">사진이 흐리면 미리보기 품질이 떨어집니다.</div>
          <div class="action-bar" style="margin-top:6px">
            <button class="link-btn" id="backConsent">← 이전</button>
            <div class="spacer"></div>
            <button class="primary-btn big-btn" id="toSelect" disabled>스타일 선택 →</button>
          </div>
        </div>
      </div>`;
    screens.appendChild(el);

    const video = $('#video'), shot = $('#shot'), camEmpty = $('#camEmpty'), camGuide = $('#camGuide');
    const startCam = $('#startCam'), takeShot = $('#takeShot'), retake = $('#retake'), toSelect = $('#toSelect');

    if (session.faceImage) { // 뒤로 갔다 돌아온 경우
      shot.src = session.faceImage; shot.hidden = false; camEmpty.hidden = true;
      retake.hidden = false; toSelect.disabled = false;
    }

    startCam.onclick = async () => {
      try {
        session.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 960 }, audio: false });
        video.srcObject = session.stream;
        video.hidden = false; camEmpty.hidden = true; camGuide.hidden = false;
        startCam.hidden = true; takeShot.hidden = false; shot.hidden = true;
      } catch (err) {
        toast('카메라를 열 수 없습니다. 파일 업로드를 이용하세요. (' + err.name + ')');
      }
    };
    takeShot.onclick = () => {
      const cv = document.createElement('canvas');
      cv.width = video.videoWidth; cv.height = video.videoHeight;
      const ctx = cv.getContext('2d');
      ctx.translate(cv.width, 0); ctx.scale(-1, 1); // 미러 보정
      ctx.drawImage(video, 0, 0);
      session.faceImage = cv.toDataURL('image/jpeg', 0.92);
      shot.src = session.faceImage; shot.hidden = false;
      video.hidden = true; camGuide.hidden = true; stopCamera();
      takeShot.hidden = true; retake.hidden = false; toSelect.disabled = false;
    };
    retake.onclick = () => { session.faceImage = null; shot.hidden = true; retake.hidden = true; toSelect.disabled = true; startCam.click(); };
    $('#uploadFace').onchange = async e => {
      if (!e.target.files[0]) return;
      session.faceImage = await fileToDataUrl(e.target.files[0], 1280);
      shot.src = session.faceImage; shot.hidden = false; camEmpty.hidden = true; video.hidden = true; camGuide.hidden = true;
      stopCamera(); startCam.hidden = false; takeShot.hidden = true; retake.hidden = false; toSelect.disabled = false;
    };
    $('#backConsent').onclick = () => go('consent');
    toSelect.onclick = () => { if (!session.faceImage) return toast('사진을 먼저 준비하세요.'); go('select'); };
  }

  // ================= 3. 스타일 선택 =================
  function renderSelect() {
    const el = div('screen');
    el.innerHTML = `
      ${stepper('select')}
      <div class="screen-head row-between">
        <div>
          <div class="eyebrow">3단계 · 스타일 선택</div>
          <h1>추천 스타일 고르기 <span class="muted" style="font-size:15px">(2~4개)</span></h1>
          <p>손님에게 추천할 스타일을 2~4개 선택하면, 각각의 예상 이미지를 만듭니다.</p>
        </div>
        <div style="text-align:right">
          <div class="muted">선택됨</div>
          <div style="font-size:28px;font-weight:900;color:var(--brand-2)"><span id="selCount">0</span> / 4</div>
        </div>
      </div>
      <div class="card-grid" id="selGrid"></div>
      <div class="action-bar">
        <button class="link-btn" id="backCap">← 이전</button>
        <div class="spacer"></div>
        <button class="primary-btn big-btn" id="toGen" disabled>예상 이미지 생성 →</button>
      </div>`;
    screens.appendChild(el);
    const grid = $('#selGrid');
    LumainData.listCards().forEach(c => {
      const card = styleCardEl(c, true);
      if (session.selectedCardIds.includes(c.id)) card.classList.add('selected');
      card.onclick = () => toggleSelect(c.id, card);
      grid.appendChild(card);
    });
    updateSelUI();
    $('#backCap').onclick = () => go('capture');
    $('#toGen').onclick = () => {
      if (session.selectedCardIds.length < 2) return toast('2개 이상 선택하세요.');
      if (LumainData.getCredit() < session.selectedCardIds.length)
        return toast('크레딧이 부족합니다. (필요: ' + session.selectedCardIds.length + ')');
      go('generating');
    };
  }
  function toggleSelect(id, cardEl) {
    const i = session.selectedCardIds.indexOf(id);
    if (i >= 0) { session.selectedCardIds.splice(i, 1); cardEl.classList.remove('selected'); }
    else {
      if (session.selectedCardIds.length >= 4) return toast('최대 4개까지 선택할 수 있습니다.');
      session.selectedCardIds.push(id); cardEl.classList.add('selected');
    }
    updateSelUI();
  }
  function updateSelUI() {
    const n = session.selectedCardIds.length;
    $('#selCount').textContent = n;
    $('#toGen').disabled = n < 2;
  }

  // ================= 4. 생성 (로딩) =================
  async function renderGenerating() {
    const cards = session.selectedCardIds.map(id => LumainData.getCard(id)).filter(Boolean);
    const el = div('screen');
    el.innerHTML = `
      <div class="gen-loading">
        <div>
          <div class="spinner"></div>
          <h2>예상 이미지를 만들고 있어요</h2>
          <p>${LumainGen.usingGemini() ? 'Gemini가 얼굴을 보존하며 헤어만 바꾸는 중…' : '데모 미리보기를 합성하는 중…'}</p>
          <div class="gen-progress" id="genProg"></div>
        </div>
      </div>`;
    screens.appendChild(el);
    const prog = $('#genProg');
    cards.forEach((c, i) => {
      const p = div('pline'); p.id = 'pl_' + i; p.textContent = `· ${c.name}`; prog.appendChild(p);
    });

    session.results = [];
    for (let i = 0; i < cards.length; i++) {
      const line = $('#pl_' + i); line.classList.add('active'); line.textContent = `▸ ${cards[i].name} — 생성 중…`;
      try {
        const r = await LumainGen.generatePreview({
          faceImage: session.faceImage, styleCard: cards[i],
          onProgress: () => {},
        });
        session.results.push({ cardId: cards[i].id, ...r });
        LumainData.chargeCredit(1); // 성공 시에만 차감
        line.textContent = `✓ ${cards[i].name}${r.source.startsWith('demo') ? ' (데모)' : ''}`;
        line.classList.remove('active'); line.style.color = 'var(--ok)';
      } catch (err) {
        session.results.push({ cardId: cards[i].id, dataUrl: null, source: 'error', error: err.message });
        line.textContent = `✗ ${cards[i].name} — 실패 (미차감)`;
        line.style.color = 'var(--danger)';
      }
    }
    refreshCredit();
    setTimeout(() => go('results'), 500);
  }

  // ================= 5. 결과 비교 + 확인 체크 =================
  function renderResults() {
    const el = div('screen');
    const anyError = session.results.some(r => r.error);
    const anyDemo = session.results.some(r => r.source && r.source.startsWith('demo'));
    el.innerHTML = `
      ${stepper('results')}
      <div class="result-head">
        <div>
          <div class="eyebrow">4단계 · 예상 이미지 확인</div>
          <h1>원본과 나란히 비교</h1>
          <p>마음에 드는 방향을 손님과 함께 고르세요. ${anyDemo ? '<span class="demo-flag">일부 데모 이미지</span>' : ''}</p>
        </div>
        <button class="ghost-btn" id="regen">↻ 다시 생성</button>
      </div>
      <div class="compare-grid" id="compareGrid"></div>

      <div class="confirm-banner">
        <div class="warn">⚠ 시술로 넘어가기 전 손님 확인</div>
        <div class="check-row" id="cUnderstand" style="margin-top:10px">
          <div class="box">✓</div>
          <div class="ctext">이 이미지는 <b>느낌을 잡기 위한 예상 이미지</b>이며, 모발 상태·길이·시술 조건에 따라
            <b>실제 결과는 다를 수 있음을 이해했습니다.</b><span class="req">필수</span></div>
        </div>
        <div class="action-bar">
          <button class="link-btn" id="backSelect">← 스타일 다시 선택</button>
          <div class="spacer"></div>
          <button class="primary-btn big-btn" id="toDone" disabled>이 방향으로 시술 시작 →</button>
        </div>
      </div>`;
    screens.appendChild(el);

    const grid = $('#compareGrid');
    // 원본
    const orig = div('compare-item original');
    orig.innerHTML = `<div class="label">원본</div>
      <div class="result-frame"><img src="${session.faceImage}"></div>
      <div class="result-caption">손님 원본 사진</div>`;
    grid.appendChild(orig);
    // 결과들
    session.results.forEach((r, idx) => {
      const card = LumainData.getCard(r.cardId);
      const item = div('compare-item');
      if (r.error) {
        item.innerHTML = `<div class="label">${escapeHtml(card?.name || '')}</div>
          <div class="result-frame" style="aspect-ratio:3/4;display:grid;place-items:center;color:var(--danger);text-align:center;padding:20px">
            생성 실패<br><span class="muted">${escapeHtml(r.error).slice(0,80)}</span></div>
          <div class="result-caption">크레딧은 차감되지 않았습니다</div>`;
      } else {
        item.innerHTML = `<div class="label">${escapeHtml(card?.name || '')} ${r.source.startsWith('demo') ? '<span class="demo-flag">DEMO</span>' : ''}</div>
          <div class="result-frame" data-idx="${idx}">
            <div class="pick-badge">✓ 손님 선택</div>
            <img src="${r.dataUrl}">
          </div>
          <div class="result-caption"><b>${escapeHtml(card?.name || '')}</b></div>`;
        item.querySelector('.result-frame').onclick = () => pickResult(idx);
      }
      grid.appendChild(item);
    });

    let understood = false;
    bindCheck($('#cUnderstand'), v => { understood = v; session.understoodEstimate = v; updateDoneBtn(); });
    function updateDoneBtn() {
      $('#toDone').disabled = !(understood && session.pickedIndex !== null);
    }
    window.__updateDoneBtn = updateDoneBtn;

    $('#regen').onclick = () => go('generating');
    $('#backSelect').onclick = () => go('select');
    $('#toDone').onclick = () => go('done');
  }
  function pickResult(idx) {
    session.pickedIndex = idx;
    $$('.result-frame').forEach(f => f.classList.toggle('pick', f.dataset.idx == idx));
    window.__updateDoneBtn && window.__updateDoneBtn();
  }

  // ================= 6. 완료 + 파기 =================
  function renderDone() {
    const picked = session.pickedIndex != null ? session.results[session.pickedIndex] : null;
    const card = picked ? LumainData.getCard(picked.cardId) : null;
    const retain = session.consent.retain;
    // 파기 정책 반영: 보관 미동의면 즉시 세션 이미지 폐기
    const el = div('screen');
    el.innerHTML = `
      <div class="done-wrap">
        <div class="done-icon">✓</div>
        <h1>시술을 시작하세요</h1>
        <p>손님이 <b style="color:var(--brand-2)">${escapeHtml(card?.name || '선택한 스타일')}</b> 방향을 선택했습니다.<br>
           예상 이미지임을 확인하셨고, 이제 실제 시술로 넘어갑니다.</p>
        <div class="purge-note" id="purgeNote"></div>
        <div class="action-bar" style="justify-content:center;margin-top:26px">
          <button class="ghost-btn big-btn" id="newCustomer">다음 손님 →</button>
          <button class="link-btn" id="homeBtn">홈으로</button>
        </div>
      </div>`;
    screens.appendChild(el);

    const note = $('#purgeNote');
    if (retain) {
      note.innerHTML = `🗄 손님이 <b>${session.consent.retainDays}일 보관</b>에 동의하여 결과가 매장 기록에 저장됩니다.
        기간 후 <b>자동 삭제</b>됩니다. (원본 얼굴 사진은 보관하지 않습니다)`;
    } else {
      // 즉시 파기
      const hadFace = !!session.faceImage;
      session.faceImage = null;
      session.results = [];
      note.innerHTML = `🔥 보관 미동의 — 원본과 결과 이미지를 <b>방금 자동 파기</b>했습니다. ${hadFace ? '(서버 저장 없음)' : ''}`;
    }
    $('#newCustomer').onclick = beginGreeting;
    $('#homeBtn').onclick = () => go('home');
  }

  // ================= 설정 (Gemini 키) =================
  function openSettings() {
    const s = LumainGen.getSettings();
    const backdrop = div('modal-backdrop');
    backdrop.innerHTML = `
      <div class="modal">
        <h2>AI 엔진 설정</h2>
        <div class="sub">Gemini 키를 입력하면 실제 생성이 켜집니다. 없으면 데모로 동작합니다.</div>

        <div class="field"><label>생성 모드</label>
          <select id="setMode">
            <option value="auto"${s.mode==='auto'?' selected':''}>자동 (키 있으면 Gemini, 없으면 데모)</option>
            <option value="gemini"${s.mode==='gemini'?' selected':''}>항상 Gemini</option>
            <option value="demo"${s.mode==='demo'?' selected':''}>항상 데모</option>
          </select></div>

        <div class="field" style="margin-top:14px"><label>Gemini API 키</label>
          <input id="setKey" type="password" value="${escapeAttr(s.geminiKey)}" placeholder="AIza...">
        </div>
        <div class="field" style="margin-top:14px"><label>모델명</label>
          <input id="setModel" value="${escapeAttr(s.model)}" placeholder="gemini-2.5-flash-image">
          <div class="muted" style="margin-top:6px">이미지 편집 지원 모델. (예: gemini-2.5-flash-image)</div>
        </div>

        <div class="check-row" id="setGuard" style="margin-top:16px${s.faceGuard?';' : ';'}">
          <div class="box">✓</div>
          <div class="ctext">얼굴 유사도 경고 사용 (2단계에서 강화)</div>
        </div>

        <div class="purge-note" style="margin-top:16px;color:var(--danger);border-color:rgba(255,107,107,.3)">
          ⚠ <b>보안 안내:</b> 지금은 단일 웹앱이라 키가 이 브라우저에 저장됩니다.
          원장님 <b>본인 태블릿 1대</b>에서만 쓰세요. 손님/직원에게 여는 단계가 되면
          반드시 백엔드(2단계)로 키를 옮겨야 합니다.
        </div>

        <div class="modal-actions">
          <button class="ghost-btn" id="setCancel">취소</button>
          <button class="primary-btn" id="setSave">저장</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);
    if (s.faceGuard) $('#setGuard', backdrop).classList.add('checked');
    let guard = s.faceGuard;
    bindCheck($('#setGuard', backdrop), v => guard = v);
    $('#setCancel', backdrop).onclick = () => backdrop.remove();
    backdrop.onclick = e => { if (e.target === backdrop) backdrop.remove(); };
    $('#setSave', backdrop).onclick = () => {
      LumainGen.saveSettings({
        mode: $('#setMode', backdrop).value,
        geminiKey: $('#setKey', backdrop).value.trim(),
        model: $('#setModel', backdrop).value.trim() || 'gemini-2.5-flash-image',
        faceGuard: guard,
      });
      backdrop.remove(); toast('설정을 저장했습니다.'); go('home');
    };
  }

  // ================= 공통 UI =================
  function stepper(active) {
    const steps = [['consent', '동의'], ['capture', '촬영'], ['select', '스타일'], ['generating', '생성'], ['results', '확인']];
    const order = steps.map(s => s[0]);
    const ai = order.indexOf(active);
    return `<div class="stepper">${steps.map((s, i) => {
      const cls = i === ai ? 'active' : (i < ai ? 'done' : '');
      const sep = i < steps.length - 1 ? '<div class="step-sep"></div>' : '';
      return `<div class="step ${cls}"><span class="dot">${i < ai ? '✓' : i + 1}</span>${s[1]}</div>${sep}`;
    }).join('')}</div>`;
  }

  function stopCamera() {
    if (session && session.stream) { session.stream.getTracks().forEach(t => t.stop()); session.stream = null; }
  }

  // ---- 헬퍼 ----
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
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#171a21;border:1px solid #2a2f3a;color:#f4f6fb;padding:14px 22px;border-radius:12px;z-index:200;box-shadow:0 12px 30px rgba(0,0,0,.5);font-size:15px;font-weight:600';
      document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.style.opacity = '0', 2600);
  }

  // ================= 초기화 =================
  function init() {
    refreshCredit();
    $('#brandHome').onclick = () => go('home');
    $('#navStyles').onclick = () => go('styles');
    $('#navGreet').onclick = beginGreeting;
    // 설정 버튼을 크레딧 옆에 추가
    const gear = document.createElement('button');
    gear.className = 'ghost-btn'; gear.textContent = '⚙';
    gear.title = 'AI 엔진 설정'; gear.style.padding = '13px 16px';
    gear.onclick = openSettings;
    $('#creditPill').after(gear);
    newSession();
    go('home');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
