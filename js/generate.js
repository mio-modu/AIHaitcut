/* =========================================================
   generate.js — 헤어 미리보기 "생성 엔진" (교체 지점)
   ---------------------------------------------------------
   ★ 이 파일이 기획서 3-2절의 핵심입니다.
     - 1단계(지금): Gemini 실연동 + (키 없으면) 데모 미리보기
     - 2단계(나중): callGemini() 내부를 브라우저 직접호출 대신
                     자기 백엔드(/api/generate) 호출로 교체하면 끝.
     흐름의 나머지(촬영·동의·워터마크·비교)는 손대지 않아도 됩니다.
   ========================================================= */

const LumainGen = (() => {
  const SETTINGS_KEY = 'lumain_settings_v1';

  // ---- 설정 (localStorage 저장) --------------------------------
  const DEFAULTS = {
    mode: 'auto',                       // 'auto' | 'demo' | 'gemini'
    geminiKey: '',                      // 원장이 입력. 브라우저 저장(1단계 한정)
    model: 'gemini-2.5-flash-image',    // Gemini 이미지 편집 모델(=Nano Banana 계열)
    faceGuard: true,                    // 얼굴 유사도 경고 사용
  };

  function getSettings() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULTS }; }
  }
  function saveSettings(patch) {
    const next = { ...getSettings(), ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }
  // 실제 Gemini를 쓸 조건인가?
  function usingGemini() {
    const s = getSettings();
    if (s.mode === 'demo') return false;
    if (s.mode === 'gemini') return true;
    return !!s.geminiKey; // auto: 키가 있으면 실연동
  }

  // ---- 스타일 지시문 -------------------------------------------
  //  스타일 카드의 prompt_params(cut / top / finish / keywords)를 그대로 싣는다.
  //  prompt_params 가 없는 커스텀 카드는 태그·설명으로 대체된다.
  function styleDirectives(styleCard) {
    const p = styleCard.prompt_params || {};
    const t = styleCard.tags || {};
    const title = [styleCard.name_ko || styleCard.name, styleCard.name_en]
      .filter(Boolean).join(' / ');
    return [
      `  • Style name: ${title}`,
      t.length ? `  • Overall length: ${t.length}` : '',
      t.perm && t.perm !== '없음' ? `  • Perm / texture: ${t.perm}` : '',
      p.cut ? `  • Cut & silhouette: ${p.cut}` : '',
      p.top ? `  • Top & fringe: ${p.top}` : '',
      p.finish ? `  • Finish & mood: ${p.finish}` : '',
      (p.keywords && p.keywords.length) ? `  • Keywords: ${p.keywords.join(', ')}` : '',
      (styleCard.desc && styleCard.desc !== styleCard.name_en) ? `  • Notes: ${styleCard.desc}` : '',
    ].filter(Boolean).join('\n');
  }

  // ---- 얼굴 보존 프롬프트 ---------------------------------------
  //  refs: { front:boolean, side:boolean } — 레퍼런스 사진을 함께 보낼 때
  //  각 이미지가 무엇인지 번호로 알려줘야 모델이 얼굴/헤어를 헷갈리지 않는다.
  function buildPrompt(styleCard, refs = {}) {
    const hasFront = !!refs.front, hasSide = !!refs.side;
    const sideNo = hasFront ? 3 : 2;

    const imageMap = ['INPUT IMAGES:', '  IMAGE 1 = the CUSTOMER photo. This is the photo you must edit.'];
    if (hasFront) imageMap.push(`  IMAGE 2 = STYLE REFERENCE, front view. Copy the HAIRSTYLE from it.`);
    if (hasSide) imageMap.push(`  IMAGE ${sideNo} = STYLE REFERENCE, side view. Use it for side/back length, the two-block line and the nape.`);
    if (hasFront || hasSide) {
      imageMap.push('  The reference model is NOT the customer. Take ONLY the hair from the reference —');
      imageMap.push('  never the face, skin tone, body, clothing, background or camera angle.');
    }

    return [
      'You are a professional hair styling visualizer for a hair salon.',
      'Edit the CUSTOMER photo so the person wears a NEW hairstyle.',
      '',
      ...imageMap,
      '',
      'CRITICAL — FACE PRESERVATION (highest priority):',
      "Preserve the customer's face EXACTLY — identical facial features, bone structure,",
      'skin tone, eyes, nose, mouth, and expression. The face must remain the same person,',
      'unmistakably recognizable. Do NOT beautify, slim, or alter the face in any way.',
      '',
      'CHANGE ONLY THE HAIR — cut, length, texture and styling:',
      styleDirectives(styleCard),
      '',
      'HAIR COLOR: keep the customer\'s original hair color. This is a CUT & PERM preview,',
      'not a dye preview — do not lighten, darken or tint the hair.',
      '',
      'Keep neck, shoulders, clothing, background, lighting and camera angle the same as the original.',
      'Photorealistic salon result. Natural hairline and nape. Do not add text or watermark.',
      'Return the edited image only.',
    ].filter(Boolean).join('\n');
  }

  // ---- 유틸: 이미지 → base64 / 로드 ---------------------------
  function stripDataUrl(dataUrl) {
    const i = dataUrl.indexOf(',');
    return { mime: dataUrl.slice(5, dataUrl.indexOf(';')), data: dataUrl.slice(i + 1) };
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  // 스타일 카드 레퍼런스 사진(public/images/*.webp 또는 원장이 올린 dataURL)을
  // Gemini inlineData 형식으로 변환. 실패하면 null → 텍스트 지시문만으로 진행.
  async function toInlineData(url) {
    if (!url) return null;
    try {
      if (url.startsWith('data:')) {
        const { mime, data } = stripDataUrl(url);
        return { mimeType: mime, data };
      }
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const dataUrl = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result); fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      const { mime, data } = stripDataUrl(dataUrl);
      return { mimeType: mime, data };
    } catch (e) {
      // file:// 로 직접 열었거나 경로가 없을 때. 흐름은 끊지 않는다.
      console.warn('[LumainGen] 레퍼런스 이미지 로드 실패 → 텍스트 지시문만 사용:', url, e.message);
      return null;
    }
  }

  // =========================================================
  //  (A) 실제 Gemini 호출
  //  2단계에서 이 함수 본문을 fetch('/api/generate', ...) 로 바꾸면
  //  키가 서버로 숨겨집니다. 나머지 코드는 그대로.
  // =========================================================
  async function callGemini(faceDataUrl, styleCard, onProgress) {
    const s = getSettings();
    const { mime, data } = stripDataUrl(faceDataUrl);

    // 스타일 카드의 정면/측면 모델컷을 함께 첨부한다 (있는 것만).
    onProgress && onProgress('ref-load');
    const [refFront, refSide] = await Promise.all([
      toInlineData(styleCard.front_image || styleCard.image),
      toInlineData(styleCard.side_image),
    ]);
    onProgress && onProgress('gemini-request');

    // 이미지마다 바로 앞에 라벨 텍스트를 붙여 어떤 사진인지 명시.
    const reqParts = [{ text: buildPrompt(styleCard, { front: !!refFront, side: !!refSide }) }];
    reqParts.push({ text: '--- IMAGE 1 · CUSTOMER PHOTO (edit this one, keep this face) ---' });
    reqParts.push({ inlineData: { mimeType: mime, data } });
    if (refFront) {
      reqParts.push({ text: '--- IMAGE 2 · STYLE REFERENCE, FRONT (hairstyle only, different person) ---' });
      reqParts.push({ inlineData: refFront });
    }
    if (refSide) {
      reqParts.push({ text: `--- IMAGE ${refFront ? 3 : 2} · STYLE REFERENCE, SIDE (side/back length, two-block line) ---` });
      reqParts.push({ inlineData: refSide });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(s.geminiKey)}`;
    const body = {
      contents: [{ role: 'user', parts: reqParts }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.4 },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json())?.error?.message || ''; } catch {}
      throw new Error(`Gemini ${resp.status}: ${detail || resp.statusText}`);
    }
    const json = await resp.json();
    const cand = json?.candidates?.[0];
    const parts = cand?.content?.parts || [];
    const imgPart = parts.find(p => p.inline_data?.data || p.inlineData?.data);
    if (!imgPart) {
      const txt = parts.find(p => p.text)?.text || '';
      throw new Error('Gemini가 이미지를 반환하지 않았습니다. ' + (txt ? `(${txt.slice(0, 120)})` : ''));
    }
    const inline = imgPart.inline_data || imgPart.inlineData;
    return `data:${inline.mime_type || inline.mimeType || 'image/png'};base64,${inline.data}`;
  }

  // =========================================================
  //  (B) 데모 미리보기 — 키 없이도 전체 흐름을 시연
  //  실제 헤어 교체가 아니라, "예상 방향"을 색·톤으로 표현하고
  //  스타일 카드 참조 이미지를 함께 얹어 보여줍니다. (정직한 데모)
  // =========================================================
  async function demoPreview(faceDataUrl, styleCard, onProgress) {
    onProgress && onProgress('demo-compose');
    const img = await loadImage(faceDataUrl);
    const W = 900, H = Math.round(W * (img.height / img.width));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');

    // 원본
    ctx.drawImage(img, 0, 0, W, H);

    // 스타일 톤 오버레이 — 컬러 태그가 없는 남성 카탈로그이므로
    // 스타일 id 로 톤을 갈라 4종이 서로 구분되게 한다. (데모 전용 연출)
    const tint = toneForStyle(styleCard);
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = tint;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 상단 헤어 영역 암시용 그라데이션
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    g.addColorStop(0, applyAlpha(tint, 0.45));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H * 0.45);

    // 스타일 카드 참조 썸네일 — 정면/측면 두 장을 우측에 세로로 얹는다.
    const refs = [
      { src: styleCard.front_image || styleCard.image, label: '정면' },
      { src: styleCard.side_image, label: '측면' },
    ].filter(r => r.src);
    let ry = 18;
    const rw = W * 0.22;
    for (const r of refs) {
      try {
        const ref = await loadImage(r.src);
        const rh = rw * (ref.height / ref.width || 1.33);
        const rx = W - rw - 18;
        ctx.save();
        roundRect(ctx, rx, ry, rw, rh, 0); ctx.clip();
        ctx.drawImage(ref, rx, ry, rw, rh);
        ctx.restore();
        ctx.strokeStyle = 'rgba(78,168,255,.9)'; ctx.lineWidth = 2;
        roundRect(ctx, rx, ry, rw, rh, 0); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(rx, ry + rh - 24, rw, 24);
        ctx.fillStyle = '#7CC4FF'; ctx.font = '500 12px Pretendard, "Noto Sans KR"'; ctx.textAlign = 'center';
        ctx.fillText(r.label, rx + rw / 2, ry + rh - 7);
        ry += rh + 10;
      } catch {}
    }

    // 데모 표식 + 스타일명 (4종이 눈으로 구분되도록)
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(124,196,255,.95)';
    ctx.font = '700 15px Pretendard, "Noto Sans KR"';
    ctx.fillText('DEMO · 실제 AI 생성 아님', 18, 30);
    ctx.fillStyle = 'rgba(238,241,245,.92)';
    ctx.font = '600 20px Pretendard, "Noto Sans KR"';
    ctx.fillText(styleCard.name_ko || styleCard.name || '', 18, 58);

    return cv.toDataURL('image/jpeg', 0.92);
  }

  // ---- 워터마크 굽기 (공통 후처리, 캡처해도 따라감) -----------
  async function bakeWatermark(dataUrl) {
    const img = await loadImage(dataUrl);
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const W = cv.width, H = cv.height;
    const barH = Math.max(38, Math.round(H * 0.075));

    // 하단 반투명 바
    ctx.fillStyle = 'rgba(10,11,13,.66)';
    ctx.fillRect(0, H - barH, W, barH);
    ctx.fillStyle = 'rgba(78,168,255,.95)';
    ctx.fillRect(0, H - barH, 4, barH);

    const fs = Math.max(15, Math.round(barH * 0.4));
    ctx.font = `600 ${fs}px Pretendard, "Noto Sans KR"`;
    ctx.fillStyle = '#EEF1F5';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('AI 예상 이미지 · 실제 결과와 다를 수 있습니다', 20, H - barH / 2);

    // 우하단 브랜드 (세리프 트래킹 느낌)
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(238,241,245,.9)';
    ctx.font = `700 ${fs}px Pretendard, "Noto Sans KR"`;
    ctx.fillText('L U M A I N', W - 20, H - barH / 2);

    // 대각 반복 워터마크 (연하게)
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(W * 0.03)}px Pretendard, "Noto Sans KR"`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 9);
    for (let y = -H; y < H; y += Math.round(W * 0.13)) {
      for (let x = -W; x < W; x += Math.round(W * 0.42)) {
        ctx.fillText('예상 이미지', x, y);
      }
    }
    ctx.restore();

    return cv.toDataURL('image/jpeg', 0.92);
  }

  // ---- 얼굴 유사도 가드 (자리만 마련; 실측은 2단계) -----------
  // 실제로는 얼굴 임베딩 비교가 필요. 지금은 통과시키되 확장 지점만 표시.
  async function faceSimilarityCheck(/* originalDataUrl, resultDataUrl */) {
    return { ok: true, score: null, note: '얼굴 유사도 자동 검증은 2단계(백엔드)에서 임베딩 비교로 강화 예정' };
  }

  // =========================================================
  //  공개 API: generatePreview
  //  → 항상 "워터마크가 구워진" dataURL 을 반환
  // =========================================================
  async function generatePreview({ faceImage, styleCard, onProgress }) {
    const started = performance.now();
    let raw, source;
    try {
      if (usingGemini()) {
        raw = await callGemini(faceImage, styleCard, onProgress);
        source = 'gemini';
      } else {
        raw = await demoPreview(faceImage, styleCard, onProgress);
        source = 'demo';
      }
    } catch (err) {
      // 실연동 실패 시 데모로 자동 fallback (흐름 끊기지 않게)
      console.warn('[LumainGen] 생성 실패 → 데모 fallback:', err.message);
      onProgress && onProgress('fallback');
      raw = await demoPreview(faceImage, styleCard, onProgress);
      source = 'demo-fallback';
      var errorMsg = err.message;
    }

    onProgress && onProgress('watermark');
    const guard = getSettings().faceGuard ? await faceSimilarityCheck(faceImage, raw) : { ok: true };
    const finalUrl = await bakeWatermark(raw);

    return {
      dataUrl: finalUrl,
      source,                       // 'gemini' | 'demo' | 'demo-fallback'
      guard,
      error: (typeof errorMsg !== 'undefined') ? errorMsg : null,
      ms: Math.round(performance.now() - started),
    };
  }

  // ---- 색상 헬퍼 -------------------------------------------
  //  데모 전용 톤. 남성 카탈로그엔 컬러 태그가 없으므로 스타일 id 해시로
  //  차분한 무채/브라운 계열 중 하나를 고정 배정한다(같은 카드=항상 같은 톤).
  const DEMO_TONES = ['#5b4a3a', '#4a4f58', '#6b5a48', '#3f4650', '#7a6a55', '#4d4438'];
  function toneForStyle(styleCard) {
    const key = String(styleCard.id || styleCard.name || '');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return DEMO_TONES[Math.abs(h) % DEMO_TONES.length];
  }
  function applyAlpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return { generatePreview, getSettings, saveSettings, usingGemini, buildPrompt };
})();
