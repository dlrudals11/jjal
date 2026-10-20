// script.js — my 짤 번역기
// data.js의 jjalData를 사용합니다. (index.html에서 data.js가 먼저 불러와져야 해요)

// ================= 1. 한글 도우미 =================

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const IEUNG = 11; // 초성 'ㅇ'
// 어미가 붙을 때 어간 모음이 바뀌는 경우 (모음 번호: ㅏ0 ㅐ1 ㅓ4 ㅕ6 ㅗ8 ㅘ9 ㅜ13 ㅝ14 ㅡ18 ㅣ20)
// 예: 지치+었다 → 지쳤다(ㅣ→ㅕ), 슬프+어 → 슬퍼(ㅡ→ㅓ), 망하+였다 → 망했다(ㅏ→ㅐ)
const VOWEL_CHANGES = { 0: [1], 8: [9], 13: [14], 18: [4], 20: [6] };

// 한글 글자 하나를 초성/중성/종성 번호로 쪼개기 (한글이 아니면 null)
function syllableInfo(ch) {
  const code = ch.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return null;
  const n = code - HANGUL_START;
  return { initial: Math.floor(n / 588), vowel: Math.floor((n % 588) / 28), final: n % 28 };
}

// 공백, 특수문자를 지우고 소문자로 바꿔서 비교하기 쉽게 만들기
function normalize(text) {
  return String(text).toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]/g, "");
}

// 어간 키워드 느슨하게 찾기
// "지치" → 지쳤다/지친/지쳐, "화나" → 화났다/화난, "고마" → 고맙다/고마워
function looseIncludes(text, keyword) {
  if (keyword.length < 2) return false;
  const last = syllableInfo(keyword[keyword.length - 1]);
  // 받침 없는 한글로 끝나는 어간만 처리 (초성 ㅇ은 구분이 어려워 제외)
  if (!last || last.final !== 0 || last.initial === IEUNG) return false;

  const stem = keyword.slice(0, -1);
  let from = 0;
  while (true) {
    const idx = text.indexOf(stem, from);
    if (idx === -1) return false;
    const next = text[idx + stem.length];
    const info = next ? syllableInfo(next) : null;
    if (
      info &&
      info.initial === last.initial &&
      (info.vowel === last.vowel || (VOWEL_CHANGES[last.vowel] || []).includes(info.vowel))
    ) {
      return true;
    }
    from = idx + 1;
  }
}

// 글자를 두 개씩 묶은 집합 만들기 ("지쳤다" → 지쳤, 쳤다)
function bigrams(text) {
  const set = new Set();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
}

// 두 집합이 얼마나 비슷한지 0~1 사이 숫자로
function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  a.forEach(x => {
    if (b.has(x)) shared++;
  });
  return (2 * shared) / (a.size + b.size);
}

// ================= 2. 검색(짤 고르기) 로직 =================

const MAX_RESULTS = 6;   // 한 번에 보여줄 최대 짤 개수
const MIN_SHOW = 3;      // 최소로 채워서 보여줄 개수
const MIN_SCORE = 2;     // 이 점수 미만이면 "관련 없음"으로 봄
const KEEP_RATIO = 0.35; // 1등 점수의 35% 미만인 짤은 제외
const GREAT_SCORE = 10;  // 이 점수 이상이면 "찰떡" 표시

// 미리 계산해 두기: 각 짤의 키워드/예시 문장, 그리고 키워드 희소성(IDF)
const prepared = jjalData.map(item => ({
  item,
  keywords: [...new Set(item.keywords.map(normalize).filter(Boolean))],
  phrases: item.phrases.map(p => {
    const n = normalize(p);
    return { n, b: bigrams(n) };
  })
}));

const docFreq = new Map();
prepared.forEach(p => p.keywords.forEach(k => docFreq.set(k, (docFreq.get(k) || 0) + 1)));
// 여러 짤에 흔하게 나오는 단어일수록 점수를 낮추고, 한 짤에만 있는 단어는 높게
function keywordWeight(k) {
  const idf = Math.log(prepared.length / docFreq.get(k)) + 1;
  return (1 + Math.min(k.length, 4) * 0.5) * idf;
}

function scoreItem(inputText, inputBigrams, entry) {
  // 1) 키워드: 입력 안에 들어 있으면 가산점
  const hits = entry.keywords.filter(k => inputText.includes(k) || looseIncludes(inputText, k));
  hits.sort((a, b) => b.length - a.length);
  const kept = [];
  for (const k of hits) {
    // "스티커"와 "스티커사진"처럼 겹치면 긴 쪽만 센다
    if (!kept.some(o => o.includes(k))) kept.push(k);
  }
  let score = kept.reduce((sum, k) => sum + keywordWeight(k), 0);

  // 2) 예시 문장과 비슷할수록 가산점
  let best = 0;
  for (const p of entry.phrases) {
    if (p.n.length >= 3 && inputText.length >= 3 && (inputText.includes(p.n) || p.n.includes(inputText))) {
      best = 1;
      break;
    }
    best = Math.max(best, similarity(inputBigrams, p.b));
  }
  if (best >= 0.3) score += best * 10;

  return score;
}

// 무작위로 count개 뽑기 (exclude에 있는 짤은 제외)
function pickRandom(count, exclude = []) {
  const copy = jjalData.filter(item => !exclude.includes(item));
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

// 입력 문장에 어울리는 짤 찾기
// sem: AI 점수 목록(없으면 키워드 검색만 사용). geminiScores()의 결과와 같은 순서예요.
// 반환: { matched: [{item, score, kw, sem, raw}], filler: [item], isRandom }
function findJjal(query, sem = null) {
  const inputText = normalize(query);
  if (!inputText) return { matched: [], filler: [], isRandom: false };

  const inputBigrams = bigrams(inputText);
  const scored = [];
  prepared.forEach((entry, idx) => {
    const kw = scoreItem(inputText, inputBigrams, entry);
    const ai = sem ? sem[idx] : { score: 0, raw: 0 };
    const score = kw + ai.score;
    if (score >= MIN_SCORE) {
      // 점수가 같을 때 매번 다른 순서가 나오도록 아주 작은 랜덤값을 더함
      scored.push({ item: entry.item, score, kw, sem: ai.score, raw: ai.raw, sortKey: score + Math.random() * 0.01 });
    }
  });

  if (scored.length === 0) {
    return { matched: [], filler: pickRandom(3), isRandom: true };
  }

  scored.sort((a, b) => b.sortKey - a.sortKey);
  const top = scored[0].score;
  let picked = scored.filter(s => s.score >= top * KEEP_RATIO);
  if (picked.length < MIN_SHOW) picked = scored.slice(0, MIN_SHOW);
  const matched = picked.slice(0, MAX_RESULTS).map(s => ({
    item: s.item, score: s.score, kw: s.kw, sem: s.sem, raw: s.raw
  }));

  // 딱 맞는 게 너무 적으면 랜덤으로 채우기
  const filler =
    matched.length < MIN_SHOW
      ? pickRandom(MIN_SHOW - matched.length, matched.map(m => m.item))
      : [];

  return { matched, filler, isRandom: false };
}

// ================= 2-2. AI 검색 (Google Gemini, Cloudflare Worker 경유) =================
// 입력 문장과 짤 목록을 내 Cloudflare Worker로 보내면, Worker가 Gemini를 대신 불러서
// "어울리는 짤"을 골라 줘요. 그 점수를 키워드 점수에 더해요.
// API 키는 이 파일에 없어요. Worker의 비밀값에만 있어요. (그래서 GitHub에 올려도 안전해요)
// 주소가 비어 있거나 호출이 실패하면 키워드 검색만 써요.

// ★ 여기에 내 Worker 주소를 붙여넣으세요 (따옴표 안에, 예: "https://jjal-ai.내계정.workers.dev")
const AI_ENDPOINT = "https://jjal-ai.jjal-test.workers.dev";
const GEMINI_TIMEOUT_MS = 12000; // 이 시간 안에 답이 없으면 키워드 결과만 보여줌
const GEMINI_POINTS = 1.5;       // AI 점수(1~10) 1점당 더해지는 점수

const DEBUG = new URLSearchParams(location.search).has("debug"); // 주소 뒤에 ?debug=1 이면 점수 표시
const AI = {
  enabled: AI_ENDPOINT.trim() !== "",
  cooldownUntil: 0,   // 사용량 한도에 걸렸을 때 잠시 쉬는 시간
  cache: new Map(),   // 같은 문장은 다시 묻지 않고 저장된 결과를 씀
  pending: new Map(), // 지금 묻는 중인 문장 (같은 문장을 두 번 묻지 않게)
  lastRaw: ""         // Gemini가 마지막으로 보낸 답 (?debug=1 확인용)
};

// Gemini의 답에서 picks 목록을 꺼내기 (코드블록이나 다른 모양이 섞여도 최대한 읽음)
function parsePicks(raw) {
  const text = raw.replace(/```json|```/g, "").trim();
  const fail = () => {
    const err = new Error("응답을 해석하지 못함: " + text.slice(0, 80));
    err.parse = true;
    return err;
  };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const m = text.match(/[\[{][\s\S]*[\]}]/);
    if (!m) throw fail();
    try {
      data = JSON.parse(m[0]);
    } catch (e2) {
      throw fail();
    }
  }
  return Array.isArray(data) ? data : data.picks || data.results || [];
}

// 짤 목록 (Worker가 자기 지시문과 합쳐서 Gemini에 보내요. 지시문은 worker.js에 있어요)
const CATALOG = jjalData
  .map((item, i) => (i + 1) + ". " + item.desc + " / 예시: " + item.phrases.join(" | "))
  .join("\n");

// 같은 문장은 한 번만 묻게 감싼 함수 (펀치 연출 중에 미리 물어볼 때 필요해요)
function geminiScores(text) {
  if (AI.cache.has(text)) return Promise.resolve(AI.cache.get(text));
  if (AI.pending.has(text)) return AI.pending.get(text);
  const p = fetchGeminiScores(text);
  AI.pending.set(text, p);
  const done = () => AI.pending.delete(text);
  p.then(done, done);
  return p;
}

// Gemini에게 묻고, prepared와 같은 순서의 점수 목록을 돌려줌: [{score, raw}]
async function fetchGeminiScores(text) {
  if (AI.cache.has(text)) return AI.cache.get(text);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
  try {
    const res = await fetch(AI_ENDPOINT.trim(), {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, catalog: CATALOG })
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        detail = (body.error && body.error.message) || "";
      } catch (e) { /* 본문을 못 읽어도 상태 번호는 남김 */ }
      const err = new Error("HTTP " + res.status + " " + detail);
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    const data = await res.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content.parts) || [];
    const raw = parts.map(p => p.text || "").join("");
    AI.lastRaw = raw;
    if (DEBUG) console.log("Gemini 응답:", raw);
    const picks = parsePicks(raw);

    const scores = prepared.map(() => ({ score: 0, raw: 0 }));
    picks.forEach(pick => {
      const idx = parseInt(String(pick.id).replace(/\D/g, ""), 10) - 1;
      let v = Number(pick.score);
      if (!(v > 0)) v = 5; // 점수가 빠져 있으면 중간 점수로
      v = Math.min(10, v);
      if (Number.isInteger(idx) && idx >= 0 && idx < scores.length) {
        scores[idx] = { score: v * GEMINI_POINTS, raw: v };
      }
    });
    AI.cache.set(text, scores);
    return scores;
  } finally {
    clearTimeout(timer);
  }
}

// ================= 3. 화면 그리기 =================

// 이미지 요소 만들기. 이미지 파일이 없으면 설명 상자로 대신 보여줌
function createImage(item, className, onMissing) {
  const img = new Image();
  img.src = "images/" + encodeURI(item.file);
  img.alt = item.desc;
  img.loading = "lazy";
  img.className = "fade" + (className ? " " + className : "");
  img.addEventListener("load", () => img.classList.add("loaded"));
  img.addEventListener("error", () => {
    const box = document.createElement("div");
    box.className = "placeholder";
    box.textContent = item.desc + "\n[" + item.file + " 없음]";
    img.replaceWith(box);
    if (onMissing) onMissing();
  });
  return img;
}

// 클립보드 복사 (https/localhost가 아니어도 동작하도록 예비 방법 포함)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("search-form");
  const input = document.getElementById("jjal-input");
  const message = document.getElementById("message");
  const results = document.getElementById("results");
  const examples = document.getElementById("examples");
  const randomBtn = document.getElementById("random-btn");
  const shareBtn = document.getElementById("share-btn");
  const countEl = document.getElementById("count");
  const toast = document.getElementById("toast");

  const modal = document.getElementById("modal");
  const modalMedia = document.getElementById("modal-media");
  const modalDesc = document.getElementById("modal-desc");
  const modalCount = document.getElementById("modal-count");
  const modalPhrases = document.getElementById("modal-phrases");
  const modalDownload = document.getElementById("modal-download");
  const modalClose = document.getElementById("modal-close");
  const modalPrev = document.getElementById("modal-prev");
  const modalNext = document.getElementById("modal-next");

  countEl.textContent = jjalData.length;

  // ---- 알림(토스트) ----
  let toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1600);
  }

  // ---- 큰 화면(모달) ----
  let currentList = []; // 지금 화면에 나온 짤들 (좌우 넘기기용)
  let currentIndex = 0;
  let lastFocus = null;

  function renderModal() {
    const item = currentList[currentIndex];
    modalMedia.replaceChildren();
    modalDownload.hidden = false;
    modalMedia.appendChild(
      createImage(item, "modal-img", () => {
        modalDownload.hidden = true; // 이미지가 없으면 저장 버튼 숨김
      })
    );
    modalDesc.textContent = item.desc;
    modalDownload.href = "images/" + encodeURI(item.file);
    modalDownload.setAttribute("download", item.file);

    const many = currentList.length > 1;
    modalPrev.hidden = !many;
    modalNext.hidden = !many;
    modalCount.textContent = many ? currentIndex + 1 + " / " + currentList.length : "";

    modalPhrases.replaceChildren();
    item.phrases.slice(0, 4).forEach(text => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "phrase";
      b.textContent = text;
      b.addEventListener("click", async () => {
        showToast((await copyText(text)) ? "복사했어요" : "복사하지 못했어요");
      });
      modalPhrases.appendChild(b);
    });
  }

  function openModal(index) {
    lastFocus = document.activeElement;
    currentIndex = index;
    renderModal();
    modal.hidden = false;
    document.body.classList.add("modal-open");
    modalClose.focus();
  }

  function closeModal() {
    modal.hidden = true;
    modalMedia.replaceChildren();
    document.body.classList.remove("modal-open");
    if (lastFocus) lastFocus.focus();
  }

  function stepModal(step) {
    if (currentList.length < 2) return;
    currentIndex = (currentIndex + step + currentList.length) % currentList.length;
    renderModal();
  }

  modalClose.addEventListener("click", closeModal);
  modalPrev.addEventListener("click", () => stepModal(-1));
  modalNext.addEventListener("click", () => stepModal(1));
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal(); // 바깥(어두운 영역) 클릭 시 닫기
  });
  document.addEventListener("keydown", event => {
    if (modal.hidden) return;
    if (event.key === "Escape") closeModal();
    if (event.key === "ArrowLeft") stepModal(-1);
    if (event.key === "ArrowRight") stepModal(1);
    if (event.key === "Tab") {
      // 모달 밖으로 포커스가 나가지 않게 가두기
      const focusable = modal.querySelectorAll("button:not([hidden]), a[href]:not([hidden])");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // ---- 결과 카드 ----
  function createCard(entry, index) {
    const { item, badge, filler } = entry;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "card" + (filler ? " filler" : "");
    card.style.setProperty("--i", index);
    card.setAttribute("aria-label", item.desc);

    card.appendChild(
      createImage(item, "", () => {
        card.classList.add("missing"); // 이미지가 없으면 설명이 이미 보이므로 캡션 숨김
      })
    );

    const caption = document.createElement("span");
    caption.className = "caption";
    caption.textContent = item.desc;
    card.appendChild(caption);

    if (entry.debug) {
      const dbg = document.createElement("span");
      dbg.className = "debug-info";
      dbg.textContent = entry.debug;
      card.appendChild(dbg);
    }

    if (badge) {
      const tag = document.createElement("span");
      tag.className = "badge";
      tag.textContent = badge;
      card.appendChild(tag);
    }

    card.addEventListener("click", () => openModal(index));
    return card;
  }

  function showResults(entries) {
    currentList = entries.map(e => e.item);
    results.replaceChildren();
    entries.forEach((entry, i) => results.appendChild(createCard(entry, i)));
  }

  // ---- 주소에 검색어 남기기 (공유용) ----
  function syncUrl(q) {
    try {
      const url = new URL(location.href);
      if (q) url.searchParams.set("q", q);
      else url.searchParams.delete("q");
      history.replaceState(null, "", url);
    } catch (e) {
      /* 로컬 파일로 열었을 때는 무시 */
    }
  }

  // ---- 검색 ----
  let searchToken = 0; // 검색이 연달아 일어났을 때 오래된 결과를 버리기 위한 번호
  let lastIsRandom = false; // 마지막으로 그린 결과가 "맞는 짤 없음"이었는지

  // 결과 그리기. sem이 있으면 AI 점수까지 합쳐서, pending이면 "AI가 고르는 중" 표시
  function render(text, sem, pending) {
    const { matched, filler, isRandom } = findJjal(text, sem);
    const entries = [];

    matched.forEach((m, i) => {
      entries.push({
        item: m.item,
        badge: i === 0 && m.score >= GREAT_SCORE ? "찰떡" : "",
        debug: DEBUG ? "키워드 " + m.kw.toFixed(1) + " + AI " + m.sem.toFixed(1) + " (AI " + m.raw + "/10)" : ""
      });
    });
    filler.forEach(item => entries.push({ item, badge: "랜덤", filler: true }));

    if (isRandom) {
      message.textContent = "이 말에 맞는 짤을 못 찾았어요. 다른 표현으로 입력하거나, 랜덤 짤을 구경해 보세요.";
    } else if (filler.length) {
      message.textContent = "“" + text + "”에 어울리는 짤은 " + matched.length + "장이에요. 나머지는 랜덤으로 채웠어요.";
    } else {
      message.textContent = "“" + text + "”에 어울리는 짤 " + matched.length + "장";
    }
    if (pending) message.textContent += " (AI가 다시 고르는 중…)";

    lastIsRandom = isRandom;
    showResults(entries);
    syncUrl(text);
    shareBtn.hidden = !/^https?:/.test(location.protocol) || isRandom;
  }

  async function search(query, aiPromise = null) {
    const text = query.trim();
    const token = ++searchToken;
    if (!text) {
      message.textContent = "할 말을 먼저 입력해 주세요.";
      results.replaceChildren();
      currentList = [];
      shareBtn.hidden = true;
      return;
    }

    const cached = AI.cache.get(text) || null;
    const useAI = AI.enabled && !cached && Date.now() >= AI.cooldownUntil;

    // 1) 키워드(+저장된 AI 결과)로 바로 보여주기
    render(text, cached, useAI);
    if (!useAI) return;

    // 2) Gemini 결과가 오면 합쳐서 다시 보여주기
    try {
      const sem = await (aiPromise || geminiScores(text));
      const found = sem.filter(x => x.raw > 0).length;
      setAiStatus(
        DEBUG
          ? "AI 응답: " + AI.lastRaw.slice(0, 200)
          : "AI 검색이 켜져 있어요. 입력한 문장은 Google Gemini로 전송돼요." + (found ? "" : " (이번 문장은 AI도 맞는 짤을 못 골랐어요)"),
        "ready"
      );
      if (token !== searchToken || !modal.hidden) {
        message.textContent = message.textContent.replace(" (AI가 다시 고르는 중…)", "");
        return; // 그 사이에 새 검색을 했거나 짤을 크게 보는 중이면 화면을 바꾸지 않음
      }
      render(text, sem, false);
    } catch (e) {
      console.warn("Gemini 호출 실패", e);
      message.textContent = message.textContent.replace(" (AI가 다시 고르는 중…)", "");
      const detail = e.detail ? " [" + e.detail.slice(0, 140) + "]" : "";
      if (e.name === "AbortError") {
        setAiStatus("AI 응답이 너무 늦어서 키워드 결과만 보여줘요.", "failed");
      } else if (e.status === 429) {
        AI.cooldownUntil = Date.now() + 60000;
        setAiStatus("AI 사용량 한도에 걸렸어요. 잠시 키워드 검색만 써요." + detail, "failed");
      } else if (e.status === 403 && /허용되지 않은/.test(e.detail || "")) {
        AI.enabled = false;
        setAiStatus("AI 서버가 이 사이트 주소를 허용하지 않아요. worker.js의 ALLOWED_ORIGINS를 확인해 주세요.", "failed");
      } else if (e.status === 403 || (e.status === 400 && /api key/i.test(e.detail || ""))) {
        AI.enabled = false;
        setAiStatus("서버에 저장된 AI 키가 올바르지 않거나 막혔어요." + detail, "failed");
      } else if (e.status === 404) {
        setAiStatus("AI 모델 이름을 찾지 못했어요. worker.js의 MODEL을 확인해 주세요." + detail, "failed");
      } else if (e.parse) {
        setAiStatus("AI 답을 해석하지 못했어요. " + e.message, "failed");
      } else if (e.status) {
        setAiStatus("AI 호출 오류 (" + e.status + ")" + detail, "failed");
      } else {
        setAiStatus("AI 서버에 연결하지 못했어요. AI_ENDPOINT 주소와 네트워크를 확인해 주세요.", "failed");
      }
    }
  }

  // ================= 무대 연출 =================
  // 흐름: 키류가 말을 건다 → 검색어 입력 → 펀치 → 화면이 깨짐 + 연기 → 결과 공개
  // 시간은 아래 숫자(밀리초)로 조절해요.
  const FX = {
    typeSpeed: 45,   // 말풍선 글자가 나오는 속도
    windup: 280,     // 펀치를 날리기 전 잠깐 멈추는 시간
    lunge: 460,      // 키류가 달려드는 시간
    minHold: 700,    // 화면이 깨진 뒤 최소로 머무는 시간
    maxWait: 3500,   // AI 답을 기다리는 최대 시간 (이 시간이 지나면 키워드 결과부터 보여줘요)
    fall: 1150,      // 유리 조각이 떨어지는 시간
    banner: 1900     // "여기 너에게 적합한 짤들이다!" 문구가 보이는 시간
  };

  const stage = document.getElementById("stage");
  const resultsView = document.getElementById("results-view");
  const app = document.getElementById("app");
  const bubbleText = document.getElementById("bubble-text");
  const kiryuWrap = document.getElementById("kiryu");
  const kiryuImg = document.getElementById("kiryu-img");
  const kiryuPh = document.getElementById("kiryu-ph");
  const fxLayer = document.getElementById("fx");
  const glass = document.getElementById("glass");
  const smoke = document.getElementById("smoke");
  const flash = document.getElementById("flash");
  const banner = document.getElementById("banner");
  const fxToggle = document.getElementById("fx-toggle");
  const backBtn = document.getElementById("back-btn");
  const randomStage = document.getElementById("random-stage");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let busy = false;

  // ---- 배경: 검색할 때마다 카무로쵸 거리 사진이 한 장씩 바뀌어요 (4장이 한 바퀴) ----
  // 파일은 ui/ 폴더에 있어요. soft: true 는 해상도가 낮은 사진이라 살짝 흐리게 보여 줘요.
  const BACKDROPS = [
    { src: "ui/bg1.jpg", soft: true }, // 천하일통 아케이드
    { src: "ui/bg2.jpg" },             // 푸른 네온 골목
    { src: "ui/bg3.jpg", soft: true }, // 도톤보리
    { src: "ui/bg4.jpg" }              // 돈키호테 앞 거리
  ];
  const bdLayers = Array.from(document.querySelectorAll("#backdrop .bd"));
  let bdIndex = 1; // 처음엔 해상도가 높은 사진부터 시작해요
  let bdFront = 0;

  function paintBackdrop(layer, i) {
    layer.style.backgroundImage = 'url("' + BACKDROPS[i].src + '")';
    layer.classList.toggle("soft", !!BACKDROPS[i].soft);
  }

  function initBackdrop() {
    try {
      const saved = parseInt(localStorage.getItem("jjalBd"), 10); // 새로고침해도 이어서 돌아요
      if (saved >= 0 && saved < BACKDROPS.length) bdIndex = saved;
    } catch (e) { /* 저장소를 못 써도 괜찮아요 */ }
    BACKDROPS.forEach(b => { new Image().src = b.src; }); // 미리 받아 두기
    paintBackdrop(bdLayers[0], bdIndex);
    bdLayers[0].classList.add("on");
  }

  function nextBackdrop() {
    bdIndex = (bdIndex + 1) % BACKDROPS.length;
    const back = bdLayers[1 - bdFront];
    paintBackdrop(back, bdIndex);
    back.classList.add("on");
    bdLayers[bdFront].classList.remove("on");
    bdFront = 1 - bdFront;
    try {
      localStorage.setItem("jjalBd", String(bdIndex));
    } catch (e) { /* 무시 */ }
  }

  // ---- 결과 화면의 키류(마지막 사진) ----
  const resultKiryu = document.getElementById("result-kiryu");
  resultKiryu.addEventListener("error", () => { resultKiryu.hidden = true; }); // 파일이 없으면 숨김

  function enterResults() {
    resultsView.classList.add("enter"); // 키류가 옆에서 걸어 들어와요
    setTimeout(() => resultsView.classList.remove("enter"), 1600);
  }

  // 연출을 끄고 켠 설정은 이 브라우저에 기억해요
  try {
    if (localStorage.getItem("jjalFx") === "off") fxToggle.checked = false;
  } catch (e) { /* 저장소를 못 써도 괜찮아요 */ }
  fxToggle.addEventListener("change", () => {
    try {
      localStorage.setItem("jjalFx", fxToggle.checked ? "on" : "off");
    } catch (e) { /* 무시 */ }
  });
  const fxOn = () => fxToggle.checked && !reduceMotion.matches;

  function showView(name) {
    document.body.dataset.view = name;
    stage.hidden = name !== "stage";
    resultsView.hidden = name !== "results";
    window.scrollTo(0, 0);
  }

  // ---- 키류 이미지: ui/kiryu_stand.png(서 있는 모습), ui/kiryu_punch.png(펀치하는 모습) ----
  // 파일이 아직 없으면 점선 상자로 대신 보여줘요. (연출은 똑같이 돌아가요)
  const kiryuFile = { stand: "ui/kiryu_stand.png", punch: "ui/kiryu_punch.png" };
  const kiryuLabel = { stand: "서 있는 모습", punch: "펀치하는 모습" };
  const kiryuOk = {}; // 파일이 있는지 (true/false, 아직 모르면 비어 있음)
  let kiryuPose = "stand";

  function setKiryu(pose) {
    kiryuPose = pose;
    if (kiryuOk[pose] === false) {
      kiryuImg.hidden = true;
      kiryuPh.hidden = false;
      kiryuPh.textContent = kiryuFile[pose] + "\n파일을 넣어 주세요\n(" + kiryuLabel[pose] + ", 배경 투명 PNG)";
    } else {
      kiryuPh.hidden = true;
      kiryuImg.hidden = false;
      kiryuImg.src = kiryuFile[pose];
    }
  }
  Object.keys(kiryuFile).forEach(pose => {
    const probe = new Image();
    probe.onload = () => { kiryuOk[pose] = true; if (kiryuPose === pose) setKiryu(pose); };
    probe.onerror = () => { kiryuOk[pose] = false; if (kiryuPose === pose) setKiryu(pose); };
    probe.src = kiryuFile[pose];
  });

  // ---- 말풍선 (한 글자씩 나오는 효과) ----
  let typeToken = 0;
  async function typeBubble(text) {
    const token = ++typeToken;
    bubbleText.textContent = "";
    if (reduceMotion.matches) {
      bubbleText.textContent = text;
      return;
    }
    for (const ch of text) {
      if (token !== typeToken) return; // 새 말풍선이 시작되면 이전 것은 멈춤
      bubbleText.textContent += ch;
      await sleep(FX.typeSpeed);
    }
  }

  // ---- 유리 깨짐: 중심에서 퍼지는 금 + 조각 ----
  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(name, attrs) {
    const el = document.createElementNS(SVG_NS, name);
    Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
    return el;
  }

  function buildGlass() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cx = W / 2;
    const cy = H * 0.46;
    const RAYS = 14;
    const RINGS = [0.07, 0.15, 0.27, 0.43, 0.66, 1.3];
    const R = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
    glass.setAttribute("viewBox", "0 0 " + W + " " + H);
    glass.replaceChildren();

    const baseAngles = [];
    for (let i = 0; i < RAYS; i++) baseAngles.push((i / RAYS) * Math.PI * 2 + (Math.random() - 0.5) * 0.25);
    const pts = RINGS.map(f =>
      baseAngles.map(a => {
        const ang = a + (Math.random() - 0.5) * 0.12;
        const r = R * f * (0.85 + Math.random() * 0.3);
        return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
      })
    );
    const fmt = p => p[0].toFixed(1) + "," + p[1].toFixed(1);

    // 조각
    const shards = svgEl("g", {});
    RINGS.forEach((_, k) => {
      for (let i = 0; i < RAYS; i++) {
        const j = (i + 1) % RAYS;
        const poly = k === 0 ? [[cx, cy], pts[0][i], pts[0][j]] : [pts[k - 1][i], pts[k - 1][j], pts[k][j], pts[k][i]];
        const mx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
        const my = poly.reduce((s, p) => s + p[1], 0) / poly.length;
        const dist = Math.hypot(mx - cx, my - cy) / R;
        const el = svgEl("polygon", { points: poly.map(fmt).join(" "), class: "shard" });
        el.style.fill = "rgba(190,215,255," + (0.04 + Math.random() * 0.08).toFixed(3) + ")";
        el.style.setProperty("--d", (dist * 380 + Math.random() * 140).toFixed(0) + "ms");
        el.style.setProperty("--tx", ((mx - cx) * 0.08 + (Math.random() - 0.5) * 60).toFixed(0) + "px");
        el.style.setProperty("--ty", (H * (0.7 + Math.random() * 0.5)).toFixed(0) + "px");
        el.style.setProperty("--rot", ((Math.random() - 0.5) * 160).toFixed(0) + "deg");
        shards.appendChild(el);
      }
    });
    glass.appendChild(shards);

    // 금(균열): 중심에서 뻗는 선 + 군데군데 이어진 고리
    const cracks = svgEl("g", { class: "cracks" });
    const addCrack = (d, delay) => {
      const path = svgEl("path", { d, class: "crack", pathLength: "1" });
      path.style.animationDelay = delay.toFixed(0) + "ms";
      cracks.appendChild(path);
    };
    for (let i = 0; i < RAYS; i++) {
      let d = "M" + cx.toFixed(1) + "," + cy.toFixed(1);
      RINGS.forEach((_, k) => { d += " L" + fmt(pts[k][i]); });
      addCrack(d, Math.random() * 110);
    }
    RINGS.forEach((_, k) => {
      for (let i = 0; i < RAYS; i++) {
        if (Math.random() > 0.72) continue; // 일부 구간은 빼서 자연스럽게
        const j = (i + 1) % RAYS;
        addCrack("M" + fmt(pts[k][i]) + " L" + fmt(pts[k][j]), 50 + k * 40 + Math.random() * 60);
      }
    });
    glass.appendChild(cracks);
  }

  // ---- 연기 ----
  function spawnSmoke(count) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    for (let i = 0; i < count; i++) {
      const el = document.createElement("div");
      el.className = "puff";
      el.style.setProperty("--w", (140 + Math.random() * 220).toFixed(0) + "px");
      el.style.setProperty("--x", (W / 2 + (Math.random() - 0.5) * W * 0.7).toFixed(0) + "px");
      el.style.setProperty("--y", (H * 0.55 + (Math.random() - 0.2) * H * 0.3).toFixed(0) + "px");
      el.style.setProperty("--dx", ((Math.random() - 0.5) * 160).toFixed(0) + "px");
      el.style.setProperty("--dy", (-60 - Math.random() * 180).toFixed(0) + "px");
      el.style.setProperty("--delay", (Math.random() * 500).toFixed(0) + "ms");
      el.style.setProperty("--dur", (2200 + Math.random() * 1200).toFixed(0) + "ms");
      smoke.appendChild(el);
    }
  }

  function resetStage() {
    kiryuWrap.classList.remove("lunge");
    stage.classList.remove("hit");
    app.classList.remove("shake");
    fxLayer.hidden = true;
    fxLayer.classList.remove("fall");
    glass.replaceChildren();
    smoke.replaceChildren();
    flash.classList.remove("on");
    setKiryu("stand");
  }

  function startIntro() {
    resetStage();
    typeBubble("하고 싶은 말을 써라");
    // 터치 기기는 자동으로 키보드가 올라오면 화면을 가려서 건너뜀
    if (!window.matchMedia("(hover: none)").matches) input.focus();
  }

  function showBanner(text) {
    banner.textContent = text;
    banner.hidden = false;
    banner.style.animation = "none";
    void banner.offsetWidth; // 애니메이션을 처음부터 다시 시작
    banner.style.animation = "";
    setTimeout(() => { banner.hidden = true; }, FX.banner);
  }

  // 펀치 → 화면 깨짐 → 결과 공개
  async function playSequence(text, aiPromise) {
    stage.classList.add("hit");
    typeToken++; // 진행 중인 말풍선 타이핑 중단
    bubbleText.textContent = "호랑이... 떨구기!!";
    await sleep(FX.windup);

    setKiryu("punch");
    kiryuWrap.classList.add("lunge");
    await sleep(FX.lunge);

    // 충돌: 번쩍 + 흔들림 + 금 + 연기
    fxLayer.hidden = false;
    flash.classList.remove("on");
    void flash.offsetWidth;
    flash.classList.add("on");
    app.classList.add("shake");
    setTimeout(() => app.classList.remove("shake"), 520);
    buildGlass();
    spawnSmoke(16);

    // 금이 간 채로 잠깐 머물며, 그 사이 AI 답을 기다려요
    await sleep(FX.minHold);
    if (aiPromise) await Promise.race([aiPromise.catch(() => {}), sleep(FX.maxWait)]);

    // 공개: 뒤에서 결과를 그리고, 유리 조각이 떨어지며 걷혀요
    nextBackdrop(); // 유리가 깨진 자리에 다음 거리 사진이 나와요
    showView("results");
    enterResults();
    search(text, aiPromise).catch(() => {});
    spawnSmoke(8);
    showBanner(lastIsRandom ? "음... 딱 맞는 건 없다. 이거라도 봐라!" : "여기 너에게 적합한 짤들이다!");
    fxLayer.classList.add("fall");
    await sleep(FX.fall);

    fxLayer.hidden = true;
    fxLayer.classList.remove("fall");
    glass.replaceChildren();
    smoke.replaceChildren();
    kiryuWrap.classList.remove("lunge");
    stage.classList.remove("hit");
  }

  // 연출이 도는 동안 AI에게 미리 물어봐요 (연출이 로딩 시간을 가려 줘요)
  function startAI(text) {
    if (!AI.enabled || AI.cache.has(text) || Date.now() < AI.cooldownUntil) return null;
    const p = geminiScores(text);
    p.catch(() => {}); // 오류는 search()가 화면에 알려 줘요
    return p;
  }

  function nudge() {
    typeBubble("말을 해야 알지!");
    input.classList.remove("nudge");
    void input.offsetWidth;
    input.classList.add("nudge");
    input.focus();
  }

  async function go(raw) {
    if (busy) return;
    const text = raw.trim();
    if (!text) {
      nudge();
      return;
    }
    busy = true;
    try {
      if (!fxOn()) {
        nextBackdrop();
        showView("results"); // 연출을 끈 경우: 바로 결과
        search(text);
        return;
      }
      await playSequence(text, startAI(text));
    } finally {
      busy = false;
    }
  }

  function showRandom() {
    searchToken++; // 진행 중인 검색 취소
    nextBackdrop();
    showView("results");
    message.textContent = "랜덤으로 가져왔어요.";
    showResults(pickRandom(MAX_RESULTS).map(item => ({ item, badge: "" })));
    syncUrl("");
    shareBtn.hidden = true;
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    go(input.value);
  });

  randomBtn.addEventListener("click", showRandom);
  randomStage.addEventListener("click", () => {
    if (!busy) showRandom();
  });

  backBtn.addEventListener("click", () => {
    if (busy) return;
    searchToken++; // 아직 도착하지 않은 AI 결과는 버림
    showView("stage");
    syncUrl("");
    shareBtn.hidden = true;
    input.value = "";
    startIntro();
  });

  shareBtn.addEventListener("click", async () => {
    showToast((await copyText(location.href)) ? "링크를 복사했어요" : "복사하지 못했어요");
  });

  // ---- 예시 문장 버튼: 데이터의 예시 문장에서 무작위로 뽑아서 항상 결과가 나오게 ----
  function renderExamples() {
    examples.replaceChildren();
    pickRandom(5).forEach(item => {
      const sentence = item.phrases[Math.floor(Math.random() * item.phrases.length)];
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = sentence;
      chip.addEventListener("click", () => {
        input.value = sentence;
        go(sentence);
      });
      examples.appendChild(chip);
    });

    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "chip refresh";
    refresh.textContent = "다른 예시";
    refresh.addEventListener("click", renderExamples);
    examples.appendChild(refresh);
  }
  renderExamples();

  // ---- AI 상태 표시 ----
  const aiStatus = document.getElementById("ai-status");

  function setAiStatus(text, kind) {
    aiStatus.className = "ai-status " + kind;
    aiStatus.textContent = text;
  }

  if (AI.enabled) {
    setAiStatus("AI 검색 준비됨. 첫 검색 때 Google Gemini에 연결해요.", "idle");
  } else {
    aiStatus.style.display = "none"; // 키가 없으면 키워드 검색만 사용
  }

  // ---- 시작할 때: 배경부터 켜고, 주소에 검색어가 있으면 바로 검색 ----
  initBackdrop();
  const initial = new URLSearchParams(location.search).get("q");
  if (initial && initial.trim()) {
    // 공유받은 링크는 연출 없이 바로 결과를 보여줘요
    input.value = initial;
    showView("results");
    search(initial);
  } else {
    showView("stage");
    startIntro();
  }

});
