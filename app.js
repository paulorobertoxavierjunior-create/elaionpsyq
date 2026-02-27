/* Elayon PSI-Q — app.js
   - Coleta (index.html): grava áudio (até 2min), mostra barras, salva sessão em IndexedDB
   - Psicólogo (psicologo.html): lista sessões, toca áudio, anota, exporta JSON anon.
   - Secretaria (secretaria.html): lê JSON anon e exibe resumo
*/

(() => {
  const PAGE = document.title.toLowerCase();

  // ========= helpers =========
  const $ = (id) => document.getElementById(id);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtClock = (sec) => `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
  const nowIso = () => new Date().toISOString();
  const uid = () => Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);

  // ========= IndexedDB (audio + sessões) =========
  const DB_NAME = "elayonpsiq_db";
  const DB_VER = 1;
  const STORE = "sessions";

  function dbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("createdAt", "createdAt");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(session) {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(session);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetAll() {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGet(id) {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDelete(id) {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // ========= Bars model (integral + dinâmica) =========
  const BAR_NAMES = [
    "Energia",
    "Constância",
    "Clareza",
    "Ritmo",
    "Foco",
    "Expansão",
    "Motivação",
    "Estabilidade"
  ];

  function mountBars(containerId) {
    const host = $(containerId);
    if (!host) return null;
    host.innerHTML = "";
    const fills = [];
    const vals = [];
    BAR_NAMES.forEach((name) => {
      const row = document.createElement("div");
      row.className = "barRow";
      row.innerHTML = `
        <div class="barLabel">${name}</div>
        <div class="track"><div class="fill"></div></div>
        <div class="val">0%</div>
      `;
      host.appendChild(row);
      fills.push(row.querySelector(".fill"));
      vals.push(row.querySelector(".val"));
    });
    return { fills, vals };
  }

  // ========= Audio / analyzer =========
  const AudioCore = {
    stream: null,
    ctx: null,
    src: null,
    analyser: null,
    data: null,
    raf: 0,
    onFrame: null,

    async start() {
      if (this.stream) return;
      // importante: precisa ser HTTPS (GitHub Pages é OK)
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.data = new Uint8Array(this.analyser.fftSize);

      this.src.connect(this.analyser);

      const loop = () => {
        this.analyser.getByteTimeDomainData(this.data);
        if (this.onFrame) this.onFrame(this.data);
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    },

    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;

      try { this.src && this.src.disconnect(); } catch(_) {}
      try { this.ctx && this.ctx.close(); } catch(_) {}

      if (this.stream) {
        this.stream.getTracks().forEach(t => t.stop());
      }
      this.stream = null;
      this.ctx = null;
      this.src = null;
      this.analyser = null;
      this.data = null;
      this.onFrame = null;
    }
  };

  function rmsFromTimeDomain(u8) {
    // u8 centered at 128
    let sum = 0;
    for (let i = 0; i < u8.length; i++) {
      const v = (u8[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / u8.length); // 0..~1
  }

  // ========= Recorder =========
  function makeRecorder(stream) {
    const mimeCandidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus"
    ];
    let mimeType = "";
    for (const m of mimeCandidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) { mimeType = m; break; }
    }
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    return { rec, chunks };
  }

  // ========= PERSISTED SETTINGS (psychologist identity) =========
  const LS_PSY = "elayonpsiq_psy";
  function loadPsy() {
    try { return JSON.parse(localStorage.getItem(LS_PSY) || "{}"); } catch(_) { return {}; }
  }
  function savePsy(obj) {
    localStorage.setItem(LS_PSY, JSON.stringify(obj || {}));
  }

  // ========= Page: Coleta =========
  async function initColeta() {
    const bars = mountBars("barList");
    if (!bars) return;

    const statusEl = $("status");
    const clockEl = $("clock");
    const hintEl = $("hint");

    const btnMic = $("btnMic");
    const btnRec = $("btnRec");
    const btnStop = $("btnStop");
    const btnClear = $("btnClear");

    const endBox = $("endBox");
    const endMsg = $("endMsg");
    const btnGoPsy = $("btnGoPsy");
    const btnNew = $("btnNew");

    const rtId = $("rtId");
    const local = $("local");

    let micOn = false;
    let recording = false;

    // dinâmica desejada:
    // - update visual 200ms
    // - subida um pouco mais lenta (expo)
    // - começa a descer assim que entra silêncio
    // - desce mais devagar (mas sem "demorar para começar")
    const DT = 0.2; // 200ms

    // estados internos (0..1)
    const S = new Array(BAR_NAMES.length).fill(0);

    // acumuladores
    let t = 0;
    let speakTime = 0;
    let silenceTime = 0;

    // sinal
    let lastRms = 0;
    let rmsAvg = 0;
    let rmsVar = 0;

    // threshold adaptativo leve
    let noiseFloor = 0.015; // começa baixo; ajusta
    const floorRise = 0.02; // quanto o piso pode subir em ruído
    const floorFall = 0.002;

    // relógio
    let sec = 0;
    let tick = 0;
    let stopAt = 120; // 2 min

    // recorder / result
    let recorder = null;
    let recChunks = [];
    let recMime = "audio/webm";
    let sessionId = "";

    function setStatus(txt) { if (statusEl) statusEl.textContent = txt; }
    function setHint(txt) { if (hintEl) hintEl.textContent = txt; }

    function renderBars() {
      for (let i = 0; i < S.length; i++) {
        const pct = Math.round(clamp01(S[i]) * 100);
        bars.fills[i].style.width = pct + "%";
        bars.vals[i].textContent = pct + "%";
      }
    }

    function resetBars() {
      for (let i = 0; i < S.length; i++) S[i] = 0;
      renderBars();
      speakTime = 0;
      silenceTime = 0;
      t = 0;
      rmsAvg = 0;
      rmsVar = 0;
      lastRms = 0;
    }

    function scoreStep(isSpeaking, rms, rmsStability) {
      // alvos 0..1 (baseados no input)
      // energia: rms
      // constância: estabilidade do rms + continuidade de fala
      // clareza: fala com rms acima do piso e sem tremulação (aprox)
      // ritmo: continuidade (fala sem muitos buracos)
      // foco: fala contínua (menos pausas curtas)
      // expansão: tempo falando (sobe com o tempo)
      // motivação: continuidade + energia moderada
      // estabilidade: baixa variância + constância

      const cont = clamp01(speakTime / 12); // 12s para "encher" bem
      const energy = clamp01((rms - noiseFloor) / 0.12); // ajustável
      const stab = clamp01(rmsStability); // 0..1

      const T = new Array(8).fill(0);
      T[0] = isSpeaking ? energy : 0;                         // Energia
      T[1] = isSpeaking ? clamp01(0.55*stab + 0.45*cont) : 0; // Constância
      T[2] = isSpeaking ? clamp01(0.55*stab + 0.45*energy) : 0;// Clareza
      T[3] = isSpeaking ? clamp01(0.25 + 0.75*cont) : 0;      // Ritmo
      T[4] = isSpeaking ? clamp01(0.30 + 0.70*cont) : 0;      // Foco
      T[5] = isSpeaking ? clamp01(cont) : 0;                  // Expansão
      T[6] = isSpeaking ? clamp01(0.50*cont + 0.50*energy) : 0;// Motivação
      T[7] = isSpeaking ? clamp01(0.65*stab + 0.35*cont) : 0; // Estabilidade

      // SUBIDA: expo mais lenta (alpha menor)
      // DESCIDA: começa imediatamente no silêncio e desce de modo linear (beta)
      const alphaUp = 0.20;   // menor = sobe mais lento e mais estável
      const betaDown = 0.055; // menor = desce mais devagar

      for (let i = 0; i < S.length; i++) {
        if (isSpeaking) {
          S[i] = S[i] + (T[i] - S[i]) * alphaUp;
        } else {
          S[i] = Math.max(0, S[i] - betaDown);
        }
      }
    }

    function computeStability(rms) {
      // média + variância exponencial (quanto menor a variância, maior estabilidade)
      const a = 0.08;
      rmsAvg = rmsAvg + (rms - rmsAvg) * a;
      const diff = rms - rmsAvg;
      rmsVar = rmsVar + (diff*diff - rmsVar) * a;
      const st = 1 / (1 + (rmsVar * 900)); // escala
      return clamp01(st);
    }

    function update200ms() {
      if (!micOn) return;

      t += DT;

      // speaking detection
      const rms = lastRms;

      // ajusta noiseFloor devagar (pra não “virar palavra” com ruído)
      if (rms < noiseFloor) {
        noiseFloor = Math.max(0.008, noiseFloor - floorFall);
      } else {
        // sobe piso só um pouco quando ambiente está ruidoso
        noiseFloor = Math.min(0.05, noiseFloor + floorRise * 0.01);
      }

      const speaking = (rms > (noiseFloor + 0.010));

      if (speaking) {
        speakTime += DT;
        silenceTime = 0;
      } else {
        silenceTime += DT;
        speakTime = Math.max(0, speakTime - DT * 0.30); // reduz continuidade lentamente
      }

      const stability = computeStability(rms);

      scoreStep(speaking, rms, stability);
      renderBars();
    }

    function setButtons() {
      btnRec.classList.toggle("disabled", !micOn || recording);
      btnStop.classList.toggle("disabled", !recording);
      btnMic.textContent = micOn ? "Desativar microfone" : "Ativar microfone";
      btnMic.classList.toggle("primary", !micOn);
      btnMic.classList.toggle("ghost", micOn);
      setStatus(micOn ? (recording ? "gravando" : "ligado") : "pronto");
    }

    async function micToggle() {
      if (!micOn) {
        try {
          await AudioCore.start();
          micOn = true;

          AudioCore.onFrame = (u8) => {
            const rms = rmsFromTimeDomain(u8);
            // suaviza o rms para reduzir tremulação
            lastRms = lastRms + (rms - lastRms) * 0.25;
          };

          if (!tick) tick = setInterval(update200ms, 200);
          setHint("Microfone ativo. Quando estiver pronto, inicie a escuta.");
        } catch (e) {
          micOn = false;
          setHint("Não foi possível acessar o microfone. Verifique permissões do navegador.");
        }
      } else {
        if (recording) return; // não deixa desligar no meio da gravação
        micOn = false;
        AudioCore.stop();
        if (tick) { clearInterval(tick); tick = 0; }
        resetBars();
        setHint("Microfone desativado.");
      }
      setButtons();
    }

    function startClock() {
      sec = 0;
      clockEl.textContent = fmtClock(sec);
    }

    function updateClock() {
      sec += 1;
      clockEl.textContent = fmtClock(sec);
      if (sec >= stopAt) stopRecording();
    }

    let clockTimer = 0;

    function startRecording() {
      if (!micOn || recording) return;

      sessionId = uid();
      recording = true;
      endBox.classList.add("hide");

      // gravação
      const { rec, chunks } = makeRecorder(AudioCore.stream);
      recorder = rec;
      recChunks = chunks;
      recMime = recorder.mimeType || "audio/webm";

      recorder.start(250); // chunks curtos (seguro)
      setHint("Escuta em andamento. Você pode finalizar antes de 2 minutos.");

      // relógio
      startClock();
      if (clockTimer) clearInterval(clockTimer);
      clockTimer = setInterval(updateClock, 1000);

      setButtons();
    }

    async function stopRecording() {
      if (!recording) return;
      recording = false;

      if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }

      try { recorder && recorder.stop(); } catch(_) {}
      setButtons();

      // espera fechar o último chunk
      setTimeout(async () => {
        const blob = new Blob(recChunks, { type: recMime });
        const meta = buildMetaFromBars();

        const session = {
          id: sessionId,
          createdAt: nowIso(),
          rtId: (rtId.value || "").trim(),
          local: (local.value || "").trim(),
          durationSec: sec,
          barsFinal: meta.barsFinal,
          barsAvg: meta.barsAvg,
          peaks: meta.peaks,
          audio: blob,
          note: "" // psicólogo pode preencher depois
        };

        await dbPut(session);

        setHint("Sessão salva. O psicólogo pode revisar e ouvir o áudio.");
        showEndMessage(meta);
      }, 350);
    }

    function buildMetaFromBars() {
      // pega fotografia final + uma “média simples” aproximada
      // (para a apresentação, isso já dá valor; depois refinamos)
      // Como não armazenamos histórico completo, usamos:
      // - final = estado atual
      // - avg = final * 0.75 (aprox) para não “inflar”
      // - peak = final (por enquanto)
      const final = S.map(x => clamp01(x));
      const avg = final.map(x => clamp01(x * 0.75));
      const peaks = final.map(x => clamp01(x));
      return {
        barsFinal: final,
        barsAvg: avg,
        peaks
      };
    }

    function showEndMessage(meta) {
      endBox.classList.remove("hide");

      const topIdx = [...meta.barsFinal]
        .map((v, i) => ({ v, i }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 2)
        .map(x => BAR_NAMES[x.i]);

      endMsg.textContent =
        `Obrigado pela presença. Hoje você mostrou ${topIdx[0]} e ${topIdx[1]} de forma bonita e viva. ` +
        `Siga no seu ritmo — o que é sincero cresce.`;

      btnRec.classList.add("disabled");
      btnStop.classList.add("disabled");
    }

    // buttons
    btnMic.addEventListener("click", micToggle);
    btnRec.addEventListener("click", startRecording);
    btnStop.addEventListener("click", stopRecording);

    btnClear.addEventListener("click", () => {
      rtId.value = "";
      local.value = "";
      resetBars();
      setHint("Campos limpos. Pronto para iniciar uma nova sessão.");
    });

    btnGoPsy.addEventListener("click", () => {
      window.location.href = "./psicologo.html";
    });

    btnNew.addEventListener("click", () => {
      endBox.classList.add("hide");
      resetBars();
      setHint("Pronto. Se desejar, ative o microfone e inicie uma nova escuta.");
    });

    // init bars + status
    resetBars();
    setButtons();
    setHint("Leia as regras, ative o microfone e inicie a escuta.");
  }

  // ========= Page: Psicólogo =========
  async function initPsicologo() {
    const list = $("list");
    const out = $("out");
    const btnBuild = $("btnBuild");
    const btnCopy = $("btnCopy");
    const btnDownload = $("btnDownload");
    const btnReload = $("btnReload");

    const psyName = $("psyName");
    const psyCrp = $("psyCrp");
    const btnSavePsy = $("btnSavePsy");

    const psy = loadPsy();
    psyName.value = psy.name || "";
    psyCrp.value = psy.crp || "";

    btnSavePsy.addEventListener("click", () => {
      savePsy({ name: psyName.value.trim(), crp: psyCrp.value.trim() });
      btnSavePsy.textContent = "Salvo";
      setTimeout(() => btnSavePsy.textContent = "Salvar", 900);
    });

    btnReload.addEventListener("click", () => renderList());

    async function renderList() {
      const sessions = (await dbGetAll())
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

      list.innerHTML = "";
      if (!sessions.length) {
        list.innerHTML = `<div class="item"><b>Nenhuma sessão salva ainda.</b><div class="muted">Volte em Coleta e registre uma sessão.</div></div>`;
        return;
      }

      sessions.forEach((s) => {
        const el = document.createElement("div");
        el.className = "item";

        const created = new Date(s.createdAt).toLocaleString();
        const rt = s.rtId ? s.rtId : "RT (não informado)";
        const loc = s.local ? s.local : "Local (não informado)";

        const bars = (s.barsFinal || []).map(v => Math.round((v || 0)*100));
        const top = bars
          .map((v, i) => ({ v, i }))
          .sort((a, b) => b.v - a.v)
          .slice(0, 3)
          .map(x => `${BAR_NAMES[x.i]} ${x.v}%`)
          .join(" • ");

        el.innerHTML = `
          <div class="itemTop">
            <div><b>${created}</b></div>
            <div>${rt} • ${loc} • ${s.durationSec || 0}s</div>
          </div>
          <h4>Sessão ${s.id}</h4>
          <div class="muted">Destaques: ${top || "—"}</div>

          <div class="audioBox">
            <div class="muted"><b>Áudio (apenas psicólogo)</b></div>
            <audio controls preload="metadata"></audio>
          </div>

          <div class="note">
            <label>Observação do psicólogo (local)</label>
            <textarea placeholder="Anotações técnicas (não são enviadas para secretaria automaticamente)."></textarea>
            <div class="btns">
              <button class="primary btnSaveNote">Salvar observação</button>
              <button class="ghost btnDelete">Excluir sessão</button>
            </div>
          </div>
        `;

        const audio = el.querySelector("audio");
        const url = URL.createObjectURL(s.audio);
        audio.src = url;

        const ta = el.querySelector("textarea");
        ta.value = s.note || "";

        el.querySelector(".btnSaveNote").addEventListener("click", async () => {
          const cur = await dbGet(s.id);
          if (!cur) return;
          cur.note = ta.value;
          await dbPut(cur);
        });

        el.querySelector(".btnDelete").addEventListener("click", async () => {
          const ok = confirm("Excluir esta sessão do dispositivo?");
          if (!ok) return;
          await dbDelete(s.id);
          renderList();
        });

        list.appendChild(el);
      });
    }

    function buildAnonReport(sessions) {
      const psyLocal = loadPsy();
      const header = {
        tool: "Elayon PSI-Q",
        generatedAt: nowIso(),
        psychologist: {
          name: psyLocal.name || "",
          crp: psyLocal.crp || ""
        },
        note: "Relatório anonimizador: sem áudio e sem identificação de pessoa."
      };

      const items = sessions.map((s) => {
        const barsFinal = (s.barsFinal || []).map(v => clamp01(v));
        const barsAvg = (s.barsAvg || []).map(v => clamp01(v));
        const peaks = (s.peaks || []).map(v => clamp01(v));

        return {
          sessionId: s.id,
          createdAt: s.createdAt,
          durationSec: s.durationSec || 0,
          rtId: s.rtId || "",
          local: s.local || "",
          barsFinal,
          barsAvg,
          peaks
        };
      });

      // agregados simples
      const n = items.length || 1;
      const agg = {
        sessions: items.length,
        avgDurationSec: Math.round(items.reduce((a, x) => a + (x.durationSec || 0), 0) / n),
        avgBarsFinal: BAR_NAMES.map((_, i) => {
          const m = items.reduce((a, x) => a + (x.barsFinal[i] || 0), 0) / n;
          return clamp01(m);
        })
      };

      return { header, agg, items };
    }

    btnBuild.addEventListener("click", async () => {
      const sessions = await dbGetAll();
      const report = buildAnonReport(sessions);
      out.value = JSON.stringify(report, null, 2);
      btnCopy.classList.remove("disabled");
      btnDownload.classList.remove("disabled");
    });

    btnCopy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(out.value || "");
      btnCopy.textContent = "Copiado";
      setTimeout(() => btnCopy.textContent = "Copiar", 900);
    });

    btnDownload.addEventListener("click", () => {
      const blob = new Blob([out.value || ""], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `elayonpsiq_relatorio_anon_${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 500);
    });

    await renderList();
  }

  // ========= Page: Secretaria =========
  function initSecretaria() {
    const input = $("in");
    const summary = $("summary");
    const cards = $("cards");
    const btnParse = $("btnParse");
    const btnClear = $("btnClear");

    btnParse.addEventListener("click", () => {
      cards.innerHTML = "";
      try {
        const obj = JSON.parse(input.value || "{}");
        const h = obj.header || {};
        const agg = obj.agg || {};
        const items = obj.items || [];

        summary.innerHTML =
          `<b>Relatório:</b> ${h.tool || "—"}<br>` +
          `<b>Gerado em:</b> ${h.generatedAt ? new Date(h.generatedAt).toLocaleString() : "—"}<br>` +
          `<b>Sessões:</b> ${agg.sessions ?? items.length ?? 0}<br>` +
          `<b>Duração média:</b> ${agg.avgDurationSec ?? "—"}s`;

        if (!items.length) {
          cards.innerHTML = `<div class="item"><b>Nenhuma sessão no relatório.</b></div>`;
          return;
        }

        items.forEach((it) => {
          const el = document.createElement("div");
          el.className = "item";

          const created = it.createdAt ? new Date(it.createdAt).toLocaleString() : "—";
          const rt = it.rtId || "RT";
          const loc = it.local || "Local";

          const bars = (it.barsFinal || []).map(v => Math.round((v || 0) * 100));
          const top = bars
            .map((v, i) => ({ v, i }))
            .sort((a, b) => b.v - a.v)
            .slice(0, 3)
            .map(x => `${BAR_NAMES[x.i]} ${x.v}%`)
            .join(" • ");

          el.innerHTML = `
            <div class="itemTop">
              <div><b>${created}</b></div>
              <div>${rt} • ${loc} • ${(it.durationSec || 0)}s</div>
            </div>
            <h4>Sessão ${it.sessionId}</h4>
            <div class="muted">Destaques: ${top || "—"}</div>
          `;
          cards.appendChild(el);
        });

      } catch (e) {
        summary.textContent = "JSON inválido. Confira se o conteúdo foi copiado completo.";
      }
    });

    btnClear.addEventListener("click", () => {
      input.value = "";
      summary.textContent = "Nenhum relatório carregado.";
      cards.innerHTML = "";
    });
  }

  // ========= Router =========
  document.addEventListener("DOMContentLoaded", () => {
    // garante que os botões e navegação não quebrem em páginas erradas
    if (PAGE.includes("coleta")) initColeta();
    else if (PAGE.includes("psicólogo") || PAGE.includes("psicologo")) initPsicologo();
    else if (PAGE.includes("secretaria")) initSecretaria();
    else {
      // fallback: tenta detectar pelo DOM
      if ($("btnMic") && $("btnRec")) initColeta();
      if ($("psyCrp") && $("btnBuild")) initPsicologo();
      if ($("btnParse") && $("summary")) initSecretaria();
    }
  });
})();