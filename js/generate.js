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

  // ---- 얼굴 보존 프롬프트 (기획서 명세 그대로) -----------------
  function buildPrompt(styleCard) {
    const t = styleCard.tags || {};
    const parts = [
      'You are a professional hair styling visualizer for a hair salon.',
      'Edit the given photo of a person to show a NEW hairstyle.',
      '',
      'CRITICAL — FACE PRESERVATION (highest priority):',
      "Preserve the person's face EXACTLY — identical facial features, bone structure,",
      'skin tone, eyes, nose, mouth, and expression. The face must remain the same person,',
      'unmistakably recognizable. Do NOT beautify, slim, or alter the face in any way.',
      '',
      'CHANGE ONLY THE HAIR — cut, length, color, and style:',
      `  • Style name: ${styleCard.name}`,
      t.length ? `  • Length: ${t.length}` : '',
      t.color ? `  • Color: ${t.color}` : '',
      t.perm ? `  • Texture / perm: ${t.perm}` : '',
      styleCard.desc ? `  • Notes: ${styleCard.desc}` : '',
      '',
      'Keep neck, shoulders, clothing, background, lighting and camera angle the same as the original.',
      'Photorealistic salon result. Natural hairline. Do not add text or watermark.',
    ];
    return parts.filter(Boolean).join('\n');
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

  // =========================================================
  //  (A) 실제 Gemini 호출
  //  2단계에서 이 함수 본문을 fetch('/api/generate', ...) 로 바꾸면
  //  키가 서버로 숨겨집니다. 나머지 코드는 그대로.
  // =========================================================
  async function callGemini(faceDataUrl, styleCard, onProgress) {
    const s = getSettings();
    const { mime, data } = stripDataUrl(faceDataUrl);
    onProgress && onProgress('gemini-request');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent?key=${encodeURIComponent(s.geminiKey)}`;
    const body = {
      contents: [{
        role: 'user',
        parts: [
          { text: buildPrompt(styleCard) },
          { inlineData: { mimeType: mime, data } },
        ],
      }],
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

    // 스타일 톤 오버레이 (컬러 태그 기반)
    const tint = colorForTag(styleCard.tags?.color);
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

    // 스타일 카드 참조 썸네일 (우상단)
    if (styleCard.image) {
      try {
        const ref = await loadImage(styleCard.image);
        const rw = W * 0.24, rh = rw * (ref.height / ref.width || 1.33);
        const rx = W - rw - 18, ry = 18;
        ctx.save();
        roundRect(ctx, rx, ry, rw, rh, 12); ctx.clip();
        ctx.drawImage(ref, rx, ry, rw, rh);
        ctx.restore();
        ctx.strokeStyle = 'rgba(230,207,156,.9)'; ctx.lineWidth = 3;
        roundRect(ctx, rx, ry, rw, rh, 12); ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect(rx, ry + rh - 26, rw, 26);
        ctx.fillStyle = '#e6cf9c'; ctx.font = '600 13px "Noto Sans KR"'; ctx.textAlign = 'center';
        ctx.fillText('선택 스타일', rx + rw / 2, ry + rh - 8);
      } catch {}
    }

    // 데모 표식
    ctx.fillStyle = 'rgba(110,168,254,.92)';
    ctx.font = '800 15px "Noto Sans KR"'; ctx.textAlign = 'left';
    ctx.fillText('DEMO · 실제 AI 생성 아님', 18, 30);

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
    ctx.fillStyle = 'rgba(15,17,21,.62)';
    ctx.fillRect(0, H - barH, W, barH);
    ctx.fillStyle = 'rgba(201,168,106,.9)';
    ctx.fillRect(0, H - barH, 5, barH);

    const fs = Math.max(15, Math.round(barH * 0.4));
    ctx.font = `700 ${fs}px "Noto Sans KR"`;
    ctx.fillStyle = '#f4f6fb';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('AI 예상 이미지 · 실제 결과와 다를 수 있습니다', 20, H - barH / 2);

    // 우하단 브랜드
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(230,207,156,.85)';
    ctx.font = `800 ${fs}px "Noto Sans KR"`;
    ctx.fillText('LUMAIN', W - 20, H - barH / 2);

    // 대각 반복 워터마크 (연하게)
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(W * 0.03)}px "Noto Sans KR"`;
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
  function colorForTag(color) {
    const map = {
      '애쉬 브라운': '#7c6a53', '애쉬 그레이': '#8a8a90', '블랙': '#2b2b30',
      '다크 브라운': '#4a382a', '내추럴 브라운': '#6b4f37', '레드 브라운': '#7a4436',
      '밀크 브라운': '#9a7a5a', '블론드': '#c9a86a', '핑크': '#c98a97', '블루블랙': '#2a2f3a',
    };
    return map[color] || '#6b4f37';
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
