/* =========================================================
   data.js — 스타일 카드 카탈로그 + 크레딧 (localStorage)
   ---------------------------------------------------------
   · STYLE_CARDS 배열 = 서비스에 내장된 "스타일 견본" 카탈로그(원장이 손님에게
     보여줄 레퍼런스). 스타일이 늘어나면 이 배열에 객체만 추가하면 된다.
   · gender 필드로 남성/여성 필터가 가능 (지금은 남성 위주, 여성은 이후 추가).
   · 원장이 직접 올리는 커스텀 카드는 localStorage(매장별 격리)에 따로 저장.
   · 2단계에서 이 계층만 서버 API로 바꾸면 됨.

   [스타일 카드 스키마]
     {
       id,            // 고유 id (문자열)
       name_ko,       // 한글 스타일명   예: "투블럭 다운펌"
       name_en,       // 영문 스타일명   예: "Two Block Down Perm"
       gender,        // 'male' | 'female'
       front_image,   // 정면 컷 경로 (대표 썸네일) — 앞머리·가르마·전체 인상
       side_image,    // 측면 컷 경로 — 옆·뒤 길이 + 투블럭 라인
       tags,          // { length, perm, difficulty }
       prompt_params, // AI 생성 시 쓸 스타일 지시문 (다음 단계에서 사용)
     }
   ========================================================= */

const LumainData = (() => {
  const SALON_ID = 'salon_demo';                 // 2단계: 로그인한 매장 계정으로 대체
  const CARDS_KEY = `lumain_cards_${SALON_ID}`;  // 원장 커스텀 카드 (localStorage)
  const CREDIT_KEY = `lumain_credit_${SALON_ID}`;

  // 이미지 기본 경로 (public/images 아래).
  // ※ index.html 이 저장소 루트에서 서빙되므로 "public/images/..." 상대경로를 쓴다.
  //   (선행 슬래시 "/images/..." 는 GitHub Pages 프로젝트 경로 /AIHaitcut/ 에서 깨진다)
  const IMG = 'public/images';

  // ---- 태그 옵션 (남성 헤어 문법) -----------------------------
  const TAG_OPTIONS = {
    length: ['숏', '미디엄', '미디엄 롱', '롱'],
    perm: ['다운펌', '가르마펌', '애즈펌', '리프펌', '쉐도우펌', '리젠트펌', '내추럴펌', '없음'],
    difficulty: ['쉬움', '보통', '고난도'],
  };

  // =========================================================
  //  STYLE_CARDS — 내장 스타일 카탈로그 (여기에 객체만 추가하면 늘어난다)
  //  각 스타일 = 정면(_1) + 측면(_2) 2장 한 세트.
  // =========================================================
  const STYLE_CARDS = [
    {
      id: 'm_two_block_down',
      name_ko: '투블럭 다운펌',
      name_en: 'Two Block Down Perm',
      gender: 'male',
      front_image: `${IMG}/1_1.webp`,
      side_image: `${IMG}/1_2.webp`,
      tags: { length: '숏', perm: '다운펌', difficulty: '보통' },
      prompt_params: {
        cut: 'two block cut, trimmed and tapered sides and back',
        top: 'natural down-perm fringe pressed softly down over the forehead',
        finish: 'clean, neat, matte natural volume',
        keywords: ['two block', 'down perm', 'clean cut', 'natural fringe'],
      },
    },
    {
      id: 'm_garma_perm',
      name_ko: '가르마펌',
      name_en: 'Side-Part Perm',
      gender: 'male',
      front_image: `${IMG}/2_1.webp`,
      side_image: `${IMG}/2_2.webp`,
      tags: { length: '미디엄', perm: '가르마펌', difficulty: '보통' },
      prompt_params: {
        cut: 'medium length with tapered two-block sides',
        top: 'defined side part with S-curl, side-swept fringe and forehead-lifting volume',
        finish: 'soft flowing texture, dandy mood',
        keywords: ['side part perm', 'garma perm', 'side swept', 'volume'],
      },
    },
    {
      id: 'm_leaf_cut',
      name_ko: '리프컷',
      name_en: 'Leaf Cut',
      gender: 'male',
      front_image: `${IMG}/3_1.webp`,
      side_image: `${IMG}/3_2.webp`,
      tags: { length: '미디엄', perm: '리프펌', difficulty: '고난도' },
      prompt_params: {
        cut: 'layered leaf-shaped cut, airy textured layers, tapered sides',
        top: 'light feathered fringe with movement, volume on the crown',
        finish: 'airy, textured, trendy',
        keywords: ['leaf cut', 'layered', 'textured', 'airy volume'],
      },
    },
    {
      id: 'm_as_perm',
      name_ko: '애즈펌',
      name_en: 'As Perm',
      gender: 'male',
      front_image: `${IMG}/4_1.webp`,
      side_image: `${IMG}/4_2.webp`,
      tags: { length: '미디엄', perm: '애즈펌', difficulty: '보통' },
      prompt_params: {
        cut: 'medium length with clean two-block sides',
        top: 'natural loose S-curls throughout, softly curled side-swept front',
        finish: 'natural wavy texture, relaxed volume',
        keywords: ['as perm', 'natural curl', 's-curl', 'soft wave'],
      },
    },
    {
      id: 'm_crop_cut',
      name_ko: '크롭컷',
      name_en: 'Crop Cut',
      gender: 'male',
      front_image: `${IMG}/5_1.webp`,
      side_image: `${IMG}/5_2.webp`,
      tags: { length: '숏', perm: '없음', difficulty: '쉬움' },
      prompt_params: {
        cut: 'short crop cut, tightly tapered faded sides and back',
        top: 'short blunt fringe brought straight forward onto the forehead, choppy texture on top',
        finish: 'matte, sharp, clean-cut',
        keywords: ['crop cut', 'french crop', 'blunt fringe', 'matte texture'],
      },
    },
    {
      id: 'm_comma_hair',
      name_ko: '쉼표머리',
      name_en: 'Comma Hair',
      gender: 'male',
      front_image: `${IMG}/6_1.webp`,
      side_image: `${IMG}/6_2.webp`,
      tags: { length: '미디엄', perm: '애즈펌', difficulty: '보통' },
      prompt_params: {
        cut: 'medium length with tapered two-block sides',
        top: 'front fringe curled into a comma shape, sweeping to one side across the forehead',
        finish: 'soft glossy curve, youthful mood',
        keywords: ['comma hair', 'comma bang', 'c-curl fringe', 'side sweep'],
      },
    },
    {
      id: 'm_slick_back',
      name_ko: '슬릭백',
      name_en: 'Slick Back',
      gender: 'male',
      front_image: `${IMG}/7_1.webp`,
      side_image: `${IMG}/7_2.webp`,
      tags: { length: '미디엄', perm: '없음', difficulty: '보통' },
      prompt_params: {
        cut: 'medium length on top with tightly tapered sides and back',
        top: 'all hair combed straight back away from the face, forehead fully exposed',
        finish: 'sleek, glossy, controlled',
        keywords: ['slick back', 'combed back', 'exposed forehead', 'glossy'],
      },
    },
    {
      id: 'm_hippie_perm',
      name_ko: '히피펌',
      name_en: 'Hippie Perm',
      gender: 'male',
      front_image: `${IMG}/8_1.webp`,
      side_image: `${IMG}/8_2.webp`,
      tags: { length: '미디엄', perm: '내추럴펌', difficulty: '고난도' },
      prompt_params: {
        cut: 'medium length all over, layered',
        top: 'dense small spiral curls throughout with large natural volume',
        finish: 'voluminous, airy, casually tousled',
        keywords: ['hippie perm', 'spiral curl', 'tight curls', 'big volume'],
      },
    },
    {
      id: 'm_short_hippie_perm',
      name_ko: '숏히피펌',
      name_en: 'Short Hippie Perm',
      gender: 'male',
      front_image: `${IMG}/9_1.webp`,
      side_image: `${IMG}/9_2.webp`,
      tags: { length: '숏', perm: '내추럴펌', difficulty: '고난도' },
      prompt_params: {
        cut: 'short length, layered, with tapered sides',
        top: 'compact tight curls with rounded volume on top, short curled fringe',
        finish: 'neat, springy, controlled volume',
        keywords: ['short hippie perm', 'short spiral curl', 'compact curls'],
      },
    },
  ];

  // ---- 정규화: 렌더 코드(app.js)가 쓰는 name/image 별칭을 붙여준다 ----
  //   기존 UI 코드는 c.name, c.image 를 참조하므로 호환용으로 매핑.
  function normalize(c) {
    return {
      ...c,
      name: c.name || c.name_ko,            // 표시용 한글명
      image: c.image || c.front_image || '',// 대표 썸네일 = 정면
      desc: c.desc || c.name_en || '',      // 부제(영문명)
    };
  }

  // ---- 원장 커스텀 카드 (localStorage) ----------------------
  function uid() { return 'c_' + Math.abs(hashStr(JSON.stringify(arguments) + performance.now() + Object.keys(loadUser()).length)).toString(36); }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  function loadUser() {
    try {
      const raw = localStorage.getItem(CARDS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return {};
  }
  function saveUser(map) { localStorage.setItem(CARDS_KEY, JSON.stringify(map)); }

  // ---- 레거시 시드 정리 (브라우저별 1회) ---------------------
  //  이전 버전은 첫 실행 때 여성 더미 카드 4장(seed_0~3)을 localStorage 에
  //  심었다. 사진이 없어서(image:'') 카드가 라인 실루엣으로 떴고, 성별
  //  필드도 없어서 남성 메뉴에까지 섞여 나왔다. 남성 카탈로그로 개편됐으니
  //  "사진 없는 옛 시드"만 골라 지운다. (원장이 올린 카드는 건드리지 않는다)
  const MIGRATED_KEY = `lumain_seed_purged_${SALON_ID}`;
  const LEGACY_SEED_NAMES = [
    '레이어드 단발 · 애쉬브라운', '허쉬컷 · 다크브라운',
    '내추럴 롱 · 밀크브라운', '숏 히피펌 · 애쉬그레이',
  ];
  function purgeLegacySeed() {
    try {
      if (localStorage.getItem(MIGRATED_KEY)) return;
      const map = loadUser();
      let removed = 0;
      Object.keys(map).forEach(id => {
        const c = map[id] || {};
        const noPhoto = !c.image && !c.front_image;
        if (noPhoto && (/^seed_\d+$/.test(id) || LEGACY_SEED_NAMES.includes(c.name))) {
          delete map[id]; removed++;
        }
      });
      if (removed) { saveUser(map); console.info(`[LumainData] 옛 더미 카드 ${removed}장 정리`); }
      localStorage.setItem(MIGRATED_KEY, '1');
    } catch {}
  }

  // =========================================================
  //  조회 API
  //  listCards()                 → 카탈로그 + 커스텀 전체
  //  listCards({ gender:'male' })→ 해당 성별 카탈로그 + 커스텀
  // =========================================================
  function listCards(opts = {}) {
    const builtin = STYLE_CARDS
      .filter(c => !opts.gender || c.gender === opts.gender)
      .map(normalize);
    // 성별이 없는 옛 카드는 'male' 로 간주한다. (예전엔 성별 없으면 모든
    //  필터를 통과해서 여성 더미가 남성 메뉴에 섞여 나왔다)
    const custom = Object.values(loadUser())
      .filter(c => !opts.gender || (c.gender || 'male') === opts.gender)
      .map(normalize);
    return [...builtin, ...custom];
  }
  function getCard(id) {
    const b = STYLE_CARDS.find(c => c.id === id);
    if (b) return normalize(b);
    const u = loadUser()[id];
    return u ? normalize(u) : null;
  }
  function isBuiltin(id) { return STYLE_CARDS.some(c => c.id === id); }

  // 커스텀 카드만 추가/수정/삭제 (내장 카탈로그는 읽기 전용)
  //  · 내장 id 로 저장을 시도하면 새 id 를 발급해 사본으로 만든다.
  //  · 빈 값 키는 버려서 normalize() 의 폴백(image←front_image)이 정상 동작하게 한다.
  //  · 저장 한도를 넘기면 localStorage 가 던지는 예외를 그대로 올린다(호출부에서 안내).
  function upsertCard(card) {
    const map = loadUser();
    const id = card.id && !isBuiltin(card.id) ? card.id : uid();
    const clean = {};
    Object.entries(card).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      if (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) return;
      clean[k] = v;
    });
    map[id] = { gender: 'male', ...clean, id };  // 기본 gender=male (지금은 남성 위주)
    saveUser(map);
    return normalize(map[id]);
  }
  function deleteCard(id) {
    if (isBuiltin(id)) return false;             // 내장 카탈로그는 삭제 불가
    const map = loadUser(); delete map[id]; saveUser(map); return true;
  }

  // ---- 크레딧 ----
  function getCredit() {
    const v = localStorage.getItem(CREDIT_KEY);
    if (v === null) { localStorage.setItem(CREDIT_KEY, '50'); return 50; }
    return parseInt(v, 10) || 0;
  }
  function setCredit(n) { localStorage.setItem(CREDIT_KEY, String(Math.max(0, n))); return getCredit(); }
  // 생성 성공 시에만 차감 (실패는 미차감 — 기획서 6절)
  function chargeCredit(n = 1) { return setCredit(getCredit() - n); }
  function addCredit(n) { return setCredit(getCredit() + n); }

  purgeLegacySeed();   // 조회 전에 옛 더미 카드부터 걷어낸다

  return {
    TAG_OPTIONS, STYLE_CARDS,
    listCards, getCard, isBuiltin, upsertCard, deleteCard,
    getCredit, setCredit, chargeCredit, addCredit, SALON_ID,
  };
})();
