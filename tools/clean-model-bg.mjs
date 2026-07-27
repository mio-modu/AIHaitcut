/* =========================================================
   clean-model-bg.mjs — 모델컷 배경을 균일한 스튜디오 그레이로 정리
   ---------------------------------------------------------
   내장 카탈로그의 모델컷(public/images/N_1.webp, N_2.webp)은 AI 로 생성한
   것이라 배경에 흰 패널·밝은 얼룩·기하 도형이 섞여 있다. 카드가 지저분해
   보일 뿐 아니라, 이 사진들은 헤어 레퍼런스로 Gemini 에 그대로 전송되므로
   배경 요소가 결과컷에까지 번질 수 있다.

   이 스크립트는 각 모델컷을 Gemini 이미지 편집 모델에 통과시켜
   "인물·헤어·구도는 그대로, 배경만 균일한 라이트그레이" 로 바꾼다.

   [실행]
     node tools/clean-model-bg.mjs --key <GEMINI_API_KEY>
     node tools/clean-model-bg.mjs --key <KEY> --only 5_1      # 1장만 시험
     node tools/clean-model-bg.mjs --dry-run                   # 대상만 확인

   [주의]
     · 원장님 Gemini 크레딧이 장당 1회 소모된다 (18장 = 18회).
       먼저 --only 로 1장 해보고 결과가 마음에 들면 전체를 돌리세요.
     · 원본은 _original_images/before-bg/ 에 자동 백업된다. 마음에 안 들면
       그 폴더에서 되돌리면 된다.
     · 결과물에도 생성 워터마크가 다시 찍히므로, 받은 뒤 아래 10% 를 잘라
       3:4 / 768x1024 로 다시 맞춘다 (카탈로그 규격과 동일).
     · ImageMagick(magick) 이 PATH 에 있어야 한다.
   ========================================================= */

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const IMG = path.join(ROOT, 'public', 'images');
const BACKUP = path.join(ROOT, '_original_images', 'before-bg');

// ---- 인자 ----
const argv = process.argv.slice(2);
const arg = (name, def = null) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const has = name => argv.includes('--' + name);

const KEY = arg('key') || process.env.GEMINI_API_KEY || '';
const ONLY = arg('only');
const DRY = has('dry-run');
// 일회성 정리 작업이라 라이트 모델보다 품질 우선 모델을 기본으로 쓴다.
const MODEL = arg('model', 'gemini-3.1-flash-image');

// ---- 배경 정리 프롬프트 ----
// 인물을 건드리지 않는 것이 핵심. 헤어 경계를 누끼처럼 따내지 말라고 못박는다.
const PROMPT = [
  "Using the attached image, keep the person's face, hairstyle, pose, and framing exactly the same.",
  'Only change the background: replace the entire background with a clean, uniform, plain light-grey',
  'studio background (a single flat even tone). Remove all white boxes, panels, light patches, and any',
  'objects in the background. Keep the hair edges natural and soft — do NOT cut out the hair or create',
  'a hard outline. Photorealistic, seamless, professional beauty-salon reference photo style, 3:4 ratio.',
  '',
  'Do NOT change the face, the hairstyle, the head angle, the clothing, or how much of the person is',
  'in the frame. This is a hairstyle reference photo — the hair silhouette and texture must survive',
  'exactly as they are. No black bars, no letterboxing, no borders.',
].join('\n');

// 카탈로그 규격 (crop 규칙은 README 의 모델컷 항목과 동일)
const BOTTOM_CUT = 0.10, OUT_W = 768, OUT_H = 1024;

const targets = [];
for (let n = 1; n <= 9; n++) for (const v of [1, 2]) targets.push(`${n}_${v}`);
const list = ONLY ? targets.filter(t => t === ONLY) : targets;

if (!list.length) {
  console.error(`대상이 없습니다. --only 값을 확인하세요: ${ONLY}`);
  process.exit(1);
}

console.log(`대상 ${list.length}장${ONLY ? ` (${ONLY} 만)` : ''} · 모델 ${MODEL}`);
if (DRY) {
  list.forEach(t => console.log('  -', t + '.webp'));
  console.log('\n--dry-run 이라 실제 호출은 하지 않았습니다.');
  process.exit(0);
}
if (!KEY) {
  console.error('Gemini API 키가 없습니다. --key <KEY> 또는 환경변수 GEMINI_API_KEY 를 쓰세요.');
  process.exit(1);
}

async function dims(file) {
  const { stdout } = await run('magick', ['identify', '-format', '%w %h', file]);
  const [w, h] = stdout.trim().split(/\s+/).map(Number);
  return { w, h };
}

// 생성 결과를 카탈로그 규격(3:4 · 768x1024)으로 되돌린다.
// 아래를 잘라내는 것은 재생성본에 다시 찍히는 워터마크를 지우기 위함.
async function normalize(src, dst) {
  const { w, h } = await dims(src);
  let ch = Math.round(h * (1 - BOTTOM_CUT));
  let cw = Math.round(ch * 0.75);
  if (cw > w) { cw = w; ch = Math.round(w / 0.75); }
  const x = Math.floor((w - cw) / 2);
  await run('magick', [src, '-crop', `${cw}x${ch}+${x}+0`, '+repage',
                       '-resize', `${OUT_W}x${OUT_H}`, '-quality', '82', dst]);
}

async function callGemini(b64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}`
            + `:generateContent?key=${encodeURIComponent(KEY)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: PROMPT },
        { inlineData: { mimeType: 'image/webp', data: b64 } },
      ] }],
      // 배경만 바꾸는 작업이라 temperature 를 낮게 — 인물이 흔들리면 안 된다.
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.2 },
    }),
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.json())?.error?.message || ''; } catch {}
    throw new Error(`Gemini ${resp.status}: ${detail || resp.statusText}`);
  }
  const json = await resp.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const p = parts.find(x => x.inline_data?.data || x.inlineData?.data);
  if (!p) {
    const txt = parts.find(x => x.text)?.text || '';
    throw new Error('이미지가 반환되지 않았습니다. ' + (txt ? `(${txt.slice(0, 120)})` : ''));
  }
  const inline = p.inline_data || p.inlineData;
  return Buffer.from(inline.data, 'base64');
}

await mkdir(BACKUP, { recursive: true });
const tmpDir = path.join(BACKUP, '_tmp');
await mkdir(tmpDir, { recursive: true });

let ok = 0;
const failed = [];

for (const key of list) {
  const file = path.join(IMG, key + '.webp');
  if (!existsSync(file)) { console.log(`  ${key}  건너뜀 (파일 없음)`); continue; }

  process.stdout.write(`  ${key}  … `);
  try {
    // 원본 백업은 최초 1회만 (여러 번 돌려도 진짜 원본이 덮이지 않게)
    const bak = path.join(BACKUP, key + '.webp');
    if (!existsSync(bak)) await copyFile(file, bak);

    const b64 = (await readFile(file)).toString('base64');
    const out = await callGemini(b64);

    const raw = path.join(tmpDir, key + '.raw.png');
    await writeFile(raw, out);
    await normalize(raw, file);

    const { w, h } = await dims(file);
    console.log(`완료 (${w}x${h})`);
    ok++;
  } catch (e) {
    console.log('실패 — ' + e.message);
    failed.push(key);
  }
}

console.log(`\n성공 ${ok} / ${list.length}`);
if (failed.length) console.log('실패: ' + failed.join(', ') + '  (해당 파일은 원본 그대로입니다)');
console.log(`원본 백업: ${path.relative(ROOT, BACKUP)}`);
console.log('되돌리려면 백업 폴더의 파일을 public/images/ 로 덮어쓰면 됩니다.');
