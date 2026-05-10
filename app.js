/**
 * ELAYON · CRS SIGNAL ENGINE
 * app.js
 *
 * Extração contextual de presença vocal
 * ------------------------------------------------------------
 * OBJETIVO:
 * Gerar JSON rico de dinâmica vocal/prosódica
 * para IA contextual replicar:
 *
 * - ritmo
 * - intenção
 * - continuidade
 * - sustentação
 * - tensão
 * - presença
 * - comportamento temporal da fala
 *
 * NÃO:
 * - detector emocional
 * - detector de mentira
 * - diagnóstico psicológico
 *
 * ------------------------------------------------------------
 * REQUISITOS:
 *
 * npm install express multer meyda fft-js node-wav
 *
 * EXEC:
 * node app.js
 *
 * POST:
 * /analyze
 *
 * multipart/form-data
 * field: audio
 *
 * FORMATOS:
 * wav PCM recomendado
 */

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const wav = require("node-wav");
const Meyda = require("meyda");

const app = express();
const upload = multer({ dest: "tmp/" });

/* ============================================================
   HELPERS
============================================================ */

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr) {
  if (arr.length < 2) return 0;

  const mean = avg(arr);

  const variance =
    arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    arr.length;

  return Math.sqrt(variance);
}

function clamp(v, low, high) {
  return Math.max(low, Math.min(high, v));
}

function rms(buffer) {
  let sum = 0;

  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }

  return Math.sqrt(sum / buffer.length);
}

function spectralFlatness(amplitudeSpectrum) {
  let geo = 1;
  let arith = 0;

  for (let i = 0; i < amplitudeSpectrum.length; i++) {
    const val = amplitudeSpectrum[i] + 1e-12;

    geo *= val;
    arith += val;
  }

  geo = Math.pow(geo, 1 / amplitudeSpectrum.length);
  arith /= amplitudeSpectrum.length;

  return geo / arith;
}

/* ============================================================
   CONFIG
============================================================ */

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;

const SILENCE_THRESHOLD = 0.015;

/* ============================================================
   CORE ANALYSIS
============================================================ */

function analyzeAudio(audioBuffer, sampleRate) {
  const frames = [];

  const timeline = [];

  const energies = [];
  const zcrs = [];
  const spectralCentroids = [];
  const spectralFlatnesses = [];
  const pitches = [];

  let silenceFrames = 0;

  for (
    let i = 0;
    i < audioBuffer.length - FRAME_SIZE;
    i += HOP_SIZE
  ) {
    const frame = audioBuffer.slice(i, i + FRAME_SIZE);

    const features = Meyda.extract(
      [
        "rms",
        "zcr",
        "spectralCentroid",
        "spectralFlatness",
        "mfcc",
        "amplitudeSpectrum"
      ],
      frame,
      {
        sampleRate,
        bufferSize: FRAME_SIZE
      }
    );

    if (!features) continue;

    const time = i / sampleRate;

    const energy = features.rms || 0;

    const centroid = features.spectralCentroid || 0;

    const flatness =
      features.spectralFlatness ||
      spectralFlatness(features.amplitudeSpectrum);

    const zcr = features.zcr || 0;

    const isSilence = energy < SILENCE_THRESHOLD;

    if (isSilence) {
      silenceFrames++;
    }

    energies.push(energy);
    zcrs.push(zcr);
    spectralCentroids.push(centroid);
    spectralFlatnesses.push(flatness);

    timeline.push({
      t: Number(time.toFixed(3)),

      energy: Number(energy.toFixed(6)),

      silence: isSilence,

      spectral_centroid: Number(centroid.toFixed(2)),

      spectral_flatness: Number(flatness.toFixed(6)),

      zcr: Number(zcr.toFixed(6))
    });

    frames.push(frame);
  }

  /* ============================================================
     TEMPORAL DYNAMICS
  ============================================================ */

  const energyMean = avg(energies);

  const energyStd = std(energies);

  const continuity =
    100 -
    clamp(
      (energyStd / (energyMean + 1e-6)) * 100,
      0,
      100
    );

  const silencePct =
    (silenceFrames / timeline.length) * 100;

  const oscillation =
    clamp(
      std(
        energies.map((e, i) => {
          if (i === 0) return 0;
          return Math.abs(e - energies[i - 1]);
        })
      ) * 1000,
      0,
      100
    );

  const stability =
    100 -
    clamp(
      std(spectralCentroids) / 50,
      0,
      100
    );

  const noise =
    clamp(
      avg(spectralFlatnesses) * 100,
      0,
      100
    );

  /* ============================================================
     VOWEL HOLD DETECTION
  ============================================================ */

  let vowelHoldMs = 0;

  let sustainCounter = 0;

  for (let i = 0; i < energies.length; i++) {
    const stable =
      Math.abs(
        spectralCentroids[i] -
          (spectralCentroids[i - 1] || spectralCentroids[i])
      ) < 120;

    const voiced =
      energies[i] > SILENCE_THRESHOLD;

    if (stable && voiced) {
      sustainCounter++;
    } else {
      vowelHoldMs +=
        (sustainCounter * HOP_SIZE * 1000) /
        sampleRate;

      sustainCounter = 0;
    }
  }

  /* ============================================================
     ATTACK PROFILE
  ============================================================ */

  let attacks = [];

  for (let i = 1; i < energies.length; i++) {
    const delta = energies[i] - energies[i - 1];

    if (delta > 0.03) {
      attacks.push(delta);
    }
  }

  const attackIntensity =
    clamp(avg(attacks) * 1000, 0, 100);

  /* ============================================================
     INTENTIONAL PRESENCE
  ============================================================ */

  const intentionalPresence =
    (
      continuity * 0.35 +
      (100 - silencePct) * 0.20 +
      stability * 0.20 +
      (100 - noise) * 0.15 +
      clamp(vowelHoldMs / 40, 0, 100) * 0.10
    );

  /* ============================================================
     INTERPRETIVE OBSERVATIONS
  ============================================================ */

  const observations = [];

  if (silencePct > 45) {
    observations.push(
      "silêncio elevado com possível processamento interno"
    );
  }

  if (continuity > 70) {
    observations.push(
      "continuidade vocal sustentada"
    );
  }

  if (oscillation > 55) {
    observations.push(
      "alta oscilação temporal de emissão"
    );
  }

  if (vowelHoldMs > 1200) {
    observations.push(
      "sustentação vocálica prolongada"
    );
  }

  if (attackIntensity > 40) {
    observations.push(
      "ataques vocais intensos"
    );
  }

  if (noise > 60) {
    observations.push(
      "presença de tensão/noise espectral"
    );
  }

  /* ============================================================
     FINAL JSON
  ============================================================ */

  return {
    meta: {
      sample_rate: sampleRate,
      duration_sec: Number(
        (audioBuffer.length / sampleRate).toFixed(2)
      ),
      frame_size: FRAME_SIZE,
      hop_size: HOP_SIZE
    },

    dynamics: {
      energy_mean: Number(energyMean.toFixed(6)),
      energy_std: Number(energyStd.toFixed(6)),

      continuity_pct: Number(
        continuity.toFixed(2)
      ),

      silence_pct: Number(
        silencePct.toFixed(2)
      ),

      oscillation_pct: Number(
        oscillation.toFixed(2)
      ),

      stability_pct: Number(
        stability.toFixed(2)
      ),

      noise_pct: Number(
        noise.toFixed(2)
      )
    },

    prosody: {
      vowel_hold_ms: Number(
        vowelHoldMs.toFixed(2)
      ),

      attack_intensity: Number(
        attackIntensity.toFixed(2)
      ),

      intentional_presence: Number(
        intentionalPresence.toFixed(2)
      )
    },

    interpretive_observations: observations,

    timeline
  };
}

/* ============================================================
   ROUTES
============================================================ */

app.post(
  "/analyze",
  upload.single("audio"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          ok: false,
          error: "audio ausente"
        });
      }

      const buffer = fs.readFileSync(req.file.path);

      const decoded = wav.decode(buffer);

      const sampleRate = decoded.sampleRate;

      const channelData = decoded.channelData[0];

      const result = analyzeAudio(
        channelData,
        sampleRate
      );

      fs.unlinkSync(req.file.path);

      return res.json({
        ok: true,
        analysis: result
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
   HEALTH
============================================================ */

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    service: "ELAYON_SIGNAL_ENGINE",
    mode: "prosodic_contextual_analysis"
  });
});

/* ============================================================
   START
============================================================ */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `ELAYON SIGNAL ENGINE running at ${PORT}`
  );
});