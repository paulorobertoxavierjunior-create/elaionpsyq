/* ════════════════════════════════════════════════════════
   ELAYON PSI-Q • APP.JS
   Captura de presença vocal + JSON simbólico refinado
   Mantém TODAS as funções do painel original
════════════════════════════════════════════════════════ */

const btnMic     = document.getElementById('btnMic');
const btnRec     = document.getElementById('btnRec');
const btnStop    = document.getElementById('btnStop');
const btnClear   = document.getElementById('btnClear');

const statusEl   = document.getElementById('status');
const clockEl    = document.getElementById('clock');
const hintEl     = document.getElementById('hint');

const endBox     = document.getElementById('endBox');
const endMsg     = document.getElementById('endMsg');

const btnGoPsy   = document.getElementById('btnGoPsy');
const btnNew     = document.getElementById('btnNew');

const rtIdEl     = document.getElementById('rtId');
const localEl    = document.getElementById('local');

const barList    = document.getElementById('barList');

/* ════════════════════════════════════════════════════════
   BARRAS VISUAIS
════════════════════════════════════════════════════════ */

const bars = [
  { id:'presence', label:'Presença' },
  { id:'continuity', label:'Continuidade' },
  { id:'stability', label:'Estabilidade' },
  { id:'intensity', label:'Intensidade' },
  { id:'hesitation', label:'Hesitação' },
  { id:'breathing', label:'Respiração' },
  { id:'tension', label:'Tensão Vocal' },
  { id:'fluidity', label:'Fluidez' },
  { id:'silence', label:'Silêncio' },
  { id:'conviction', label:'Convicção' }
];

const BAR_STATE = {};

bars.forEach(b => {

  const row = document.createElement('div');
  row.className = 'barRow';

  const label = document.createElement('span');
  label.className = 'barLabel';
  label.innerText = b.label;

  const outer = document.createElement('div');
  outer.className = 'barOuter';

  const inner = document.createElement('div');
  inner.className = 'barInner';
  inner.style.width = '0%';

  outer.appendChild(inner);

  row.appendChild(label);
  row.appendChild(outer);

  barList.appendChild(row);

  BAR_STATE[b.id] = inner;
});

/* ════════════════════════════════════════════════════════
   ÁUDIO
════════════════════════════════════════════════════════ */

let stream = null;
let audioCtx = null;
let analyser = null;
let source = null;
let dataArray = null;

let mediaRecorder = null;
let audioChunks = [];

let started = false;
let timer = null;
let seconds = 0;

let frameHistory = [];
let speechFrames = [];
let silenceFrames = [];

let lastEnergy = 0;
let speaking = false;
let silenceStart = null;

const MAX_DURATION = 120;

/* ════════════════════════════════════════════════════════
   EXTRAÇÃO SENSÍVEL
════════════════════════════════════════════════════════ */

function analyzeFrame() {

  if (!analyser) return;

  analyser.getByteFrequencyData(dataArray);

  let sum = 0;
  let peak = 0;
  let low = 0;
  let mid = 0;
  let high = 0;

  for (let i = 0; i < dataArray.length; i++) {

    const v = dataArray[i];

    sum += v;

    if (v > peak) peak = v;

    if (i < 20) low += v;
    else if (i < 80) mid += v;
    else high += v;
  }

  const energy = sum / dataArray.length;

  const variance = Math.abs(energy - lastEnergy);

  lastEnergy = energy;

  const timestamp = Date.now();

  const frame = {
    t: timestamp,
    energy,
    variance,
    peak,
    low,
    mid,
    high
  };

  frameHistory.push(frame);

  if (frameHistory.length > 5000) {
    frameHistory.shift();
  }

  speaking = energy > 12;

  if (speaking) {
    speechFrames.push(frame);
    silenceStart = null;
  } else {
    silenceFrames.push(frame);

    if (!silenceStart) {
      silenceStart = timestamp;
    }
  }

  updatePresenceBars(frame);

  requestAnimationFrame(analyzeFrame);
}

/* ════════════════════════════════════════════════════════
   BARRAS
════════════════════════════════════════════════════════ */

function setBar(id, value) {

  const el = BAR_STATE[id];

  if (!el) return;

  const safe = Math.max(0, Math.min(100, value));

  el.style.width = safe + '%';
}

function updatePresenceBars(frame) {

  const energyNorm = frame.energy * 1.2;

  const continuity =
    Math.max(0,
      100 -
      (frame.variance * 3)
    );

  const stability =
    100 -
    Math.min(100, frame.variance * 4);

  const intensity =
    Math.min(100, frame.peak);

  const hesitation =
    Math.min(100,
      silenceFrames.length % 100
    );

  const breathing =
    Math.min(100,
      (frame.low / 25)
    );

  const tension =
    Math.min(100,
      ((frame.high - frame.low) / 4)
    );

  const fluidity =
    Math.max(0,
      100 -
      (tension * 0.8)
    );

  const silence =
    speaking ? 10 : 80;

  const conviction =
    Math.min(100,
      (
        continuity * 0.4 +
        intensity * 0.3 +
        stability * 0.3
      )
    );

  setBar('presence', energyNorm);
  setBar('continuity', continuity);
  setBar('stability', stability);
  setBar('intensity', intensity);
  setBar('hesitation', hesitation);
  setBar('breathing', breathing);
  setBar('tension', tension);
  setBar('fluidity', fluidity);
  setBar('silence', silence);
  setBar('conviction', conviction);
}

/* ════════════════════════════════════════════════════════
   MICROFONE
════════════════════════════════════════════════════════ */

btnMic.onclick = async () => {

  try {

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    audioCtx = new AudioContext();

    analyser = audioCtx.createAnalyser();

    analyser.fftSize = 512;

    source = audioCtx.createMediaStreamSource(stream);

    source.connect(analyser);

    dataArray = new Uint8Array(analyser.frequencyBinCount);

    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = e => {
      audioChunks.push(e.data);
    };

    statusEl.innerText = 'microfone ativo';

    btnRec.classList.remove('disabled');

    hintEl.innerText =
      'Microfone conectado. Quando quiser, inicie a escuta.';

    analyzeFrame();

  } catch (err) {

    console.error(err);

    alert('Falha ao acessar microfone.');
  }
};

/* ════════════════════════════════════════════════════════
   INICIAR
════════════════════════════════════════════════════════ */

btnRec.onclick = () => {

  if (!mediaRecorder) return;

  started = true;

  seconds = 0;

  audioChunks = [];
  frameHistory = [];
  speechFrames = [];
  silenceFrames = [];

  mediaRecorder.start();

  statusEl.innerText = 'escutando';

  btnStop.classList.remove('disabled');

  timer = setInterval(() => {

    seconds++;

    updateClock();

    if (seconds >= MAX_DURATION) {
      finishSession();
    }

  }, 1000);
};

/* ════════════════════════════════════════════════════════
   RELÓGIO
════════════════════════════════════════════════════════ */

function updateClock() {

  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');

  clockEl.innerText = `${m}:${s}`;
}

/* ════════════════════════════════════════════════════════
   FINALIZAR
════════════════════════════════════════════════════════ */

btnStop.onclick = finishSession;

function finishSession() {

  if (!started) return;

  started = false;

  clearInterval(timer);

  mediaRecorder.stop();

  statusEl.innerText = 'encerrado';

  const json = buildPresenceJSON();

  console.log('ELAYON_PRESENCE_JSON');
  console.log(json);

  localStorage.setItem(
    'elayon_last_session',
    JSON.stringify(json, null, 2)
  );

  endBox.classList.remove('hide');

  endMsg.innerText =
    'Sessão concluída. Os sinais simbólicos foram registrados localmente.';
}

/* ════════════════════════════════════════════════════════
   JSON SENSÍVEL
════════════════════════════════════════════════════════ */

function average(arr, key) {

  if (!arr.length) return 0;

  return (
    arr.reduce((a,b)=>a+b[key],0)
    / arr.length
  );
}

function buildPresenceJSON() {

  const avgEnergy     = average(speechFrames, 'energy');
  const avgVariance   = average(speechFrames, 'variance');
  const avgPeak       = average(speechFrames, 'peak');

  const lowFreq       = average(speechFrames, 'low');
  const midFreq       = average(speechFrames, 'mid');
  const highFreq      = average(speechFrames, 'high');

  const silenceRatio =
    silenceFrames.length /
    Math.max(1, frameHistory.length);

  const continuity =
    Math.max(0, 100 - avgVariance * 3);

  const stability =
    Math.max(0, 100 - avgVariance * 4);

  const symbolicState = inferState({
    avgEnergy,
    continuity,
    stability,
    silenceRatio,
    highFreq,
    lowFreq
  });

  return {

    protocolo: 'ELAYON-PSIQ-V1',

    timestamp: new Date().toISOString(),

    tecnico_local: rtIdEl.value || null,

    localidade: localEl.value || null,

    duracao_segundos: seconds,

    captura: {

      total_frames: frameHistory.length,

      fala_frames: speechFrames.length,

      silencio_frames: silenceFrames.length
    },

    metricas: {

      energia_media: round(avgEnergy),

      pico_medio: round(avgPeak),

      variacao_media: round(avgVariance),

      continuidade: round(continuity),

      estabilidade: round(stability),

      silencio_relativo: round(silenceRatio * 100),

      distribuicao_frequencia: {

        grave: round(lowFreq),

        medio: round(midFreq),

        agudo: round(highFreq)
      }
    },

    leitura_simbolica: symbolicState,

    assinatura_presenca: {

      intencao_percebida:
        symbolicState.intention,

      tonalidade_predominante:
        symbolicState.tonality,

      consistencia_emocional:
        symbolicState.consistency,

      nivel_pressao:
        symbolicState.pressure
    }
  };
}

/* ════════════════════════════════════════════════════════
   INFERÊNCIA SIMBÓLICA
════════════════════════════════════════════════════════ */

function inferState(d) {

  let intention = 'neutra';
  let tonality = 'equilibrada';
  let consistency = 'moderada';
  let pressure = 'baixa';

  if (d.avgEnergy > 35) {
    intention = 'expansiva';
  }

  if (d.silenceRatio > 0.45) {
    intention = 'retraída';
  }

  if (d.highFreq > d.lowFreq * 1.4) {
    tonality = 'tensa';
  }

  if (d.lowFreq > d.highFreq * 1.3) {
    tonality = 'profunda';
  }

  if (d.continuity > 70) {
    consistency = 'alta';
  }

  if (d.continuity < 40) {
    consistency = 'fragmentada';
  }

  if (d.avgEnergy > 40 && d.highFreq > d.lowFreq) {
    pressure = 'elevada';
  }

  return {
    intention,
    tonality,
    consistency,
    pressure
  };
}

function round(v) {
  return Math.round(v * 100) / 100;
}

/* ════════════════════════════════════════════════════════
   LIMPAR
════════════════════════════════════════════════════════ */

btnClear.onclick = () => {

  rtIdEl.value = '';
  localEl.value = '';

  localStorage.removeItem('elayon_last_session');

  endBox.classList.add('hide');

  bars.forEach(b => setBar(b.id,0));

  statusEl.innerText = 'pronto';

  clockEl.innerText = '00:00';
};

/* ════════════════════════════════════════════════════════
   NAVEGAÇÃO
════════════════════════════════════════════════════════ */

btnGoPsy.onclick = () => {
  window.location.href = './psicologo.html';
};

btnNew.onclick = () => {
  location.reload();
};

/* ════════════════════════════════════════════════════════
   ELAYON PSI-Q • ÁREA DO PSICÓLOGO
════════════════════════════════════════════════════════ */

const psyNameEl     = document.getElementById('psyName');
const psyCrpEl      = document.getElementById('psyCrp');

const btnSavePsy    = document.getElementById('btnSavePsy');
const btnReload     = document.getElementById('btnReload');

const btnBuild      = document.getElementById('btnBuild');
const btnCopy       = document.getElementById('btnCopy');
const btnDownload   = document.getElementById('btnDownload');

const listEl        = document.getElementById('list');
const outEl         = document.getElementById('out');

let selectedSession = null;
let generatedJSON   = null;

/* ════════════════════════════════════════════════════════
   SALVAR PSICÓLOGO
════════════════════════════════════════════════════════ */

if (btnSavePsy) {

  btnSavePsy.onclick = () => {

    const psy = {
      nome: psyNameEl.value,
      crp: psyCrpEl.value
    };

    localStorage.setItem(
      'elayon_psy_profile',
      JSON.stringify(psy)
    );

    alert('Identificação salva localmente.');
  };
}

/* ════════════════════════════════════════════════════════
   CARREGAR PERFIL
════════════════════════════════════════════════════════ */

(function loadPsychologistProfile(){

  const raw = localStorage.getItem('elayon_psy_profile');

  if (!raw) return;

  try {

    const psy = JSON.parse(raw);

    if (psyNameEl) psyNameEl.value = psy.nome || '';
    if (psyCrpEl) psyCrpEl.value = psy.crp || '';

  } catch(e) {
    console.error(e);
  }

})();

/* ════════════════════════════════════════════════════════
   RECARREGAR SESSÕES
════════════════════════════════════════════════════════ */

function loadSessions() {

  if (!listEl) return;

  listEl.innerHTML = '';

  let sessions = [];

  /* tenta múltiplas sessões */
  const rawMulti = localStorage.getItem('elayon_sessions');

  if (rawMulti) {

    try {
      sessions = JSON.parse(rawMulti);
    } catch(e) {
      console.error(e);
    }
  }

  /* fallback para sessão única */
  const rawSingle = localStorage.getItem('elayon_last_session');

  if (
    sessions.length === 0 &&
    rawSingle
  ) {

    try {
      sessions.push(JSON.parse(rawSingle));
    } catch(e) {
      console.error(e);
    }
  }

  if (!sessions.length) {

    listEl.innerHTML = `
      <div class="empty">
        Nenhuma sessão encontrada.
      </div>
    `;

    return;
  }

  sessions.reverse().forEach((session, index) => {

    const card = document.createElement('div');
    card.className = 'sessionCard';

    const symbolic = session.leitura_simbolica || {};

    card.innerHTML = `
      <div class="sessionTop">
        <div>
          <h3>Sessão ${index + 1}</h3>
          <p>
            ${new Date(session.timestamp).toLocaleString('pt-BR')}
          </p>
        </div>

        <button class="primary selectBtn">
          Selecionar
        </button>
      </div>

      <div class="sessionGrid">

        <div>
          <span>Intenção</span>
          <b>${symbolic.intention || '-'}</b>
        </div>

        <div>
          <span>Tonalidade</span>
          <b>${symbolic.tonality || '-'}</b>
        </div>

        <div>
          <span>Consistência</span>
          <b>${symbolic.consistency || '-'}</b>
        </div>

        <div>
          <span>Pressão</span>
          <b>${symbolic.pressure || '-'}</b>
        </div>

      </div>
    `;

    const btn = card.querySelector('.selectBtn');

    btn.onclick = () => {

      selectedSession = session;

      document
        .querySelectorAll('.sessionCard')
        .forEach(el => el.classList.remove('active'));

      card.classList.add('active');
    };

    listEl.appendChild(card);
  });
}

if (btnReload) {
  btnReload.onclick = loadSessions;
}

/* ════════════════════════════════════════════════════════
   GERAR JSON ANONIMIZADO
════════════════════════════════════════════════════════ */

if (btnBuild) {

  btnBuild.onclick = () => {

    if (!selectedSession) {
      alert('Selecione uma sessão primeiro.');
      return;
    }

    generatedJSON = {

      protocolo: 'ELAYON-PSIQ-ANON',

      gerado_em: new Date().toISOString(),

      revisado_por: {
        crp: psyCrpEl.value || null
      },

      sessao: {

        timestamp: selectedSession.timestamp,

        duracao_segundos:
          selectedSession.duracao_segundos,

        metricas:
          selectedSession.metricas,

        leitura_simbolica:
          selectedSession.leitura_simbolica,

        assinatura_presenca:
          selectedSession.assinatura_presenca
      }
    };

    outEl.value = JSON.stringify(
      generatedJSON,
      null,
      2
    );

    btnCopy.classList.remove('disabled');
    btnDownload.classList.remove('disabled');
  };
}

/* ════════════════════════════════════════════════════════
   COPIAR
════════════════════════════════════════════════════════ */

if (btnCopy) {

  btnCopy.onclick = async () => {

    if (!generatedJSON) return;

    await navigator.clipboard.writeText(
      JSON.stringify(generatedJSON, null, 2)
    );

    alert('JSON copiado.');
  };
}

/* ════════════════════════════════════════════════════════
   DOWNLOAD
════════════════════════════════════════════════════════ */

if (btnDownload) {

  btnDownload.onclick = () => {

    if (!generatedJSON) return;

    const blob = new Blob(
      [JSON.stringify(generatedJSON, null, 2)],
      { type:'application/json' }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download =
      `elayon_relatorio_${Date.now()}.json`;

    a.click();

    URL.revokeObjectURL(url);
  };
}

/* ════════════════════════════════════════════════════════
   AUTOLOAD
════════════════════════════════════════════════════════ */

loadSessions();