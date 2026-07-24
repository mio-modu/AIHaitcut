/* =========================================================
   data.js — 스타일 카드 DB + 크레딧 (localStorage)
   매장별 데이터 격리를 흉내내기 위해 salonId 네임스페이스 사용.
   2단계에서 이 계층만 서버 API로 바꾸면 됩니다.
   ========================================================= */

const LumainData = (() => {
  const SALON_ID = 'salon_demo';                 // 2단계: 로그인한 매장 계정으로 대체
  const CARDS_KEY = `lumain_cards_${SALON_ID}`;
  const CREDIT_KEY = `lumain_credit_${SALON_ID}`;

  // 태그 옵션 (착용컷의 카테고리별 문법과 동일한 구조)
  const TAG_OPTIONS = {
    length: ['숏', '단발', '미디엄', '롱'],
    color: ['블랙', '다크 브라운', '내추럴 브라운', '애쉬 브라운', '밀크 브라운', '애쉬 그레이', '레드 브라운', '블론드'],
    perm: ['생머리', 'C컬', 'S컬', '히피펌', '빌드펌', '레이어드', '허쉬컷'],
    difficulty: ['쉬움', '보통', '고난도'],
  };

  // 초기 시드 카드 (원장이 자기 시술컷으로 교체/추가)
  const SEED = [
    { name: '레이어드 단발 · 애쉬브라운', desc: '얼굴형을 부드럽게 감싸는 C컬 마무리',
      tags: { length: '단발', color: '애쉬 브라운', perm: 'C컬', difficulty: '보통' }, image: '' },
    { name: '허쉬컷 · 다크브라운', desc: '자연스러운 층과 볼륨',
      tags: { length: '미디엄', color: '다크 브라운', perm: '허쉬컷', difficulty: '보통' }, image: '' },
    { name: '내추럴 롱 · 밀크브라운', desc: '결 고운 롱 웨이브',
      tags: { length: '롱', color: '밀크 브라운', perm: 'S컬', difficulty: '쉬움' }, image: '' },
    { name: '숏 히피펌 · 애쉬그레이', desc: '개성 있는 볼륨 숏',
      tags: { length: '숏', color: '애쉬 그레이', perm: '히피펌', difficulty: '고난도' }, image: '' },
  ];

  function uid() { return 'c_' + Math.abs(hashStr(JSON.stringify(arguments) + performance.now() + Object.keys(load()).length)).toString(36); }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  function load() {
    try {
      const raw = localStorage.getItem(CARDS_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    // 첫 실행: 시드 주입
    const seeded = {};
    SEED.forEach((c, i) => { const id = 'seed_' + i; seeded[id] = { id, ...c }; });
    localStorage.setItem(CARDS_KEY, JSON.stringify(seeded));
    return seeded;
  }
  function save(map) { localStorage.setItem(CARDS_KEY, JSON.stringify(map)); }

  function listCards() { return Object.values(load()).sort((a, b) => (a.name > b.name ? 1 : -1)); }
  function getCard(id) { return load()[id] || null; }
  function upsertCard(card) {
    const map = load();
    const id = card.id || uid();
    map[id] = { ...card, id };
    save(map);
    return map[id];
  }
  function deleteCard(id) { const map = load(); delete map[id]; save(map); }

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

  return {
    TAG_OPTIONS, listCards, getCard, upsertCard, deleteCard,
    getCredit, setCredit, chargeCredit, addCredit, SALON_ID,
  };
})();
