// ====== 設定 ======
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const SOLFEGE_NAMES = ["do","do#","re","re#","mi","fa","fa#","sol","sol#","la","la#","si"];
const LABEL_TO_FILE = {
  "C": "C",
  "C#": "Cis",
  "D": "D",
  "D#": "Dis",
  "E": "E",
  "F": "F",
  "F#": "Fis",
  "G": "G",
  "G#": "Gis",
  "A": "A",
  "A#": "Ais",
  "B": "B"
};
const DISPLAY_LABELS = {
  "C":  "C",
  "C#": "C♯/D♭",
  "D":  "D",
  "D#": "D♯/E♭",
  "E":  "E",
  "F":  "F",
  "F#": "F♯/G♭",
  "G":  "G",
  "G#": "G♯/A♭",
  "A":  "A",
  "A#": "A♯/B♭",
  "B":  "B"
};
const AUDIO_DIR = "audio";

// MIDI範囲に合わせて変更
const MIN_MIDI = 36;  // 036-C2.wav
const MAX_MIDI = 95;  // （必要に応じて調整）

const N_TRIALS = 60;     // 試行数
const TRIAL_MS = 4000;         // 音提示〜次の音まで固定4秒
const START_DELAY_MS = 5000;   // 音量OK後、開始まで5秒


// ====== 状態 ======
let trials = [];
let trialIndex = -1;
let current = null;
let tSoundOn = null;
let canRespond = false;
let results = [];
let ID = "";
// どちらを表示する？  "sharp" = C/C#表記,  "solfege" = do/re/mi表記
let LABEL_MODE = "sharp";  // ←必要なら "solfege" に
let runId = null;

const elStatus = document.getElementById("status");
const btnStart = document.getElementById("btnStart");
const btnDownload = document.getElementById("btnDownload");
const elID = document.getElementById("ID");
const elSex = document.getElementById("sex");
const elAge = document.getElementById("age");
const elInstRows = document.getElementById("instRows");
const btnAddInst = document.getElementById("btnAddInst");
const btnVolPlay = document.getElementById("btnVolPlay");
const btnVolOK   = document.getElementById("btnVolOK");
const elSummary = document.getElementById("summary");
const canvasAcc = document.getElementById("accChart");
const canvasRT = document.getElementById("rtChart");
const elKeyboard = document.getElementById("keyboard");
const audioBufferCache = new Map(); // midi -> AudioBuffer
const VOLUME_CHECK_MIDI = 69; // A4(440Hz)相当のファイルがある前提。なければ変更

const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);// --- デバイス判定 ---
    if (isMobile) {btnDownload.style.display = "none";}// btnPdf は表示されたまま（むしろ推奨）
const btnPdf = document.getElementById("btnPdf");

let inVolumeCheck = false;
let audioCtx = null;

function prettyLabel(s) {
  // 表示専用：解析には使わない
  return s.replace(/#/g, "♯");
}

// ====== UI生成 ======
function buildChoiceButtons() {
  const keyboard = document.getElementById("keyboard");
  if (!keyboard) {
    console.error('id="keyboard" が見つかりません');
    return;
  }
  keyboard.innerHTML = "";

  // 白鍵(7)と黒鍵(5)の配置（1オクターブ）
  const whiteKeys = ["C","D","E","F","G","A","B"];
  const blackKeys = [
    { note: "C#", leftBase: 0 }, // CとDの間
    { note: "D#", leftBase: 1 }, // DとEの間
    { note: "F#", leftBase: 3 }, // FとGの間
    { note: "G#", leftBase: 4 }, // GとAの間
    { note: "A#", leftBase: 5 }, // AとBの間
  ];

  const labelFor = (noteSharp) => {
    if (LABEL_MODE === "sharp") {
      return DISPLAY_LABELS[noteSharp] ?? noteSharp;
    }
    const idx = NOTE_NAMES.indexOf(noteSharp);
    return idx >= 0 ? SOLFEGE_NAMES[idx] : noteSharp;
  };

  const pressFlash = (btn) => {
    btn.classList.add("pressed");
    setTimeout(() => btn.classList.remove("pressed"), 120);
  };

  // 白鍵
  whiteKeys.forEach((note, i) => {
    const w = document.createElement("button");
    w.type = "button";
    w.className = "key white";
    w.style.left = `calc((100% / 7) * ${i})`;

    const span = document.createElement("span");
    span.className = "label";
    w.appendChild(span);
    span.textContent = prettyLabel(labelFor(note));
    w.addEventListener("click", () => {
      pressFlash(w);
      handleResponse(note); // 内部ラベルは C/D/E...
    });

    keyboard.appendChild(w);
  });

  // 黒鍵
  blackKeys.forEach(({ note, leftBase }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "key black";

    // 黒鍵は白鍵の境目より少し右に置く
    // 0.70は見た目調整係数（好みで0.65〜0.75）
    b.style.left = `calc((100% / 7) * (${leftBase} + 0.70))`;

    const span = document.createElement("span");
    span.className = "label";
    span.textContent = labelFor(note);
    b.appendChild(span);

    b.addEventListener("click", () => {
      pressFlash(b);
      handleResponse(note); // 内部ラベルは C#...
    });

    keyboard.appendChild(b);
  });
}buildChoiceButtons();

// ====== MIDI -> note/oct & ファイル名 ======
function midiToPcOct(m) {
  const pcSharp = NOTE_NAMES[m % 12];          // 正誤判定の内部ラベル
  const solfege = SOLFEGE_NAMES[m % 12];       // 表示用（ドレミ）
  const pcFile  = LABEL_TO_FILE[pcSharp];      // 音ファイル名用
  const oct = Math.floor(m / 12) - 1;
  return { pc: pcSharp, solfege, pcFile, oct };
}

function midiToFilename(m) {
  const { pcFile, oct } = midiToPcOct(m);
  const num = String(m).padStart(3, "0");
  return `${num}-${pcFile}${oct}.wav`;
}

function filePathForMidi(m) {
  return `${AUDIO_DIR}/${midiToFilename(m)}`;
}

// ====== 音再生 ======
async function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== "running") await audioCtx.resume();
}

async function getAudioBuffer(m) {
  if (audioBufferCache.has(m)) return audioBufferCache.get(m);

  await ensureAudioCtx();
  const url = filePathForMidi(m);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`音ファイルが見つかりません: ${url}`);
  const buf = await res.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(buf);

  audioBufferCache.set(m, audioBuf);
  return audioBuf;
}

async function playMidi(m) {
  const audioBuf = await getAudioBuffer(m);

  const src = audioCtx.createBufferSource();
  src.buffer = audioBuf;
  src.connect(audioCtx.destination);

  // 少し先に予約して再生（クリックノイズ/遅延ブレ軽減）
  const startAt = audioCtx.currentTime + 0.03;
  src.start(startAt);

  return startAt; // ★“音が鳴る予定の時刻”を返す
}

// ====== random化（MIDI範囲から試行を作る） ======
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

function makeMidiPool() {
  const arr = [];
  for (let m = MIN_MIDI; m <= MAX_MIDI; m++) arr.push(m);
  return arr;
}


// ★ 60音(36..95)を全て1回ずつ使い、隣接差>=13を満たす順序を構成して返す
// ====== random化（MIDI範囲から試行を作る） ======
const MIN_INTERVAL = 13; // 制約固定：1オクターブ+半音

function okAdj(a, b) {
  return (
    a !== b &&
    Math.abs(b - a) >= MIN_INTERVAL &&
    (a % 12) !== (b % 12) // 同じピッチクラス（オクターブ関係）禁止
  );
}

// 1つのpool（偶数だけ、奇数だけ）を「全て1回ずつ」使って並べる
async function solveOnePool(pool, label) {
  // 隣接可能性（グラフ）を事前計算
  const neighbors = new Map();
  for (const a of pool) {
    neighbors.set(a, pool.filter(b => okAdj(a, b)));
  }

  // “候補が少ない順”で上位K個からランダムに開始点を選ぶ（固定化回避）
  const K = Math.min(8, pool.length);
  const sorted = pool.slice().sort((x, y) => neighbors.get(x).length - neighbors.get(y).length);
  const start = sorted[Math.floor(Math.random() * K)];

  const used = new Set([start]);
  const path = [start];

  let steps = 0;
  const YIELD_EVERY = 3000;

  async function dfs(curr) {
    if (path.length === pool.length) return true;

    steps++;
    if (steps % YIELD_EVERY === 0) {
      elStatus.textContent = `試行生成中…(${label}) step=${steps} / length=${path.length}`;
      await new Promise(r => setTimeout(r, 0));
    }

    // 次候補：未使用
    const cand = neighbors.get(curr).filter(v => !used.has(v));

    // ヒューリスティック：次の候補数（未使用近傍数）が少ない順
    cand.sort((a, b) => {
      const da = neighbors.get(a).filter(v => !used.has(v)).length;
      const db = neighbors.get(b).filter(v => !used.has(v)).length;
      return da - db;
    });

    // 同点付近の固定化を避けるため、先頭数個を軽くシャッフル
    const top = Math.min(6, cand.length);
    for (let i = top - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }

    for (const nxt of cand) {
      used.add(nxt);
      path.push(nxt);

      if (await dfs(nxt)) return true;

      path.pop();
      used.delete(nxt);
    }
    return false;
  }

  const ok = await dfs(start);
  if (!ok) throw new Error(`解が見つかりませんでした（${label}）`);

  return path;
}

// ★ 60音(36..95)を全て1回ずつ使う
//   偶数を作って→奇数を作って→連結点だけチェック
async function makeTrials(n) {
  const poolAll = makeMidiPool(); // 36..95
  if (n !== poolAll.length) {
    throw new Error(`これは「範囲の全音を1回ずつ」前提です。n=${n}, pool=${poolAll.length}`);
  }

  const evenPool = poolAll.filter(m => m % 2 === 0);
  const oddPool  = poolAll.filter(m => m % 2 === 1);

  const MAX_TRIES = 200; // 失敗時の再試行上限

  for (let t = 1; t <= MAX_TRIES; t++) {
    elStatus.textContent = `試行生成中… try ${t}/${MAX_TRIES}`;

    // 偶数→奇数をそれぞれ作る
    const evenPath = await solveOnePool(evenPool, "even");
    const oddPath  = await solveOnePool(oddPool,  "odd");

    // 連結点チェック
    const a = evenPath[evenPath.length - 1];
    const b = oddPath[0];

    if (okAdj(a, b)) {
      const path = evenPath.concat(oddPath);

      // trials化
      return path.map((m) => {
        const { pc, oct } = midiToPcOct(m);
        return { midi: m, target: pc, oct, file: midiToFilename(m) };
      });
    }
    // 連結点がダメならやり直し
  }

  throw new Error("連結点の制約を満たせず、生成に失敗しました（再試行上限）。");
}

// ====== 課題進行 ======
async function startTest() {
    alreadySent = false;

    // 1実施 = 1 runId（ユニークID）
    runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

    ID = (elID.value || "").trim();
    if (!ID) {
      elStatus.textContent = "Please enter ID or Name.";
      return;
    }
  
    // UI固定
    btnDownload.disabled = true;
    btnStart.disabled = true;
    elID.disabled = true;
  
    // ここから音量チェック
    inVolumeCheck = true;
    btnVolPlay.disabled = false;
    btnVolOK.disabled = false;
  
    elStatus.textContent = "Volume Check: Adjust to a comfortable listening level.";
  }


  let trialTimeoutId = null;
  let respondedThisTrial = false;
  
  async function nextTrial() {

    if (trialTimeoutId) {
      clearTimeout(trialTimeoutId);
      trialTimeoutId = null;
    }
  
    trialIndex++;
  
    if (trialIndex >= trials.length) {
      finishTest();
      return;
    }
  
    current = trials[trialIndex];
    respondedThisTrial = false;
    canRespond = false;
  
    elStatus.textContent = `Trial ${trialIndex + 1} / ${trials.length} : Loading...`;
  
    try {
  
      const startAt = await playMidi(current.midi);
  
      const nowCtx = audioCtx.currentTime;
      const msUntilStart = Math.max(0, (startAt - nowCtx) * 1000);
  
      // 音オンセットの瞬間
      setTimeout(() => {
  
        tSoundOn = performance.now();
        canRespond = true;
  
        elStatus.textContent =
          `Trial ${trialIndex + 1} / ${trials.length} : Answer now`;
  
        // ★ここが重要
        // 音オンセットから5秒で必ず次へ
        trialTimeoutId = setTimeout(() => {
  
          if (!respondedThisTrial) {
  
            results.push({
              ID,
              trial: trialIndex + 1,
              midi: current.midi,
              file: current.file,
              target: current.target,
              target_solfege: midiToPcOct(current.midi).solfege,
              response: "",
              response_solfege: "",
              correct: 0,
              rt_ms: "",
              no_response: 1
            });
  
          }
  
          canRespond = false;
          nextTrial();
  
        }, TRIAL_MS);
  
      }, msUntilStart);
  
    } catch (e) {
  
      elStatus.textContent = String(e.message || e);
      btnStart.disabled = false;
      elID.disabled = false;
  
    }
  }

  function handleResponse(resp) {
    if (!canRespond || !current) return;
    if (respondedThisTrial) return; // 1trial 1回答
  
    const rt = performance.now() - tSoundOn;
    const correct = resp === current.target;
  
    const responseIdx = NOTE_NAMES.indexOf(resp);
    const responseSolfege = responseIdx >= 0 ? SOLFEGE_NAMES[responseIdx] : "";
  
    results.push({
      ID,
      trial: trialIndex + 1,
      midi: current.midi,
      file: current.file,
      target: current.target,
      target_solfege: midiToPcOct(current.midi).solfege,
      response: resp,
      response_solfege: responseSolfege,
      correct: correct ? 1 : 0,
      rt_ms: Math.round(rt),
      no_response: 0
    });
  
    respondedThisTrial = true;
  
    // すぐ次へ行かない：trialTimeoutが5秒後に進める
    elStatus.textContent = `Trial ${trialIndex + 1} / ${trials.length}：Waiting for the next sound...`;
  }


function finishTest() {
  const { nCorrect, total } = calcAccuracy();
  const accText = `${nCorrect} / ${total}`;
  
  elStatus.innerHTML = `
    <b>You're done!</b><br>
    Correct answers：<b>${accText}</b><br>
    Accuracy rate：<b>${Math.round((nCorrect / total) * 100)}%</b><br>
    Please click Download CSV or Save Result PDF.
    `;
    btnPdf.disabled = false;
    btnDownload.disabled = false;
    btnStart.disabled = false;
    elID.disabled = false;
    
    // --- 統合グラフ（正答率バー + 反応時間折れ線） ---
    const { labels, rates, totals } = calcAccuracyByPitchClass();
    const { meansSec, counts } = calcMeanRTByPitchClass();
    canvasAcc.style.display = "block";
    drawBarChartAccuracy(canvasAcc, labels, rates, totals, meansSec, counts);
    canvasRT.style.display = "none";

    // 画面リサイズで再描画（1回だけ設定）
    window.onresize = () => {
      drawBarChartAccuracy(canvasAcc, labels, rates, totals, meansSec, counts);
    };
  
}

function calcAccuracy() {
  const nCorrect = results.filter(r => r.correct === 1).length;
  const total = N_TRIALS;
  return { nCorrect, total };
}

function calcAccuracyByPitchClass() {
  // 12音の集計：targetごとに (correct数 / 出題数)
  const stat = {};
  NOTE_NAMES.forEach(n => stat[n] = { total: 0, correct: 0 });

  for (const r of results) {
    // trialが数値の行だけ（summary等が混ざっても無視できる）
    if (typeof r.trial !== "number") continue;
    if (!r.target || !(r.target in stat)) continue;

    stat[r.target].total += 1;
    if (r.correct === 1) stat[r.target].correct += 1;
  }

  const labels = NOTE_NAMES.slice();
  const rates = labels.map(n => {
    const { total, correct } = stat[n];
    return total ? (correct / total) : 0;
  });
  const totals = labels.map(n => stat[n].total);
  return { labels, rates, totals };
}

function labelForDisplay(pcSharp) {
  if (LABEL_MODE === "sharp") return pcSharp;
  const idx = NOTE_NAMES.indexOf(pcSharp);
  return idx >= 0 ? SOLFEGE_NAMES[idx] : pcSharp;
}

function drawBarChartAccuracy(canvas, labelsSharp, rates, totals, meansSec = [], rtCounts = []) {
  // ★ 鍵盤の幅に揃える
  const cssW = elKeyboard.getBoundingClientRect().width;
  const cssH = 250;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  // 余白
  const padL = 48, padR = 52, padT = 34, padB = 46;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  ctx.fillStyle = "#333";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Accuracy + Mean Reaction Time by Pitch Class", padL + plotW / 2, 13);
  ctx.font = "12px system-ui, sans-serif";

  // 軸（0〜100%）
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  // 目盛（0,50,100）
  ctx.fillStyle = "#333";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  [0, 0.5, 1].forEach(v => {
    const y = padT + plotH - v * plotH;
    ctx.strokeStyle = "#ddd";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();

    ctx.fillStyle = "#333";
    ctx.fillText(`${Math.round(v*100)}%`, padL - 6, y + 1);
  });

  // Bar
  const n = labelsSharp.length;
  const gap = 6;
  const barW = Math.max(6, (plotW - gap * (n - 1)) / n);

  ctx.fillStyle = "#4a78ff"; // ※色指定を避けたいならここを消して黒でもOK
  ctx.strokeStyle = "#333";

  for (let i = 0; i < n; i++) {
    const rate = rates[i];          // 0..1
    const x = padL + i * (barW + gap);
    const h = rate * plotH;
    const y = padT + plotH - h;

    const pc = labelsSharp[i];
    const black = pc.includes("#");

    ctx.fillStyle = black ? "#888" : "#fff";
    ctx.strokeStyle = "#333";

    ctx.fillRect(x, y, barW, h);
    ctx.strokeRect(x, y, barW, h);

    // xラベル（表示モードに合わせる）
    const lab = prettyLabel(labelForDisplay(labelsSharp[i]));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#333";
    ctx.fillText(lab, x + barW / 2, padT + plotH + 14);

    // 反応時間の有効データ数（n）
    if (rtCounts.length === n) {
      ctx.font = "10px system-ui, sans-serif";
      ctx.fillText(`n=${rtCounts[i]}`, x + barW / 2, padT + plotH + 30);
      ctx.font = "12px system-ui, sans-serif";
    }
  }

  if (meansSec.length === n) {
    const yMaxRT = 4.0; // 反応時間の右軸は 4.0s 固定

    // 右軸（反応時間）
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL + plotW, padT);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    ctx.fillStyle = "#2f5f86";
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    [0, 1, 2, 3, 4].forEach(rt => {
      const y = padT + plotH - (rt / yMaxRT) * plotH;
      ctx.fillText(`${rt.toFixed(1)}s`, padL + plotW + 6, y + 1);
    });

    // 折れ線（count=0は欠測として線を切る）
    ctx.strokeStyle = "#2f5f86";
    ctx.lineWidth = 2;
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < n; i++) {
      if ((rtCounts[i] || 0) <= 0) {
        drawing = false;
        continue;
      }
      const x = padL + i * (barW + gap) + barW / 2;
      const y = padT + plotH - (Math.min(meansSec[i], yMaxRT) / yMaxRT) * plotH;
      if (!drawing) {
        ctx.moveTo(x, y);
        drawing = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // 点と平均値ラベル
    for (let i = 0; i < n; i++) {
      if ((rtCounts[i] || 0) <= 0) continue;
      const x = padL + i * (barW + gap) + barW / 2;
      const y = padT + plotH - (Math.min(meansSec[i], yMaxRT) / yMaxRT) * plotH;

      ctx.fillStyle = "#2f5f86";
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${meansSec[i].toFixed(2)}s`, x, y - 8);
      ctx.font = "12px system-ui, sans-serif";
    }
  }
}

async function volumePlay() {
    try {
      await playMidi(VOLUME_CHECK_MIDI);
    } catch (e) {
      elStatus.textContent = String(e.message || e);
    }
  }
  
  async function volumeOK() {
    if (!inVolumeCheck) return;
  
    inVolumeCheck = false;
    btnVolPlay.disabled = true;
    btnVolOK.disabled = true;
  
    results = [];
    elStatus.textContent = "Generating trials...";
  
    try {
      trials = await makeTrials(N_TRIALS);  // ★ここ
    } catch (e) {
      elStatus.textContent = `Generation Error：${e.message}`;
      // ボタンを戻して再試行できるように
      btnVolPlay.disabled = false;
      btnVolOK.disabled = false;
      inVolumeCheck = true;
      return;
    }
  
    trialIndex = -1;
    elStatus.textContent = `The main trial will begin in 5 seconds...`;
  
    setTimeout(async () => {
      elStatus.textContent = "The trial begins";
      await nextTrial();
    }, START_DELAY_MS);
  }

// ====== CSV出力 ======
function toCSV(rows) {
  const header = Object.keys(rows[0] || {});
  const esc = (v) => {
    const s = String(v ?? "");
    return /[,"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const lines = [header.join(",")].concat(rows.map(r => header.map(h => esc(r[h])).join(",")));
  return lines.join("\n");
}

function downloadCSV() {
  if (!results.length) return;

  // ====== CSV生成 ======
  if (!results.length) return;

  const { nCorrect, total } = calcAccuracy();
  const accPercent = Math.round((nCorrect / total) * 100);
  const timestamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replaceAll(":", "-"); // for file name
  const csv = toCSV(results);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.download = `ap_${ID}_acc${accPercent}pct_${timestamp}.csv`;
  a.href = URL.createObjectURL(blob);
  a.click();
  URL.revokeObjectURL(a.href);
}

function saveResultAsPDF() {
  if (!results.length) return;

  // escapeHtml が無いときも落ちないようにする
  const esc = (typeof escapeHtml === "function")
    ? escapeHtml
    : (s) => String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

        function canvasToDataURLWithWhiteBG(canvas, scale = 3) {
          const tmp = document.createElement("canvas");
          tmp.width = Math.round(canvas.width * scale);
          tmp.height = Math.round(canvas.height * scale);
        
          const ctx = tmp.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, tmp.width, tmp.height);
          ctx.scale(scale, scale);
          ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        
          return tmp.toDataURL("image/png");
        }
        // ---- saveResultAsPDF 内 ----
        const accChartDataUrl = (canvasAcc && canvasAcc.style.display !== "none")
          ? canvasToDataURLWithWhiteBG(canvasAcc)
          : "";
        const rtChartDataUrl = "";

  const { nCorrect, total } = calcAccuracy();
  const accPct = Math.round((nCorrect / total) * 100);
  const dt = new Date().toLocaleString();

  const w = window.open("", "_blank");
  if (!w) {
    alert("ポップアップがブロックされました。ブラウザ設定で許可してください。");
    return;
  }

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>AP Result</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; }
  .card { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 10px; }
  .meta { color: #444; font-size: 14px; margin-bottom: 14px; }
  .kpi { font-size: 16px; margin: 8px 0; }
  img { width: 100%; height: auto; border: 1px solid #ddd; border-radius: 8px; }
  .note { margin-top: 14px; font-size: 12px; color: #666; }
  @media print { button { display: none; } }
</style>
</head>
<body>
  <div class="card">
    <h1>Absolute Pitch Test Result</h1>
    <div class="meta">ID/Name: <b>${esc(ID)}</b><br/>Date: ${esc(dt)}</div>
    <div class="kpi">Correct: <b>${nCorrect} / ${total}</b></div>
    <div class="kpi">Accuracy: <b>${accPct}%</b></div>

      ${accChartDataUrl ? `
    <h2 style="font-size:16px;margin:16px 0 8px;">Accuracy + Mean Reaction Time by Pitch Class</h2>
    <img src="${accChartDataUrl}" alt="Combined chart"/>
    ` : ""}

    ${rtChartDataUrl ? `
      <h2 style="font-size:16px;margin:16px 0 8px;">Mean Reaction Time by Pitch Class</h2>
      <img src="${rtChartDataUrl}" alt="RT chart"/>
    ` : ""}

    <div class="note">保存方法：PCは「PDFとして保存」、iPhoneは共有ボタンから「ファイルに保存」等を選択してください。</div>

    <div style="margin-top:16px;">
      <button onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>

  <script>
    // ★描画完了してから印刷（空白防止）
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 400);
    });
  </script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}


function setStatus(msg, isError=false) {
  elStatus.textContent = msg;
  elStatus.style.color = isError ? "crimson" : "#111";
}

// ===== 重複送信防止（送信は必ず1回だけ）=====
let alreadySent = false;

async function sendOnce() {
  console.log("sendOnce called", new Date().toISOString());

  if (alreadySent) {
    console.log("Already sent. Skip sending.");
    return true;
  }

  setStatus("Sending... (may take a few seconds)");

  const ok = await sendDataToGAS({
    ID,
    test: "AP_Test_v1",
    payload: { runId, results },
  });

  if (ok) {
    alreadySent = true;
    setStatus("Sent");
  } else {
    setStatus("Failed to send. Please check your connection and try again.", true);
  }

  return ok;
}

async function onDownloadCSV() {
  const ok = await sendOnce();
  if (!ok) return;
  downloadCSV(); // ← 保存だけ（送信しない）
}

async function onSavePDF() {
  const ok = await sendOnce();
  if (!ok) return;

  // printを開く前に少し待つ（Safari/iPhoneで送信が中断されるのを避ける）
  await new Promise(r => setTimeout(r, 800));

  saveResultAsPDF(); // ← save only（do not send）
}

function getDemographics() {
  const sex = (elSex?.value || "").trim();
  const age = (elAge?.value || "").trim();

  // instruments: 複数行を [{name,start,end}] で回収
  const rows = Array.from(document.querySelectorAll("#instRows .instRow"));
  const instruments = rows.map(r => {
    const nameSel = r.querySelector(".instName");
    const startEl = r.querySelector(".instStart");
    const endEl   = r.querySelector(".instEnd");
    const otherEl = r.querySelector(".instOther");

    let name = (nameSel?.value || "").trim();
    if (name === "other") {
      name = (otherEl?.value || "").trim();
    }

    const start = (startEl?.value || "").trim();
    const endRaw = (endEl?.value || "").trim();
    const end = endRaw.toLowerCase() === "present" ? "present" : endRaw;

    return { name, startAge: start, endAge: end };
  }).filter(x => x.name || x.startAge || x.endAge); // 空行は捨てる

  return { sex, age, instruments };
}

function wireInstrumentUI() {
  if (!btnAddInst) return;

  // other選択時だけ自由入力を表示
  const toggleOther = (row) => {
    const sel = row.querySelector(".instName");
    const other = row.querySelector(".instOther");
    if (!sel || !other) return;
    const isOther = sel.value === "other";
    other.style.display = isOther ? "inline-block" : "none";
  };

  // 既存1行にも付ける
  document.querySelectorAll("#instRows .instRow").forEach(r => {
    const sel = r.querySelector(".instName");
    if (sel) sel.addEventListener("change", () => toggleOther(r));
    toggleOther(r);
  });

  btnAddInst.addEventListener("click", () => {
    const base = document.querySelector("#instRows .instRow");
    if (!base) return;

    const clone = base.cloneNode(true);
    // 値をクリア
    clone.querySelectorAll("input").forEach(i => i.value = "");
    clone.querySelectorAll("select").forEach(s => s.value = "");
    // otherは隠す
    const other = clone.querySelector(".instOther");
    if (other) other.style.display = "none";

    // changeイベント付け直し
    const sel = clone.querySelector(".instName");
    if (sel) sel.addEventListener("change", () => {
      const o = clone.querySelector(".instOther");
      if (o) o.style.display = (sel.value === "other") ? "inline-block" : "none";
    });

    elInstRows.appendChild(clone);
  });
}

function calcMeanRTByPitchClass() {
  const stat = {};
  NOTE_NAMES.forEach(n => stat[n] = { sum: 0, n: 0 });

  for (const r of results) {
    if (typeof r.trial !== "number") continue;
    if (!r.target || !(r.target in stat)) continue;
    if (r.correct !== 1) continue; // RTは正答試行のみで平均
    if (r.rt_ms === "" || r.rt_ms == null || Number.isNaN(Number(r.rt_ms))) continue;

    stat[r.target].sum += Number(r.rt_ms);
    stat[r.target].n += 1;
  }

  const labels = NOTE_NAMES.slice();
  const meansSec = labels.map(n => {
    const s = stat[n];
    return s.n ? (s.sum / s.n) / 1000 : 0;
  });
  const counts = labels.map(n => stat[n].n);
  return { labels, meansSec, counts };
}

function drawBarChartRT(canvas, labelsSharp, meansSec, counts) {
  const cssW = elKeyboard.getBoundingClientRect().width;
  const cssH = 220;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cssW, cssH);

  const padL = 46, padR = 10, padT = 28, padB = 40;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  ctx.fillStyle = "#333";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Mean Reaction Time by Pitch Class", padL + plotW / 2, 12);
  ctx.font = "12px system-ui, sans-serif";

  const maxVal = Math.max(1.0, ...meansSec);
  const yMax = Math.ceil(maxVal * 10) / 10;

  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();

  const ticks = 4;
  ctx.fillStyle = "#333";
  ctx.font = "12px system-ui, sans-serif";
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const y = padT + plotH - (v / yMax) * plotH;
    ctx.strokeStyle = "#ddd";
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#333";
    ctx.fillText(`${v.toFixed(1)}s`, 4, y + 4);
  }

  const n = labelsSharp.length;
  const gap = 6;
  const barW = Math.max(6, (plotW - gap * (n - 1)) / n);

  for (let i = 0; i < n; i++) {
    const val = meansSec[i];
    const x = padL + i * (barW + gap);
    const h = (val / yMax) * plotH;
    const y = padT + plotH - h;

    const pc = labelsSharp[i];
    const black = pc.includes("#");

    ctx.fillStyle = black ? "#888" : "#fff";
    ctx.strokeStyle = "#333";
    ctx.fillRect(x, y, barW, h);
    ctx.strokeRect(x, y, barW, h);

    const lab = prettyLabel(labelForDisplay(labelsSharp[i]));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#333";
    ctx.fillText(lab, x + barW / 2, padT + plotH + 14);

    ctx.fillStyle = "#333";
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillText(`n=${counts[i]}`, x + 1, padT + plotH + 32);
    ctx.font = "12px system-ui, sans-serif";
  }
}

// ===== Instruments UI (minimal) =====
window.addInstrumentRow = function addInstrumentRow() {
  const elInstRows = document.getElementById("instRows");
  if (!elInstRows) return;

  elInstRows.insertAdjacentHTML("beforeend", `
    <div class="row instRow" style="margin:0;">
      <select class="instName" onchange="toggleOtherInput(this)">
        <option value="">Select...</option>
        <option value="non-musician">non-musician</option>
        <option value="piano">piano</option>
        <option value="violin">violin</option>
        <option value="flute">flute</option>
        <option value="clarinet">clarinet</option>
        <option value="saxophone">saxophone</option>
        <option value="trumpet">trumpet</option>
        <option value="trombone">trombone</option>
        <option value="cello">cello</option>
        <option value="guitar">guitar</option>
        <option value="voice">voice</option>
        <option value="other">other</option>
      </select>

      <input class="instStart" type="number" min="0" max="120" placeholder="start age" style="width:120px;" />
      <input class="instEnd" type="number" min="0" max="120" placeholder="end age" style="width:120px;" />
      <input class="instOther" type="text" placeholder="if other, type name" style="width:180px; display:none;" />
    </div>
  `);
};

  // other の時だけ自由入力を表示
  window.toggleOtherInput = function toggleOtherInput(sel) {
    const row = sel.closest(".instRow");
    const other = row.querySelector(".instOther");
    if (!other) return;
    other.style.display = (sel.value === "other") ? "inline-block" : "none";
  };

btnStart.addEventListener("click", startTest);
btnVolPlay.addEventListener("click", volumePlay);
btnVolOK.addEventListener("click", volumeOK);
//btnPdf.addEventListener("click", saveResultAsPDF);
//btnDownload.addEventListener("click", downloadCSV);
btnDownload.addEventListener("click", onDownloadCSV);
btnPdf.addEventListener("click", onSavePDF);
