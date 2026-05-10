/**
 * ELAYON · CRS SIGNAL ENGINE v5
 * app.js
 *
 * Mantém:
 * - memória contextual
 * - classificação
 * - guidance
 * - baseline
 * - detecção relacional
 *
 * Adiciona:
 * - análise temporal real
 * - timeline prosódica
 * - sustentação vocálica
 * - dinâmica de intenção
 * - coerência temporal
 * - ataques vocais
 * - presença harmônica
 * - explicabilidade
 *
 * ============================================================
 * INSTALL
 * ============================================================
 *
 * npm install express multer cors axios meyda node-wav
 *
 * ============================================================
 */

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const axios = require("axios");
const wav = require("node-wav");
const fs = require("fs");
const Meyda = require("meyda");

const app = express();

app.use(cors());
app.use(express.json());

const upload = multer({
  dest: "tmp/"
});

/* ============================================================
   ENV
============================================================ */

const SUPABASE_URL =
  (process.env.SUPABASE_URL || "").replace(/\/$/, "");

const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "";

/* ============================================================
   MEMORY
============================================================ */

const MEMORY = {};

/* ============================================================
   CONFIG
============================================================ */

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;

const SILENCE_THRESHOLD = 0.015;

/* ============================================================
   HELPERS
============================================================ */

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function toFloat(value, def = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : def;
}

function toInt(value, def = 0) {
  const n = parseInt(value);
  return Number.isFinite(n) ? n : def;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;

  const mean = avg(arr);

  const variance =
    arr.reduce((s, v) => s + Math.pow(v - mean, 2), 0) /
    arr.length;

  return Math.sqrt(variance);
}

function deltaSeries(values) {
  const deltas = [];

  for (let i = 1; i < values.length; i++) {
    deltas.push(Math.abs(values[i] - values[i - 1]));
  }

  return deltas;
}

function percentile(arr, p) {
  if (!arr.length) return 0;

  const sorted = [...arr].sort((a, b) => a - b);

  const idx = Math.floor((p / 100) * sorted.length);

  return sorted[idx];
}

/* ============================================================
   AUTH
============================================================ */

function getBearerToken(req) {
  const auth =
    (req.headers.authorization || "").trim();

  if (!auth.startsWith("Bearer ")) {
    return null;
  }

  return auth.slice(7).trim();
}

async function validateSupabaseUser(token) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return [false, "configuração ausente", null];
    }

    const res = await axios.get(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`
        },
        timeout: 8000
      }
    );

    return [true, "ok", res.data];
  } catch (err) {
    return [false, "token inválido", null];
  }
}

/* ============================================================
   MEMORY
============================================================ */

function getUserMemory(userId) {
  if (!MEMORY[userId]) {
    MEMORY[userId] = [];
  }

  return MEMORY[userId];
}

function storeMemory(userId, data) {
  const history = getUserMemory(userId);

  history.push(data);

  MEMORY[userId] = history.slice(-10);
}

function buildBaseline(history) {
  if (!history.length) {
    return {
      energy: 0,
      continuity: 0,
      oscillation: 0,
      silence: 0,
      intentional_presence: 0
    };
  }

  return {
    energy: avg(history.map(x => x.energy_pct)),
    continuity: avg(history.map(x => x.continuity_pct)),
    oscillation: avg(history.map(x => x.oscillation_pct)),
    silence: avg(history.map(x => x.silence_pct)),
    intentional_presence: avg(
      history.map(x => x.intentional_presence || 0)
    )
  };
}

/* ============================================================
   TEMPORAL EXTRACTION
============================================================ */

function extractFeatures(audioBuffer, sampleRate) {
  const timeline = [];

  const energies = [];
  const centroids = [];
  const flatnesses = [];
  const zcrs = [];
  const mfccFrames = [];

  let silenceFrames = 0;

  for (
    let i = 0;
    i < audioBuffer.length - FRAME_SIZE;
    i += HOP_SIZE
  ) {
    const frame = audioBuffer.slice(
      i,
      i + FRAME_SIZE
    );

    const features = Meyda.extract(
      [
        "rms",
        "zcr",
        "spectralCentroid",
        "spectralFlatness",
        "mfcc"
      ],
      frame,
      {
        sampleRate,
        bufferSize: FRAME_SIZE
      }
    );

    if (!features) continue;

    const t = i / sampleRate;

    const energy = features.rms || 0;

    const silence =
      energy < SILENCE_THRESHOLD;

    if (silence) silenceFrames++;

    const centroid =
      features.spectralCentroid || 0;

    const flatness =
      features.spectralFlatness || 0;

    energies.push(energy);
    centroids.push(centroid);
    flatnesses.push(flatness);
    zcrs.push(features.zcr || 0);

    mfccFrames.push(features.mfcc || []);

    timeline.push({
      t: Number(t.toFixed(3)),
      energy: Number(energy.toFixed(6)),
      silence,
      centroid: Number(centroid.toFixed(2)),
      flatness: Number(flatness.toFixed(6)),
      zcr: Number(
        (features.zcr || 0).toFixed(6)
      )
    });
  }

  /* ============================================================
     CORE METRICS
  ============================================================ */

  const energyMean = avg(energies);

  const energyStd = std(energies);

  const continuityPct =
    100 -
    clamp(
      (energyStd / (energyMean + 0.0001)) * 100,
      0,
      100
    );

  const silencePct =
    (silenceFrames / timeline.length) * 100;

  const oscillationPct =
    clamp(
      avg(deltaSeries(energies)) * 1200,
      0,
      100
    );

  const stabilityPct =
    100 -
    clamp(std(centroids) / 40, 0, 100);

  const noisePct =
    clamp(avg(flatnesses) * 100, 0, 100);

  /* ============================================================
     VOWEL HOLD
  ============================================================ */

  let sustainFrames = 0;
  let vowelHoldMs = 0;

  for (let i = 1; i < energies.length; i++) {
    const stable =
      Math.abs(
        centroids[i] - centroids[i - 1]
      ) < 120;

    const voiced =
      energies[i] > SILENCE_THRESHOLD;

    if (stable && voiced) {
      sustainFrames++;
    } else {
      vowelHoldMs +=
        (sustainFrames * HOP_SIZE * 1000) /
        sampleRate;

      sustainFrames = 0;
    }
  }

  /* ============================================================
     ATTACK PROFILE
  ============================================================ */

  const attacks = [];

  for (let i = 1; i < energies.length; i++) {
    const delta =
      energies[i] - energies[i - 1];

    if (delta > 0.03) {
      attacks.push(delta);
    }
  }

  const attackIntensity =
    clamp(avg(attacks) * 1000, 0, 100);

  /* ============================================================
     TEMPORAL TENDENCY
  ============================================================ */

  const firstHalf = avg(
    energies.slice(0, energies.length / 2)
  );

  const secondHalf = avg(
    energies.slice(energies.length / 2)
  );

  const energyTrend =
    secondHalf - firstHalf;

  /* ============================================================
     INTENTIONAL PRESENCE
  ============================================================ */

  const intentionalPresence =
    continuityPct * 0.30 +
    stabilityPct * 0.20 +
    (100 - silencePct) * 0.20 +
    clamp(vowelHoldMs / 40, 0, 100) * 0.20 +
    (100 - noisePct) * 0.10;

  /* ============================================================
     EXPLICABILITY
  ============================================================ */

  const explicability = {
    silence_high: silencePct > 45,
    continuity_low: continuityPct < 40,
    oscillation_high: oscillationPct > 55,
    sustained_vowels: vowelHoldMs > 1200,
    strong_attacks: attackIntensity > 45,
    spectral_noise: noisePct > 60,
    stable_presence: stabilityPct > 70
  };

  return {
    timeline,

    metrics: {
      duration_sec:
        audioBuffer.length / sampleRate,

      silence_pct: silencePct,

      continuity_pct: continuityPct,

      oscillation_pct: oscillationPct,

      energy_pct:
        clamp(energyMean * 300, 0, 100),

      stability_pct: stabilityPct,

      noise_pct: noisePct,

      vowel_hold_ms: vowelHoldMs,

      attack_intensity: attackIntensity,

      intentional_presence:
        intentionalPresence,

      energy_trend: energyTrend
    },

    explicability
  };
}

/* ============================================================
   SIGNAL DETECTION
============================================================ */

function detectSignalPresence(
  durationSec,
  silencePct
) {
  if (durationSec <= 0) {
    return "SEM_SINAL";
  }

  if (
    silencePct >= 96 &&
    durationSec < 12
  ) {
    return "SEM_DADO";
  }

  return "VALIDO";
}

function detectReflectionPattern(
  continuityPct,
  energyPct,
  oscillationPct,
  silencePct,
  vowelHoldMs
) {
  const score =
    continuityPct * 0.35 +
    energyPct * 0.15 +
    (100 - silencePct) * 0.15 +
    (100 - oscillationPct) * 0.15 +
    clamp(vowelHoldMs / 25, 0, 100) * 0.20;

  return [
    score >= 52,
    Number(score.toFixed(2))
  ];
}

function detectFragmentation(
  continuityPct,
  oscillationPct,
  silencePct
) {
  const score =
    (100 - continuityPct) * 0.4 +
    oscillationPct * 0.35 +
    silencePct * 0.25;

  return [
    score >= 58,
    Number(score.toFixed(2))
  ];
}

function detectLowEnergy(
  energyPct,
  continuityPct
) {
  return (
    energyPct < 20 &&
    continuityPct > 35
  );
}

/* ============================================================
   CLASSIFIER
============================================================ */

function classifyState(metrics) {
  const signal = detectSignalPresence(
    metrics.duration_sec,
    metrics.silence_pct
  );

  if (signal === "SEM_SINAL") {
    return {
      state: "Sem sinal",
      mode: "invalido",
      confidence: 0
    };
  }

  if (signal === "SEM_DADO") {
    return {
      state: "Sem dado suficiente",
      mode: "ausencia",
      confidence: 0.95
    };
  }

  const [reflective, reflectiveScore] =
    detectReflectionPattern(
      metrics.continuity_pct,
      metrics.energy_pct,
      metrics.oscillation_pct,
      metrics.silence_pct,
      metrics.vowel_hold_ms
    );

  if (reflective) {
    return {
      state: "Ritmo reflexivo",
      mode: "reflexao",
      confidence:
        reflectiveScore / 100
    };
  }

  if (
    detectLowEnergy(
      metrics.energy_pct,
      metrics.continuity_pct
    )
  ) {
    return {
      state: "Fluxo de baixa emissão",
      mode: "baixa_energia",
      confidence: 0.72
    };
  }

  const [frag, fragScore] =
    detectFragmentation(
      metrics.continuity_pct,
      metrics.oscillation_pct,
      metrics.silence_pct
    );

  if (frag) {
    return {
      state: "Fluxo fragmentado",
      mode: "fragmentacao",
      confidence: fragScore / 100
    };
  }

  if (
    metrics.stability_pct > 70 &&
    metrics.continuity_pct > 50
  ) {
    return {
      state: "Fluxo contínuo",
      mode: "estavel",
      confidence: 0.88
    };
  }

  return {
    state: "Fluxo moderado",
    mode: "moderado",
    confidence: 0.6
  };
}

/* ============================================================
   GUIDANCE
============================================================ */

function buildInteractionGuidance(mode) {
  const guides = {
    reflexao:
      "Permitir pausas naturais e continuidade de elaboração.",

    fragmentacao:
      "Reduzir densidade cognitiva e operar progressivamente.",

    baixa_energia:
      "Manter suavidade relacional sem inferência emocional.",

    estavel:
      "Fluxo estável com possibilidade de maior densidade.",

    moderado:
      "Operar com clareza e alinhamento gradual.",

    ausencia:
      "Sem emissão suficiente para inferência contextual.",

    invalido:
      "Captação insuficiente."
  };

  return (
    guides[mode] ||
    "Operar com prudência contextual."
  );
}

/* ============================================================
   HEALTH
============================================================ */

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    service: "ELAYON_CRS",
    version: "v5_temporal_signal_engine"
  });
});

/* ============================================================
   MAIN ANALYSIS
============================================================ */

app.post(
  "/api/crs/analisar",
  upload.single("audio"),
  async (req, res) => {
    try {
      const token =
        getBearerToken(req);

      if (!token) {
        return res.status(401).json({
          ok: false,
          error: "token ausente"
        });
      }

      const [valid, reason, user] =
        await validateSupabaseUser(token);

      if (!valid) {
        return res.status(401).json({
          ok: false,
          error: reason
        });
      }

      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "audio ausente"
        });
      }

      const buffer =
        fs.readFileSync(req.file.path);

      const decoded =
        wav.decode(buffer);

      const sampleRate =
        decoded.sampleRate;

      const audioBuffer =
        decoded.channelData[0];

      const extracted =
        extractFeatures(
          audioBuffer,
          sampleRate
        );

      const history =
        getUserMemory(user.id);

      const baseline =
        buildBaseline(history);

      const result =
        classifyState(
          extracted.metrics
        );

      storeMemory(user.id, {
        ...extracted.metrics
      });

      fs.unlinkSync(req.file.path);

      return res.json({
        ok: true,

        auth: {
          user_id: user.id,
          email: user.email
        },

        estado_detectado: {
          nome: result.state,
          modo: result.mode,
          confianca:
            Number(
              result.confidence.toFixed(2)
            )
        },

        baseline_memoria: baseline,

        relatorio:
          extracted.metrics,

        explicabilidade:
          extracted.explicability,

        sugestao_interacao:
          buildInteractionGuidance(
            result.mode
          ),

        timeline:
          extracted.timeline
      });
    } catch (err) {
      console.error(err);

      return res.status(500).json({
        ok: false,
        error: err.message
      });
    }
  }
);

/* ============================================================
   START
============================================================ */

const PORT =
  process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(
    `ELAYON CRS v5 running on ${PORT}`
  );
});