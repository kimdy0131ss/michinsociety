// 중3 사회 기말고사 학습 앱
// 데이터는 build.js 가 만든 assets/data.js 에서 window.APP_DATA 로 들어온다.
(function () {
  "use strict";

  const data = window.APP_DATA || { content: [], decks: [], quiz: [] };
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const STORE_KEY = "society-exam-v1";

  // ---------- 저장 ----------
  // 일부 환경(샌드박스 iframe, 테스트 러너)에서는 localStorage 접근 자체가 예외다.

  function store() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  function loadState() {
    const blank = { theme: null, cards: {}, quiz: { history: [], wrong: [] }, ui: { unit: 0 } };
    try {
      const ls = store();
      if (!ls) return blank;
      const raw = ls.getItem(STORE_KEY);
      if (!raw) return blank;
      const saved = JSON.parse(raw);
      return {
        theme: saved.theme || null,
        cards: saved.cards || {},
        quiz: saved.quiz || blank.quiz,
        ui: Object.assign(blank.ui, saved.ui || {}),
      };
    } catch (e) {
      return blank;
    }
  }

  let state = loadState();

  function save() {
    try {
      const ls = store();
      if (ls) ls.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* 파일을 직접 열면 저장 공간이 막힐 수 있다. 기능은 계속 동작한다. */
    }
  }

  // ---------- 다크모드 ----------

  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;

  function applyTheme(mode) {
    const dark = mode || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", dark);
    state.theme = dark;
    const btn = $("#theme-btn");
    if (btn) btn.textContent = dark === "dark" ? "라이트 모드" : "다크 모드";
    save();
  }

  $("#theme-btn").addEventListener("click", function () {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  // ---------- 탭 ----------

  function showTab(name) {
    $$(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
    $$(".panel").forEach((p) => p.classList.toggle("on", p.id === "panel-" + name));
    location.hash = name;
  }

  $$(".tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));

  // ---------- 단원 목록 / 본문 ----------

  function cardCountFor(no) {
    const deck = data.decks.find((d) => d.unit === no);
    return deck ? deck.cards.length : 0;
  }

  function quizCountFor(no) {
    return data.quiz.filter((q) => Number(String(q.unit).split(".")[0].trim()) === no).length;
  }

  function renderToc() {
    const toc = $("#toc");
    toc.innerHTML = "";
    data.content.forEach((u, i) => {
      const btn = document.createElement("button");
      const b = document.createElement("b");
      b.textContent = u.title;
      const em = document.createElement("i");
      em.textContent = `카드 ${cardCountFor(u.no)}장 · 퀴즈 ${quizCountFor(u.no)}문`;
      btn.append(b, em);
      btn.addEventListener("click", () => openUnit(i));
      toc.appendChild(btn);
    });
  }

  function openUnit(index) {
    const u = data.content[index];
    if (!u) return;
    state.ui.unit = index;
    save();

    $("#unit-view").hidden = false;
    $("#toc-view").hidden = true;

    const head = $("#unit-head");
    head.querySelector("h2").textContent = u.title;
    const back = $("#unit-back");
    back.textContent = `← 13개 단원 목록 · 카드 ${cardCountFor(u.no)}장 · 퀴즈 ${quizCountFor(u.no)}문`;

    const body = $("#unit-body");
    body.innerHTML = "";
    u.sections.forEach((s) => {
      if (!s.title) return;
      const h = document.createElement("h3");
      h.className = "sub" + (s.minor ? " minor" : "");
      h.textContent = s.title;
      body.appendChild(h);
      s.items.forEach((it) => {
        const row = document.createElement("div");
        row.className = "item";
        const span = document.createElement("span");
        if (it.label) {
          const b = document.createElement("b");
          b.textContent = it.label + ": ";
          span.appendChild(b);
        }
        span.appendChild(document.createTextNode(it.text));
        row.appendChild(span);
        body.appendChild(row);
      });
      // 출처 시점이 원문에 없는 수치에는 웹 화면에서만 안내를 붙인다.
      // (content.md 는 시험 범위 정본이라 건드리지 않는다)
      if (/^6\.2\./.test(s.title)) {
        const note = document.createElement("p");
        note.className = "hint";
        note.textContent =
          "※ 합계 출산율 1.24명, 인구 성장률 -1.00% 는 기준 연도 표기가 없는 최신 전망치다. 시험에서는 content.md 의 표기를 그대로 답으로 쓰면 된다.";
        body.appendChild(note);
      }
    });

    if (typeof body.scrollIntoView === "function") {
      body.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  $("#unit-back").addEventListener("click", function () {
    state.ui.unit = 0;
    save();
    $("#unit-view").hidden = true;
    $("#toc-view").hidden = false;
  });

  // ---------- 카드 드릴 ----------

  const BUCKETS = ["new", "learning", "review", "mastered"];
  // 버킷별 다음 복습 간격(일)
  const INTERVAL = { new: 1, learning: 3, review: 7, mastered: 21 };
  const DOWN = { review: "learning", learning: "new", new: "new", mastered: "review" };

  let deck = [];

  function allCards() {
    const list = [];
    data.decks.forEach((d) => d.cards.forEach((c) => list.push(c)));
    return list;
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function shiftDay(iso, days) {
    const d = new Date(iso + "T00:00:00");
    d.setDate(d.getDate() + days);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function cardKey(c) {
    return `${c.unit}-${c.no}`;
  }

  function recordOf(c) {
    return state.cards[cardKey(c)] || null;
  }

  function bucketOf(c) {
    const rec = recordOf(c);
    return rec ? rec.bucket : c.bucket || "new";
  }

  function isDue(c) {
    const rec = recordOf(c);
    if (!rec) return true; // 신규 카드는 전부 due
    return rec.next <= todayISO();
  }

  function markCard(c, right) {
    const cur = bucketOf(c);
    const up = BUCKETS[Math.min(BUCKETS.indexOf(cur) + 1, BUCKETS.length - 1)];
    const next = right ? (cur === "mastered" ? "mastered" : up) : DOWN[cur];
    const today = todayISO();
    const prev = recordOf(c) || { right: 0, wrong: 0 };
    state.cards[cardKey(c)] = {
      bucket: next,
      last: today,
      next: shiftDay(today, right ? INTERVAL[next] : 0),
      right: (prev.right || 0) + (right ? 1 : 0),
      wrong: (prev.wrong || 0) + (right ? 0 : 1),
    };
    save();
    renderCardStats();
  }

  function fillDeck() {
    const unitSel = $("#card-unit").value;
    const mode = $("#card-mode").value;
    let pool = allCards().filter((c) => unitSel === "all" || String(c.unit) === unitSel);

    if (mode === "due") pool = pool.filter(isDue);
    else if (mode === "wrong") pool = pool.filter((c) => (state.cards[cardKey(c)] || {}).wrong > 0);
    else if (mode === "new") pool = pool.filter((c) => bucketOf(c) === "new");
    else if (mode === "mastered") pool = pool.filter((c) => bucketOf(c) === "mastered");

    // 셔플 후 큐로 사용한다. 같은 카드가 연달아 나오지 않게 한다.
    pool = pool.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    deck = pool;
  }

  let cardIndex = -1;

  function showCard() {
    const wrap = $("#card-stage");
    const c = deck[cardIndex];

    $("#card-progress").textContent = deck.length
      ? `${cardIndex + 1} / ${deck.length}장`
      : "조건에 맞는 카드가 없습니다";

    if (!c) {
      $("#card-none").hidden = false;
      $("#card-body").hidden = true;
      return;
    }
    $("#card-none").hidden = true;
    $("#card-body").hidden = false;

    const deckNo = c.unit ? `카드 ${c.no} · ` : "";
    $("#card-meta").textContent =
      `${deckNo}${c.unit}. ${c.unitShort} · 유형 ${c.kind || "-"} · 버킷 ${bucketOf(c)}` +
      (c.src ? ` · ${c.src}` : "");
    $("#card-q").textContent = c.q;
    $("#card-a").textContent = c.a;
    $("#card-note").textContent = c.note || "";
    $("#card-a").classList.add("hidden");
    $("#card-note").classList.add("hidden");
    $("#btn-reveal").disabled = false;
    $("#btn-right").disabled = true;
    $("#btn-wrong").disabled = true;
  }

  function nextCard() {
    cardIndex++;
    if (cardIndex >= deck.length) {
      cardIndex = -1;
      fillDeck();
      cardIndex = 0;
      if (!deck.length) {
        showCard();
        return;
      }
    }
    showCard();
  }

  function answerCard(right) {
    const c = deck[cardIndex];
    if (!c) return;
    markCard(c, right);
    nextCard();
  }

  $("#btn-card-start").addEventListener("click", function () {
    fillDeck();
    cardIndex = 0;
    showCard();
  });

  $("#btn-reveal").addEventListener("click", function () {
    $("#card-a").classList.remove("hidden");
    $("#card-note").classList.toggle("hidden", !$("#card-note").textContent);
    $("#btn-reveal").disabled = true;
    $("#btn-right").disabled = false;
    $("#btn-wrong").disabled = false;
  });

  $("#btn-right").addEventListener("click", () => answerCard(true));
  $("#btn-wrong").addEventListener("click", () => answerCard(false));

  function renderCardStats() {
    const all = allCards();
    const row = $("#card-stats");
    const counts = { new: 0, learning: 0, review: 0, mastered: 0 };
    all.forEach((c) => counts[bucketOf(c)]++);
    const due = all.filter(isDue).length;

    const cells = [
      ["전체", all.length],
      ["due", due],
      ["new", counts.new],
      ["learning", counts.learning],
      ["review", counts.review],
      ["mastered", counts.mastered],
    ];

    row.innerHTML = "";
    cells.forEach(([label, val]) => {
      const box = document.createElement("div");
      box.className = "stat";
      const b = document.createElement("b");
      b.textContent = val;
      const s = document.createElement("span");
      s.textContent = label;
      box.append(b, s);
      row.appendChild(box);
    });
  }

  (function fillUnitSelect() {
    const sel = $("#card-unit");
    data.content.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = String(u.no);
      opt.textContent = u.title;
      sel.appendChild(opt);
    });
  })();

  // ---------- 퀴즈 ----------

  let session = null;

  function pickQuestions() {
    const unitSel = $("#quiz-unit").value;
    const typeSel = $("#quiz-type").value;
    const count = Number($("#quiz-count").value);

    let pool = data.quiz.slice();
    if (unitSel !== "all") {
      pool = pool.filter((q) => Number(String(q.unit).split(".")[0].trim()) === Number(unitSel));
    }
    if (typeSel !== "mixed") pool = pool.filter((q) => q.type === typeSel);

    // 유형별로 최대한 고르게 뽑는다
    const groups = { mc: [], ox: [], short: [], essay: [] };
    pool.forEach((q) => groups[q.type] && groups[q.type].push(q));
    Object.values(groups).forEach((arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
    });

    const out = [];
    let guard = 0;
    while (out.length < count && guard < count * 20) {
      guard++;
      const added = ["mc", "ox", "short", "essay"].some((k) => {
        if (groups[k].length) {
          out.push(groups[k].pop());
          return true;
        }
        return false;
      });
      if (!added) break;
    }
    return out;
  }

  function startQuiz() {
    const list = pickQuestions();
    if (!list.length) {
      $("#quiz-stage").innerHTML = "";
      const warn = document.createElement("p");
      warn.className = "hint";
      warn.textContent = "조건에 맞는 문제가 없습니다. 단원이나 유형을 바꿔 보세요.";
      $("#quiz-stage").appendChild(warn);
      session = null;
      return;
    }
    session = {
      list,
      answers: list.map(() => null),
      idx: 0,
      startedAt: Date.now(),
    };
    renderQuizQuestion();
  }

  function renderQuizQuestion() {
    const stage = $("#quiz-stage");
    stage.innerHTML = "";
    const q = session.list[session.idx];
    const box = document.createElement("div");
    box.className = "card";

    const head = document.createElement("p");
    head.className = "quiz-ref";
    const typeLabel = { mc: "5지선다", ox: "O · X", essay: "서술형", short: "주관식" }[q.type];
    head.textContent = `${q.unit} · ${typeLabel} · ${session.idx + 1} / ${session.list.length}${q.ref ? " · " + q.ref : ""}`;
    box.appendChild(head);

    const qq = document.createElement("p");
    qq.className = "quiz-q";
    qq.textContent = q.q;
    box.appendChild(qq);

    const wrap = document.createElement("div");
    wrap.className = "choices";
    stage.appendChild(box);

    if (q.type === "essay") {
      const ta = document.createElement("textarea");
      ta.id = "essay-input";
      ta.rows = 4;
      ta.placeholder = "여기에 답을 적는다. 3~5줄 정도.";
      ta.style.cssText = "width:100%;border:1px solid var(--line);background:var(--bg-soft);border-radius:10px;padding:11px 13px;margin-bottom:16px;resize:vertical;";
      wrap.appendChild(ta);

      const go = document.createElement("button");
      go.className = "btn primary";
      go.textContent = "제출하고 채점";
      go.addEventListener("click", () => {
        const val = ta.value.trim();
        session.answers[session.idx] = val || "(빈 답)";
        showEssayResult();
      });
      wrap.appendChild(go);
      stage.appendChild(wrap);
      return;
    }

    if (q.type === "short") {
      const input = document.createElement("input");
      input.type = "text";
      input.id = "short-input";
      input.placeholder = "답을 적는다. 띄어쓰기는 상관없다.";
      input.style.cssText = "width:100%;border:1px solid var(--line);background:var(--bg-soft);border-radius:10px;padding:11px 13px;margin-bottom:16px;font-size:1rem;";

      const go = document.createElement("button");
      go.className = "btn primary";
      go.textContent = "제출하고 채점";
      const submit = () => {
        const val = input.value.trim();
        session.answers[session.idx] = val || "(빈 답)";
        showShortResult();
      };
      go.addEventListener("click", submit);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      wrap.append(input, go);
      stage.appendChild(wrap);
      return;
    }

    const picked = document.createElement("div");
    picked.id = "picked";
    const buttons = [];
    q.choices.forEach((text, i) => {
      const b = document.createElement("button");
      b.className = "choice";
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(i + 1);
      const label = document.createElement("span");
      label.textContent = text;
      b.append(num, label);
      b.addEventListener("click", () => {
        session.answers[session.idx] = text;
        buttons.forEach((x) => {
          x.disabled = true;
          if (x === b) x.classList.add("pick");
          else x.classList.add("dim");
        });
        showMcResult();
      });
      buttons.push(b);
      picked.appendChild(b);
    });
    wrap.appendChild(picked);
    stage.appendChild(wrap);
  }

  function showMcResult() {
    const q = session.list[session.idx];
    const picked = session.answers[session.idx];
    const right = picked === q.answer;

    $$("#picked .choice").forEach((b) => {
      const label = b.lastChild.textContent;
      b.classList.remove("pick", "dim");
      if (label === q.answer) b.classList.add("right");
      else if (label === picked) b.classList.add("wrong");
    });

    const ex = document.createElement("div");
    ex.className = "explain";
    ex.innerHTML = `<h4>정답: ${right ? "맞음" : "틀림"}</h4><p></p>`;
    ex.querySelector("p").textContent = q.explain;
    $("#quiz-stage").appendChild(ex);

    const next = document.createElement("button");
    next.className = "btn primary";
    next.textContent = session.idx + 1 < session.list.length ? "다음 문제" : "결과 보기";
    next.addEventListener("click", goNext);
    $("#quiz-stage").appendChild(next);
  }

  function showEssayResult() {
    const q = session.list[session.idx];
    const stage = $("#quiz-stage");
    // 입력 폼을 치운다. 제출 버튼이 남아 있으면 채점 화면과 섞여 보인다.
    stage.innerHTML = "";

    const ex = document.createElement("div");
    ex.className = "explain answer";
    ex.innerHTML = `<h4>모범 답안</h4><p></p>`;
    ex.querySelector("p").textContent = q.answer;
    stage.appendChild(ex);

    const ex2 = document.createElement("div");
    ex2.className = "explain";
    ex2.innerHTML = `<h4>채점 기준</h4><p></p>`;
    ex2.querySelector("p").textContent = q.explain;
    stage.appendChild(ex2);

    const next = document.createElement("button");
    next.className = "btn primary";
    next.textContent = session.idx + 1 < session.list.length ? "다음 문제" : "결과 보기";
    next.addEventListener("click", goNext);
    stage.appendChild(next);
  }

  function showShortResult() {
    const q = session.list[session.idx];
    const picked = session.answers[session.idx];
    const right = gradeShort(picked, q);

    const input = $("#short-input");
    if (input) {
      input.disabled = true;
      const wrap = input.parentElement;
      const btn = wrap && wrap.querySelector("button");
      if (btn) btn.remove();
    }

    const ex = document.createElement("div");
    ex.className = "explain" + (right ? "" : " answer");
    ex.innerHTML = `<h4></h4><p></p>`;
    ex.querySelector("h4").textContent = right ? "정답" : "오답";
    ex.querySelector("p").textContent = `정답: ${q.answer} — ${q.explain}`;
    $("#quiz-stage").appendChild(ex);

    const next = document.createElement("button");
    next.className = "btn primary";
    next.textContent = session.idx + 1 < session.list.length ? "다음 문제" : "결과 보기";
    next.addEventListener("click", goNext);
    $("#quiz-stage").appendChild(next);
  }

  function goNext() {
    session.idx++;
    if (session.idx < session.list.length) {
      renderQuizQuestion();
    } else {
      renderQuizResult();
    }
  }

  // 본문에만 나오는 내용어가 아닌 조사·접속 부사. 채점 키워드에서 제외한다.
  const ESSAY_STOP = new Set([
    "그리고", "그러나", "하지만", "때문에", "이후", "이전", "대한", "위한",
    "있는", "없는", "한다", "이다", "것이다", "경우에", "경우는", "통해",
    "대해", "관련", "같은", "모든", "또한", "따라", "위해", "으로", "에서",
    "에게", "까지", "부터", "하면서", "수있다", "예를", "대표", "이러한",
    "그러면", "먼저", "현재는", "현재", "과거에는", "과거", "오늘날",
  ]);

  function normText(s) {
    return s.replace(/[\s"'“”‘’.,!?;:()[\]「」·—–]/g, "");
  }

  // 주관식 단답 채점. answer (정답) 또는 accepts (허용 표현)와 같으면 정답.
  // 공백·문장부호·대소문자를 무시하고, 학생 답이 더 길 때는 정답을 포함하기만 해도 통과한다.
  function gradeShort(ans, q) {
    const raw = (ans || "").trim();
    if (!raw || raw === "(빈 답)") return false;
    const mine = normText(raw).toLowerCase();
    const answers = [q.answer].concat(q.accepts || []).filter(Boolean);
    return answers.some((a) => {
      const t = normText(String(a)).toLowerCase();
      if (!t) return false;
      if (mine === t) return true;
      return mine.length >= 2 && t.length >= 2 && mine.includes(t);
    });
  }

  // 모범 답안과 학생 답을 비교한다.
  // 1) 내용어 키워드 매칭 비율 (전문용어·숫자를 3글자 앞까지 비교)
  // 2) 절 단위 커버리지 (쉼표로 쪼갠 절의 내용어가 절반 이상 나오면 그 절은 맞음)
  // 두 값을 합산해 등급을 정한다. 학생이 다르게 써도 내용어가 다 있으면 점수가 오른다.
  function rubricOf(ans, model) {
    const raw = (ans || "").trim();
    if (!raw || raw === "(빈 답)") return "D";

    const mine = normText(raw);
    if (mine.length < 4) return "D";

    // 1) 내용어 키워드
    const words = (model.match(/[가-힣]{2,}|\d+(?:\.\d+)?%?/g) || [])
      .filter((w) => !ESSAY_STOP.has(w));
    const uniq = [...new Set(words)];
    // 3글자 초과 단어는 앞 3글자만 비교한다. 학생이 조사를 바꿔 써도 통과한다.
    const wordHits = uniq.filter((w) => mine.includes(w.length > 3 ? w.slice(0, 3) : w)).length;
    const wordRatio = uniq.length ? wordHits / uniq.length : 0;

    // 2) 절 단위 커버리지
    const clauses = model
      .split(/[.!?]+|[,,]/)
      .map(normText)
      .filter((c) => c.length >= 6);
    let clauseHit = 0;
    let clauseCount = 0;
    for (const c of clauses) {
      const cw = (c.match(/[가-힣]{2,}|\d+(?:\.\d+)?%?/g) || []).filter((w) => !ESSAY_STOP.has(w));
      if (cw.length < 2) continue;
      clauseCount++;
      const hit = cw.filter((w) => mine.includes(w.length > 3 ? w.slice(0, 3) : w)).length;
      if (hit >= Math.ceil(cw.length / 2)) clauseHit++;
    }
    const clauseRatio = clauseCount ? clauseHit / clauseCount : wordRatio;

    const score = wordRatio * 0.6 + clauseRatio * 0.4;

    // 핵심 근거는 다 썼는데 표현이 완전히 다른 경우를 위해 길이 가산점을 준다.
    // 내용어 매칭이 0인 장문(변변찮은 대답)은 가산점만으로는 B에 오르지 못한다.
    const bonus = mine.length >= 45 ? 0.24 : mine.length >= 25 ? 0.12 : 0;
    const total = Math.min(1, score + bonus);

    if (total >= 0.75) return "A";
    if (total >= 0.55) return "B+";
    if (total >= 0.36) return "B";
    return "C";
  }

  function renderQuizResult() {
    const stage = $("#quiz-stage");
    stage.innerHTML = "";

    const rows = session.list.map((q, i) => {
      const ans = session.answers[i];
      if (q.type === "essay") {
        return { q, grade: rubricOf(ans, q.answer), score: null, ans };
      }
      const right = q.type === "short" ? gradeShort(ans, q) : ans === q.answer;
      return { q, right, score: right ? q.points : 0, ans };
    });

    let total = 0;
    let max = 0;
    rows.forEach((r) => {
      max += r.q.points;
      if (r.score !== null) total += r.score;
    });

    const gradeScore = { A: 5, "B+": 4.2, B: 3.4, C: 2.4, D: 0 };
    const essayTotal = rows
      .filter((r) => r.q.type === "essay")
      .reduce((s, r) => s + gradeScore[r.grade], 0);
    const essayMax = rows.filter((r) => r.q.type === "essay").length * 5;
    total += essayTotal;
    max = max - essayMax + essayMax;

    const ratio = max ? Math.round((total / max) * 100) : 0;

    const box = document.createElement("div");
    box.className = "result";
    const h = document.createElement("h3");
    h.textContent = "모의고사 결과";
    const big = document.createElement("div");
    big.className = "score-big";
    big.innerHTML = `${ratio}점 <small>/ ${max}점 만점</small>`;
    box.append(h, big);

    const table = document.createElement("table");
    table.className = "res";
    table.innerHTML =
      "<thead><tr><th>단원</th><th>유형</th><th>답</th><th>채점</th></tr></thead>";
    const tb = document.createElement("tbody");
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const typeLabel = { mc: "5지선다", ox: "O · X", essay: "서술", short: "주관식" }[r.q.type];
      const grade = r.score === null ? r.grade : r.right ? "O" : "X";
      const cls = r.score === null ? "" : r.right ? "ok" : "no";
      tr.innerHTML = `<td>${r.q.unit}</td><td>${typeLabel}</td><td></td><td class="${cls}">${grade}</td>`;
      tr.children[2].textContent = (r.ans || "-").slice(0, 40);
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    box.appendChild(table);

    // 단원별 정답률 그래프
    const byUnit = new Map();
    rows.forEach((r) => {
      if (!byUnit.has(r.q.unit)) byUnit.set(r.q.unit, { right: 0, total: 0 });
      const u = byUnit.get(r.q.unit);
      u.total++;
      if (r.q.type === "essay") {
        if (r.grade === "A" || r.grade === "B+") u.right++;
      } else if (r.right) {
        u.right++;
      }
    });
    if (byUnit.size > 1) {
      const gh = document.createElement("h4");
      gh.textContent = "단원별 정답률";
      box.appendChild(gh);
      const graph = document.createElement("div");
      graph.className = "unit-graph";
      byUnit.forEach((v, unit) => {
        const pct = Math.round((v.right / v.total) * 100);
        const row = document.createElement("div");
        row.className = "g-row";
        const label = document.createElement("span");
        label.className = "g-label";
        label.textContent = unit;
        const track = document.createElement("div");
        track.className = "g-track";
        const fill = document.createElement("div");
        fill.className = "g-fill" + (pct >= 80 ? " hi" : pct >= 50 ? " mid" : " lo");
        fill.style.width = pct + "%";
        const val = document.createElement("span");
        val.className = "g-val";
        val.textContent = `${v.right}/${v.total}`;
        track.append(fill, val);
        row.append(label, track);
        graph.appendChild(row);
      });
      box.appendChild(graph);
    }

    const wrongRows = rows.filter((r) => r.score === null ? r.grade === "D" : !r.right);
    if (wrongRows.length) {
      const t = document.createElement("h4");
      t.textContent = `재확인 필요 (${wrongRows.length}건)`;
      box.appendChild(t);
      const ul = document.createElement("ul");
      ul.className = "wronglist";
      wrongRows.forEach((r) => {
        const li = document.createElement("li");
        const b = document.createElement("b");
        b.textContent = r.q.q;
        const fix = document.createElement("div");
        fix.className = "fix";
        fix.textContent = (r.q.type === "essay" ? "모범 답안: " : "정답: ") + r.q.answer;
        li.append(b, fix);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    stage.appendChild(box);

    const again = document.createElement("button");
    again.className = "btn primary";
    again.style.marginTop = "14px";
    again.textContent = "새로 시작";
    again.addEventListener("click", startQuiz);
    stage.appendChild(again);

    state.quiz.history.unshift({
      at: new Date().toISOString().slice(0, 10),
      count: session.list.length,
      ratio,
      sec: Math.round((Date.now() - session.startedAt) / 1000),
    });
    state.quiz.history = state.quiz.history.slice(0, 30);
    wrongRows.forEach((r) => {
      state.quiz.wrong.unshift({
        id: r.q.id,
        unit: r.q.unit,
        q: r.q.q,
        answer: r.q.answer,
        type: r.q.type,
      });
    });
    state.quiz.wrong = state.quiz.wrong.slice(0, 100);
    save();
    renderQuizHistory();
  }

  function renderQuizHistory() {
    const box = $("#quiz-history");
    box.innerHTML = "";
    const h = state.quiz.history[0];
    if (h) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = `최근 기록: ${h.at} · ${h.count}문항 · ${h.ratio}점 · ${h.sec}초`;
      box.appendChild(p);
    }
    if (state.quiz.wrong.length) {
      const t = document.createElement("h3");
      t.className = "sub";
      t.textContent = `오답 누적 ${state.quiz.wrong.length}건`;
      const ul = document.createElement("ul");
      ul.className = "wronglist";
      state.quiz.wrong.slice(0, 12).forEach((w) => {
        const li = document.createElement("li");
        const b = document.createElement("b");
        b.textContent = `[${w.unit}] ${w.q}`;
        const fix = document.createElement("div");
        fix.className = "fix";
        fix.textContent = "정답: " + w.answer;
        li.append(b, fix);
        ul.appendChild(li);
      });
      box.append(t, ul);
    }
  }

  $("#btn-quiz-start").addEventListener("click", startQuiz);

  $("#btn-wrong-only").addEventListener("click", function () {
    const ids = new Set(state.quiz.wrong.map((w) => w.id));
    const pool = data.quiz.filter((q) => ids.has(q.id));
    if (!pool.length) {
      $("#quiz-stage").innerHTML = '<p class="hint">아직 오답 기록이 없다. 한 번 풀어 보자.</p>';
      return;
    }
    session = { list: pool.slice(0, 10), answers: pool.slice(0, 10).map(() => null), idx: 0, startedAt: Date.now() };
    renderQuizQuestion();
  });

  $("#btn-reset").addEventListener("click", function () {
    if (!confirm("카드 진도와 퀴즈 기록을 모두 지울까?")) return;
    state.cards = {};
    state.quiz = { history: [], wrong: [] };
    save();
    renderCardStats();
    renderQuizHistory();
  });

  (function fillQuizSelect() {
    const sel = $("#quiz-unit");
    data.content.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = String(u.no);
      opt.textContent = u.title;
      sel.appendChild(opt);
    });
  })();

  // ---------- 시작 ----------

  applyTheme(state.theme);
  renderToc();
  renderCardStats();
  renderQuizHistory();

  const tab = (location.hash || "#content").slice(1);
  showTab(["content", "cards", "quiz"].includes(tab) ? tab : "content");
})();