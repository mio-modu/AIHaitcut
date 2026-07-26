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
    // 이미지 편집 모델. 2026-07 기준 이미지당 단가:
    //   gemini-3.1-flash-lite-image  $0.0336  (나노바나나 2 라이트, 가장 저렴·빠름) ← 기본
    //   gemini-3.1-flash-image       $0.067   (나노바나나 2, 품질 우선)
    //   gemini-2.5-flash-image       $0.039   (구 기본값)
    model: 'gemini-3.1-flash-lite-image',
    faceGuard: true,                    // 얼굴 유사도 경고 사용
    background: 'studio',               // 'studio' | 'white' | 'keep' — 누끼 처리 방식
    maskRefFace: true,                  // 견본 모델 얼굴을 지우고 전송 (결과에 견본 얼굴 방지)
    // ★ 보정은 정체성을 갉아먹는다. 실제로 "얼굴이 어려지고 갸름해져 딴사람"이 되는
    //   사고가 났다. 그래서 피부만 아주 약하게, 자세 교정은 기본 해제로 되돌렸다.
    skinCleanup: 'minimal',             // 'minimal' | 'none' — 조명 얼룩·번들거림만
    posture: 'keep',                    // 'keep' | 'fix' — 기본은 원본 각도 유지
  };

  // 이미 설정을 저장한 브라우저는 옛 모델명이 localStorage 에 박혀 있어
  // DEFAULTS 를 바꿔도 반영되지 않는다. "예전 기본값 그대로인 경우"만 1회 올려준다.
  // (원장이 직접 고른 모델명은 건드리지 않도록 플래그로 1회만 실행)
  const LEGACY_MODELS = ['gemini-2.5-flash-image'];
  const MODEL_MIGRATED_KEY = 'lumain_model_migrated_v3';
  function migrateModel() {
    try {
      if (localStorage.getItem(MODEL_MIGRATED_KEY)) return;
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (raw.model && LEGACY_MODELS.includes(raw.model)) {
        raw.model = DEFAULTS.model;
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(raw));
        console.info('[LumainGen] 모델을 ' + DEFAULTS.model + ' 로 갱신');
      }
      localStorage.setItem(MODEL_MIGRATED_KEY, '1');
    } catch {}
  }

  // 보정 과다로 인물이 바뀌는 사고가 있었다. 이미 저장된 설정에는 옛 값
  // (posture:'fix', skinCleanup:'light')이 그대로 남아 있으므로 1회 되돌린다.
  const RETOUCH_MIGRATED_KEY = 'lumain_retouch_reset_v1';
  function migrateRetouch() {
    try {
      if (localStorage.getItem(RETOUCH_MIGRATED_KEY)) return;
      const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      let changed = false;
      if (raw.posture === 'fix') { raw.posture = 'keep'; changed = true; }
      if (raw.skinCleanup === 'light') { raw.skinCleanup = 'minimal'; changed = true; }
      if (changed) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(raw));
        console.info('[LumainGen] 보정 설정을 약하게 되돌림 (정체성 보존 우선)');
      }
      localStorage.setItem(RETOUCH_MIGRATED_KEY, '1');
    } catch {}
  }

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

  // ---- 배경(누끼) 지시문 ----------------------------------------
  //  머리 모양을 보는 컷이므로 배경이 산만하면 안 된다. 다만 하드 누끼는
  //  잔머리 경계가 톱니처럼 깨지고 흰 테두리(할로)가 생기기 쉬우므로,
  //  "배경을 갈아끼우되 인물은 그대로" 를 명시하고 모발 경계를 따로 못박는다.
  const BACKGROUND_MODES = {
    studio: [
      'BACKGROUND — replace it with ONE clean, standardized salon studio backdrop:',
      '  • Clean seamless light-grey studio backdrop — the SAME flat, even light grey every time,',
      '    identical across all generated styles so four results can be compared side by side.',
      '  • Evenly lit, no props, no furniture, no texture, no wall shadows, no coloured cast.',
      '  • Remove everything from the original background — people, mirrors, signage, clutter.',
      '  • No black bars, no letterboxing, no original-background bleed anywhere in the frame.',
      '  • Relight the subject subtly so they look genuinely photographed against that backdrop.',
    ],
    white: [
      'BACKGROUND — replace it with pure white (#FFFFFF):',
      '  • Completely flat, seamless white. No gradient, no shadow, no floor line, no vignette.',
      '  • Remove everything from the original background.',
      '  • Keep the subject properly exposed — do not blow out skin or light hair into the white.',
    ],
    keep: ['BACKGROUND: keep the original background, lighting and camera angle unchanged.'],
  };
  function backgroundDirectives(mode, hasRef, lockPose) {
    const lines = BACKGROUND_MODES[mode] || BACKGROUND_MODES.studio;
    // 레퍼런스도 스튜디오에서 찍힌 인물컷이라, 배경까지 통째로 끌어오는 사고가 있었다.
    const noImport = hasRef
      ? ['  • Do NOT import the reference image\'s background. Generate a fresh neutral backdrop;',
         '    the reference is for hair only.']
      : [];
    if (mode === 'keep') return lines.concat(noImport).join('\n');
    return lines.concat(noImport).concat([
      lockPose
        ? '  • Keep the person untouched: same pose, same head angle and position, same neck and\n'
          + '    shoulders, same camera angle and focal length as IMAGE 1.'
        : '  • Same person, same framing and distance from camera as IMAGE 1.',
      '',
      'FRAMING & COMPOSITION — standardized and identical for every generated style:',
      '  • Head-and-shoulders crop, subject centered, with the SAME zoom level and the SAME',
      '    vertical head position across all four styles. 3:4 vertical portrait ratio.',
      '  • The subject fills the frame edge to edge — no borders, no padding, no empty margins,',
      '    and absolutely no black bars on any side.',
      '  • Top / clothing: a plain, clean, achromatic (grey/white/black) top, the same neutral',
      '    style across results. Keep the neckline clear of the hair so it never covers or',
      '    interferes with the hairstyle being previewed. Do not change the face, neck or body.',
      '  • HAIR EDGES: cut around the hair naturally — keep individual flyaway strands and the',
      '    soft silhouette. No hard cut-out outline, no white halo, no eroded or blurred edges.',
      '    The hair outline is what the customer is judging, so it must stay crisp and real.',
    ]).join('\n');
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

  // ---- 마무리 보정(피부·자세) -----------------------------------
  //  "얼굴을 바꾸지 마라" 와 정면충돌하는 지시라, 반드시 신원 보존이
  //  우선이라는 걸 못박고 범위를 좁게 준다. 설정에서 끌 수 있다.
  function finishingDirectives(refs) {
    const skin = refs.skinCleanup !== 'none';
    const pose = refs.posture === 'fix';
    const out = [];   // 각도 잠금은 피부 보정을 꺼도 항상 나가야 한다

    // 얼굴 각도는 정체성 그 자체다. 각도가 바뀌면 사람이 바뀐 것처럼 보인다.
    if (!pose) out.push(
      'POSE & ANGLE — locked:',
      "  Keep the customer's pose and camera angle EXACTLY as in IMAGE 1 — same head angle,",
      '  same head tilt, same gaze direction, same shoulders, same framing and distance.',
      '  Do NOT straighten, re-orient, level or re-stage anything. Do not correct a tilt.',
      '  Changing the face angle makes it look like a different person. Leave it alone.',
      '',
    );
    else out.push(
      'POSE — very light correction only:',
      '  Only if the person is severely slouched, nudge the shoulders upright by the smallest',
      "  possible amount. Do NOT change the head angle, head tilt or gaze — those are identity.",
      '  Same framing, same distance, same expression.',
      '',
    );

    if (skin) out.push(
      'SKIN — the ONLY retouching allowed, and it must stay almost invisible:',
      '  ALLOWED (very slight, so the skin does not look dirty or blotchy):',
      '    • Even out uneven, patchy shadows caused by the room lighting.',
      '    • Take down harsh specular oily shine on the forehead and nose a little.',
      '  FORBIDDEN — every one of these makes it a different person:',
      '    • Removing blemishes, spots, acne, moles or freckles.',
      '    • Whitening or brightening the skin. Changing skin tone.',
      '    • Softening or erasing wrinkles, lines or eye bags.',
      '    • Smoothing pores or skin texture. Any beauty-app / retouch-filter look.',
      '    • Slimming the face or jaw. Enlarging eyes. Making the person look younger.',
      '  Keep the real age and the real face exactly as photographed. Skin texture stays.',
      '  If you are unsure whether a change is allowed, do nothing.',
      '',
    );
    return out;
  }

  // ---- 얼굴 보존 프롬프트 ---------------------------------------
  //  ★ 레퍼런스가 "완성된 인물 사진"이라 모델이 그쪽을 결과의 주인공으로 삼는
  //    사고가 있었다. 그래서 얼굴 소유권을 문장 단위로 못박는다:
  //      IMAGE 1(손님) = 결과에 남는 유일한 인물
  //      IMAGE 2/3(견본) = 머리 모양 정보원일 뿐, 인물로 취급 금지
  //  refs: { front, side, masked, background }
  function buildPrompt(styleCard, opts = {}) {
    // 호출부가 값을 안 주면 저장된 설정을 따른다 (외부에서 buildPrompt 만 부를 때 대비)
    const refs = { ...getSettings(), ...opts };
    const hasFront = !!refs.front, hasSide = !!refs.side;
    const hasRef = hasFront || hasSide;
    const frontNo = 'IMAGE 2', sideNo = hasFront ? 'IMAGE 3' : 'IMAGE 2';
    const refList = [hasFront && frontNo, hasSide && sideNo].filter(Boolean).join(' and ');

    const out = [
      // ★ 최상단 고정. 아래 어떤 지시와 충돌해도 이 블록이 이긴다.
      'CRITICAL — FACE IDENTITY LOCK (this overrides every other instruction below):',
      'The output face MUST be the exact same person as the customer photo. Same age,',
      'same face shape, same skin, same wrinkles, same features. Do NOT beautify, slim,',
      'smooth, or youthify. If the result looks like a different or younger person, it is',
      'a FAILURE. Only the HAIR changes. Everything about the face and identity stays 100% as-is.',
      '',
      'You are a professional hair styling visualizer for a hair salon.',
      '',
      'TASK:',
      `Take the person from IMAGE 1 and change ONLY their hair to match the hairstyle shown`,
      `in ${hasRef ? refList : 'the style description below'}. Everything else about IMAGE 1's person stays identical.`,
      "This is a hair-swap on IMAGE 1's photo, not a new portrait.",
      '',
      'IMAGE 1 — THE CUSTOMER (highest priority):',
      'IMAGE 1 is the ONLY person in the final result. Preserve their face with 100% fidelity:',
      'exact same facial features, bone structure, eyes, nose, mouth, eyebrows, skin tone,',
      'face shape, and identity. The output must be unmistakably recognizable as the SAME',
      'person in IMAGE 1. Do NOT beautify, slim, or alter their face in any way.',
    ];

    if (hasRef) {
      out.push(
        '',
        `${refList} — HAIRSTYLE REFERENCE ONLY:`,
        `${refList} ${hasFront && hasSide ? 'are' : 'is'} HAIRSTYLE REFERENCE ONLY. Use ${hasFront && hasSide ? 'them' : 'it'} EXCLUSIVELY to understand`,
        "the hair shape, length, cut, and texture. COMPLETELY IGNORE the reference model's face,",
        'skin, eyes, jaw, and identity. The reference person must NOT appear in the output in any',
        'form. Do not blend, merge, or average the two faces.',
        hasFront ? `  • ${frontNo} = front view — fringe, parting, overall silhouette.` : '',
        hasSide ? `  • ${sideNo} = side view — side/back length, the two-block line, the nape.` : '',
        refs.masked
          ? "  • The reference model's face is deliberately blurred out. Do not reconstruct it, and"
          : '',
        refs.masked
          ? '    do not copy that blur into the result — the customer\'s face stays sharp.'
          : '',
      );
    }

    out.push(
      '',
      'THE HAIRSTYLE TO APPLY:',
      styleDirectives(styleCard),
      '',
      "HAIR COLOR: keep the customer's original hair color. This is a CUT & PERM preview,",
      'not a dye preview — do not lighten, darken or tint the hair.',
      '',
      'HAIRLINE — blend it naturally so the new hair does not look pasted on:',
      '  Blend the new hairline naturally into the forehead. The transition between hair and skin',
      "  at the hairline must be soft and realistic, following the person's actual forehead shape.",
      '  No hard edge, no pasted-on look, no floating hairline. Include natural baby hairs and a',
      '  soft gradient at the hairline.',
      "  Respect the customer's original forehead height and hairline position. Do not raise or",
      '  lower the hairline unnaturally.',
      '',
      ...finishingDirectives(refs),
      backgroundDirectives(refs.background, hasRef, refs.posture !== 'fix'),
      '',
      'FORBIDDEN — the result is invalid if any of these happen:',
      '  • The reference model appears in the output.',
      '  • A second person, or any part of a second person, appears.',
      '  • The two faces are blended, merged or averaged.',
      "  • IMAGE 1's face is replaced, restyled, beautified, slimmed or aged.",
      '  • The person looks YOUNGER, slimmer, smoother-skinned or more "perfect" than IMAGE 1.',
      '  • The face angle, head tilt or gaze direction differs from IMAGE 1.',
      '  • Black bars, letterboxing or empty margins appear on any side of the frame.',
      '  • The background, framing, zoom or clothing differs from the standardized studio look.',
      "  • The hairline looks hard-edged, floating or pasted on instead of blended into the skin.",
      hasRef ? "  • The reference image's background, clothing or body is imported." : '',
      "The customer's face is final.",
      '',
      'GUIDING PRINCIPLE: the only thing that should look obviously different from IMAGE 1',
      'is the HAIR. Everything else changes as little as possible — and the face, not at all.',
      '',
      'Photorealistic salon result. Natural hairline and nape. Do not add text or watermark.',
      'Return one edited image only.',
    );
    return out.filter(Boolean).join('\n');
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

  // ---- 레퍼런스 얼굴 지우기 --------------------------------------
  //  프롬프트로 "견본 얼굴은 무시하라"고 백 번 써도, 완성된 인물 사진이 들어가면
  //  모델이 그 얼굴을 결과의 주인공으로 삼는 사고가 난다. 아예 보내기 전에
  //  얼굴 영역을 지워서 "복사할 얼굴 자체가 없게" 만든다. 머리카락은 건드리지 않는다.
  //  좌표는 내장 카탈로그 구도 기준(정면=중앙, 측면=오른쪽 프로필).
  const FACE_BOX = {
    front: { cx: 0.50, cy: 0.50, rx: 0.21, ry: 0.19 },  // 눈까지 확실히 덮는다
    side: { cx: 0.75, cy: 0.51, rx: 0.16, ry: 0.16 },   // 프로필은 오른쪽에 치우쳐 있다
  };
  async function blurReferenceFace(dataUrl, view) {
    const box = FACE_BOX[view] || FACE_BOX.front;
    const img = await loadImage(dataUrl);
    const W = img.width, H = img.height;

    // 1) 전체를 강하게 흐린 사본
    const blurred = document.createElement('canvas');
    blurred.width = W; blurred.height = H;
    const bx = blurred.getContext('2d');
    bx.filter = `blur(${Math.max(12, Math.round(W * 0.06))}px)`;
    bx.drawImage(img, 0, 0);

    // 2) 흐린 사본을 얼굴 타원으로 오려낸다. 가장자리는 페이드시켜
    //    "붙여넣은 물체"처럼 보이지 않게 한다 (하드 엣지는 모델이 따라 그린다).
    const patch = document.createElement('canvas');
    patch.width = W; patch.height = H;
    const px = patch.getContext('2d');
    px.drawImage(blurred, 0, 0);
    px.globalCompositeOperation = 'destination-in';
    px.translate(W * box.cx, H * box.cy);
    px.scale(W * box.rx, H * box.ry);          // 단위원 → 얼굴 타원
    const g = px.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.70, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    px.fillStyle = g;
    px.fillRect(-1, -1, 2, 2);

    // 3) 원본 위에 합성
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(patch, 0, 0);
    return cv.toDataURL('image/jpeg', 0.92);
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
    // 보내기 전에 견본 모델의 얼굴은 지운다 — 결과에 견본 얼굴이 나오는 사고 방지.
    onProgress && onProgress('ref-load');
    const mask = s.maskRefFace !== false;
    const prep = async (url, view) => {
      if (!url) return null;
      try {
        return await toInlineData(mask ? await blurReferenceFace(url, view) : url);
      } catch (e) {
        console.warn('[LumainGen] 레퍼런스 얼굴 마스킹 실패 → 원본 사용:', e.message);
        return await toInlineData(url);
      }
    };
    const [refFront, refSide] = await Promise.all([
      prep(styleCard.front_image || styleCard.image, 'front'),
      prep(styleCard.side_image, 'side'),
    ]);
    onProgress && onProgress('gemini-request');

    // 이미지마다 바로 앞에 라벨 텍스트를 붙여 어떤 사진인지 명시.
    const reqParts = [{ text: buildPrompt(styleCard, {
      front: !!refFront, side: !!refSide, masked: mask,
      background: s.background, skinCleanup: s.skinCleanup, posture: s.posture,
    }) }];
    reqParts.push({ text: '--- IMAGE 1 · THE CUSTOMER — this face must survive unchanged ---' });
    reqParts.push({ inlineData: { mimeType: mime, data } });
    if (refFront) {
      reqParts.push({ text: '--- IMAGE 2 · HAIRSTYLE REFERENCE, FRONT — hair shape only, NOT a person ---' });
      reqParts.push({ inlineData: refFront });
    }
    if (refSide) {
      reqParts.push({ text: `--- IMAGE ${refFront ? 3 : 2} · HAIRSTYLE REFERENCE, SIDE — hair shape only, NOT a person ---` });
      reqParts.push({ inlineData: refSide });
    }
    // 마지막 한마디. 이미지 뒤에 다시 못박아야 직전 이미지(견본)에 끌려가지 않는다.
    reqParts.push({ text:
      'FINAL CHECK before you output: the face must be the SAME PERSON as IMAGE 1 — same age, ' +
      'same face shape, same skin and wrinkles, same angle and tilt. Not younger, not slimmer, ' +
      'not smoothed.' +
      (refFront || refSide
        ? ' The reference model must not appear. Only the HAIRSTYLE comes from the reference.'
        : ' Only the HAIR changes.') });

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
    // 배경 정리(누끼)는 실제 생성에서만 된다. 데모는 원본 배경 그대로이므로
    // "누끼가 안 먹혔다"는 오해가 없게 화면에 적어둔다.
    if (getSettings().background !== 'keep') {
      ctx.fillStyle = 'rgba(238,241,245,.6)';
      ctx.font = '500 13px Pretendard, "Noto Sans KR"';
      ctx.fillText('배경 정리(누끼)는 Gemini 키 연결 시 적용됩니다', 18, 82);
    }

    return cv.toDataURL('image/jpeg', 0.92);
  }

  // ---- 결과 프레임 정규화 (통일된 3:4 세로컷) -------------------
  //  프롬프트로 "3:4·검은 여백 금지"를 못박아도 모델이 정사각/가로로 뱉거나
  //  좌우에 검은 여백을 넣는 경우가 있다. 마지막에 결정적으로 한 번 더 맞춘다:
  //    • 모든 컷을 동일한 3:4 세로 캔버스로 → 4장 비교 시 비율이 통일된다.
  //    • cover 맞춤(상단 정렬)으로 프레임을 꽉 채워 좌우/상하 검은 여백을 잘라낸다.
  //      머리·헤어라인은 상단에 있으므로 남는 부분은 어깨 아래에서만 잘린다.
  //    • 남는 자투리는 스튜디오 라이트그레이로 채워, 혹시 생겨도 검은 띠가 아니게 한다.
  const OUT_W = 900, OUT_H = 1200;      // 3:4
  const STUDIO_GREY = '#d7dbe0';        // styles.css .stage-img 배경과 맞춘다
  async function normalizePortrait(dataUrl) {
    const img = await loadImage(dataUrl);
    const cv = document.createElement('canvas');
    cv.width = OUT_W; cv.height = OUT_H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = STUDIO_GREY;
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    // cover: 캔버스를 완전히 덮는 최소 배율. 세로컷이면 아래(어깨)가, 정사각/가로면
    // 좌우(=검은 여백이 있던 자리)가 잘려나간다. 인물은 중앙, 머리는 상단 유지.
    const s = Math.max(OUT_W / img.width, OUT_H / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (OUT_W - dw) / 2, 0, dw, dh);
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
    // 4컷 비율·구도 통일 + 좌우 검은 여백 제거. 'keep' 은 원본 구도 보존이 목적이라 건드리지 않는다.
    if (getSettings().background !== 'keep') {
      try { raw = await normalizePortrait(raw); }
      catch (e) { console.warn('[LumainGen] 프레임 정규화 실패 → 원본 비율 유지:', e.message); }
    }
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

  migrateModel();
  migrateRetouch();

  return { generatePreview, getSettings, saveSettings, usingGemini, buildPrompt, DEFAULTS };
})();
