"""
ELAYON PSI-Q · CRS Pediátrico v1
═══════════════════════════════════════════════════════════════════════

Núcleo de Classificação Rítmica de Sinal — perfil pediátrico.

Diferenças críticas em relação ao perfil adulto:
  · Alta oscilação pode ser entusiasmo, não instabilidade
  · Silêncio longo pode ser escuta ativa ou timidez, não bloqueio
  · Baixa energia é padrão de voz infantil, não estado negativo
  · Muitas pausas curtas são ritmo natural de fala infantil

Métricas novas neste perfil:
  · tom_medio_pct       — presença de frequências médias (voz falada principal)
  · pico_agudo_pct      — momentos de voz aguda (surpresa, excitação, medo)
  · timbre_idx          — relação graves/agudos (calma ↔ tensão)
  · ritmo_silencio      — padrão de alternância voz/silêncio (regular ↔ errático)
  · acelerador_intencao — índice de convicção contínua (fala densa e estável)
  · hesitacao_inter     — pausas entre palavras (< 300ms) vs pausas longas (> 500ms)

Cruzamento estado anímico × vontade expressa:
  · Estado anímico  → leitura das métricas acústicas (como foi dito)
  · Vontade expressa → leitura do ritmo e continuidade (com que intenção)
  · Cruzamento      → tensor de presença que informa o psicólogo

═══════════════════════════════════════════════════════════════════════
"""

from __future__ import annotations
import math


# ── Helpers ───────────────────────────────────────────────────────────────────

def clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))

def safe(v, default: float = 0.0) -> float:
    try:    return float(v)
    except: return default

def safe_int(v, default: int = 0) -> int:
    try:    return int(v)
    except: return default


# ── Métricas derivadas ────────────────────────────────────────────────────────

def calcular_timbre_idx(graves: float, agudos: float) -> float:
    """
    Relação entre graves e agudos.
    · > 1.0  → voz grave, calma, contida
    · ~ 1.0  → equilíbrio
    · < 1.0  → voz aguda, tensa ou excitada
    Normalizado em 0-100 onde 50 = equilíbrio.
    """
    total = graves + agudos
    if total == 0:
        return 50.0
    return clamp((graves / total) * 100)


def calcular_ritmo_silencio(
    pause_count: int,
    mean_pause_ms: float,
    duration_sec: float
) -> dict:
    """
    Analisa o padrão de alternância voz/silêncio.

    Retorna:
      regularidade    → 0-100 (100 = pausas muito regulares)
      densidade_pausa → pausas por segundo
      pausa_media_ms  → duração média das pausas
      classificacao   → 'regular' | 'irregular' | 'denso' | 'esparso'
    """
    if duration_sec <= 0 or pause_count == 0:
        return {
            "regularidade": 0.0,
            "densidade_pausa": 0.0,
            "pausa_media_ms": 0.0,
            "classificacao": "esparso"
        }

    densidade = pause_count / duration_sec

    # Regularidade: pausas regulares têm média próxima de um padrão esperado
    # Para crianças, pausa natural entre palavras: 150-400ms
    pausa_ideal_ms = 250.0
    desvio = abs(mean_pause_ms - pausa_ideal_ms) / pausa_ideal_ms
    regularidade = clamp(100 - desvio * 60)

    if densidade > 1.5:
        classificacao = "denso"
    elif densidade < 0.3:
        classificacao = "esparso"
    elif regularidade > 65:
        classificacao = "regular"
    else:
        classificacao = "irregular"

    return {
        "regularidade": round(regularidade, 2),
        "densidade_pausa": round(densidade, 4),
        "pausa_media_ms": round(mean_pause_ms, 2),
        "classificacao": classificacao
    }


def calcular_acelerador_intencao(
    continuity_pct: float,
    energy_pct: float,
    silence_pct: float,
    oscillation_pct: float
) -> float:
    """
    Índice de convicção contínua — fala densa, estável e intencionada.

    Alto (> 65) → fala convicta, contínua, com propósito claro
    Médio (35-65) → fala em construção, intencional mas hesitante
    Baixo (< 35) → fala fragmentada ou sem direção clara

    Para crianças: peso maior em continuidade e menor em energia
    (voz infantil naturalmente tem menos energia que adulto)
    """
    score = (
        continuity_pct  * 0.40 +   # peso maior: continuidade é o sinal mais claro
        energy_pct      * 0.20 +   # peso menor: voz infantil tem energia baixa
        (100 - silence_pct) * 0.25 + # presença de voz
        (100 - oscillation_pct) * 0.15  # estabilidade
    )
    return clamp(round(score, 2))


def calcular_hesitacao_inter(
    mean_pause_ms: float,
    pause_count: int,
    duration_sec: float
) -> dict:
    """
    Distingue dois tipos de pausa:
      · Inter-palavra (< 300ms): ritmo natural, não é hesitação
      · Longa (> 500ms): processamento, hesitação real ou emoção

    Retorna classificação e proporção estimada.
    """
    if pause_count == 0:
        return {
            "tipo_predominante": "sem_pausa",
            "pausa_media_ms": 0.0,
            "estimativa": "fluxo contínuo sem pausas detectáveis"
        }

    if mean_pause_ms < 300:
        tipo = "inter_palavra"
        estimativa = "pausas naturais de ritmo — não indicam hesitação"
    elif mean_pause_ms < 500:
        tipo = "transicao"
        estimativa = "pausas de transição — processamento leve entre ideias"
    else:
        tipo = "hesitacao_real"
        estimativa = "pausas longas — possível hesitação, emoção ou processamento intenso"

    return {
        "tipo_predominante": tipo,
        "pausa_media_ms": round(mean_pause_ms, 2),
        "estimativa": estimativa
    }


# ── Classificação pediátrica ──────────────────────────────────────────────────

def classify_pediatric(
    duration_sec: float,
    silence_pct: float,
    pause_count: int,
    mean_pause_ms: float,
    oscillation_pct: float,
    stability_pct: float,
    noise_pct: float,
    density: float,
    energy_pct: float,
    continuity_pct: float,
    tom_medio_pct: float,
    pico_agudo_pct: float,
    timbre_idx: float,
    acelerador_intencao: float,
    ritmo_silencio: dict
) -> str:
    """
    Classificação de estado para perfil pediátrico.

    Estados possíveis:
      Sem Sinal
      Sem Fala Detectada
      Ambiente Interferente
      Entusiasmo / Excitação        ← novo (alta oscilação + agudos altos)
      Escuta Ativa / Contemplação   ← novo (silêncio organizado + regularidade)
      Fala Convicta                 ← novo (acelerador alto + continuidade)
      Fala em Construção            ← novo (pausas inter-palavra + ritmo regular)
      Timidez / Retraimento         ← novo (energia baixa + silêncio + graves)
      Tensão / Desconforto          ← novo (agudos altos + oscillação + timbre baixo)
      Fluxo Natural                 ← padrão saudável
      Fragmentação                  ← hesitação real em criança
    """

    # Sem dado
    if duration_sec <= 0:
        return "Sem Sinal"

    # Ausência de fala
    if silence_pct > 90 and duration_sec < 12:
        return "Sem Fala Detectada"

    # Ambiente
    if noise_pct > 55:
        return "Ambiente Interferente"

    # Entusiasmo / Excitação
    # Oscilação alta + agudos elevados + acelerador alto
    # Em adulto seria instabilidade — em criança é presença emocional positiva
    if (oscillation_pct > 40
            and pico_agudo_pct > 50
            and acelerador_intencao > 45):
        return "Entusiasmo / Excitação"

    # Tensão / Desconforto
    # Agudos altos + timbre_idx baixo (voz aguda dominante) + oscilação presente
    if (pico_agudo_pct > 55
            and timbre_idx < 35
            and oscillation_pct > 30):
        return "Tensão / Desconforto"

    # Escuta Ativa / Contemplação
    # Silêncio alto mas organizado — criança escutando, não bloqueada
    if (silence_pct > 50
            and ritmo_silencio["regularidade"] > 60
            and energy_pct > 5):
        return "Escuta Ativa / Contemplação"

    # Fala Convicta
    # Acelerador alto + continuidade + médios presentes (voz falada clara)
    if (acelerador_intencao > 65
            and continuity_pct > 55
            and tom_medio_pct > 45):
        return "Fala Convicta"

    # Fala em Construção
    # Pausas naturais inter-palavra + ritmo regular — criança organizando pensamento
    if (ritmo_silencio["classificacao"] in ["regular", "irregular"]
            and ritmo_silencio["densidade_pausa"] > 0.5
            and mean_pause_ms < 400):
        return "Fala em Construção"

    # Timidez / Retraimento
    # Energia baixa + silêncio + timbre grave (voz contida)
    if (energy_pct < 15
            and silence_pct > 40
            and timbre_idx > 60):
        return "Timidez / Retraimento"

    # Fragmentação real
    if density > 0.8 and silence_pct > 40 and mean_pause_ms > 500:
        return "Fragmentação"

    # Fluxo Natural
    if stability_pct >= 55 and silence_pct < 40 and acelerador_intencao > 40:
        return "Fluxo Natural"

    return "Fluxo Variável"


# ── Tensor de presença — cruzamento anímico × vontade ────────────────────────

def tensor_presenca(
    estado: str,
    acelerador_intencao: float,
    ritmo_silencio: dict,
    hesitacao_inter: dict,
    tom_medio_pct: float,
    pico_agudo_pct: float,
    timbre_idx: float
) -> dict:
    """
    Cruza o estado anímico com a vontade expressa.
    Informa o psicólogo sobre a coerência entre o que foi dito
    e como foi dito.

    Retorna:
      coerencia       → 'alta' | 'media' | 'baixa' | 'invertida'
      leitura         → texto interpretativo para o psicólogo
      sinal_primario  → métrica mais relevante desta sessão
    """

    # Estados de alta energia expressiva
    estados_expressivos = {
        "Entusiasmo / Excitação",
        "Fala Convicta",
        "Fluxo Natural"
    }

    # Estados de baixa expressão
    estados_contidos = {
        "Timidez / Retraimento",
        "Escuta Ativa / Contemplação",
        "Sem Fala Detectada"
    }

    # Estados de tensão
    estados_tensao = {
        "Tensão / Desconforto",
        "Fragmentação"
    }

    # Coerência entre estado e intenção
    if estado in estados_expressivos and acelerador_intencao > 55:
        coerencia = "alta"
        leitura = (
            "A criança expressou com consistência. "
            "O padrão de fala alinha-se com a intenção observada. "
            "Alta continuidade e energia vocal confirmam presença ativa."
        )
    elif estado in estados_contidos and acelerador_intencao < 40:
        coerencia = "alta"
        leitura = (
            "A criança manteve-se em modo de escuta ou retraimento consistente. "
            "Sem sinais contraditórios entre estado e ritmo. "
            "Observar se o silêncio é confortável ou evitativo."
        )
    elif estado in estados_tensao:
        coerencia = "media"
        leitura = (
            "Sinais de tensão detectados no padrão vocal. "
            "Agudos elevados e oscilação indicam estado de alerta ou desconforto. "
            "Recomenda-se abordagem mais acolhedora antes de aprofundar."
        )
    elif estado in estados_expressivos and acelerador_intencao < 40:
        coerencia = "invertida"
        leitura = (
            "Estado vocal expressivo mas intenção fragmentada. "
            "A criança pode estar animada superficialmente mas sem direção clara. "
            "Ou há variação emocional rápida — observar sequência temporal."
        )
    else:
        coerencia = "media"
        leitura = (
            "Padrão misto — momentos de expressão e retraimento alternados. "
            "Ritmo de fala em construção. "
            "Acompanhar evolução ao longo da sessão."
        )

    # Sinal primário — qual métrica merece mais atenção
    if pico_agudo_pct > 60:
        sinal = "pico_agudo_pct — momentos de voz muito aguda merecem atenção"
    elif timbre_idx < 30:
        sinal = "timbre_idx — voz predominantemente aguda, possível tensão"
    elif ritmo_silencio["regularidade"] < 40:
        sinal = "ritmo_silencio — padrão de pausas irregular, ritmo em construção"
    elif acelerador_intencao > 70:
        sinal = "acelerador_intencao — fala convicta e contínua, presença clara"
    elif acelerador_intencao < 30:
        sinal = "acelerador_intencao — baixa convicção, fala fragmentada"
    else:
        sinal = "continuidade — padrão equilibrado, sem sinal dominante"

    return {
        "coerencia": coerencia,
        "leitura": leitura,
        "sinal_primario": sinal
    }


# ── Sugestões ao psicólogo ───────────────────────────────────────────────────

SUGESTOES_PSY = {
    "Sem Sinal": {
        "orientacao_psy": "Verificar condições de captação antes de prosseguir.",
        "destaque": "Sem dados suficientes nesta sessão."
    },
    "Sem Fala Detectada": {
        "orientacao_psy": "Nenhuma voz capturada. Verificar posicionamento do microfone.",
        "destaque": "Gravação sem fala detectada."
    },
    "Ambiente Interferente": {
        "orientacao_psy": "Ruído ambiental elevado compromete a leitura. Repetir em local mais silencioso.",
        "destaque": "Interferência ambiental relevante."
    },
    "Entusiasmo / Excitação": {
        "orientacao_psy": (
            "A criança demonstrou alta energia expressiva. "
            "Oscilação vocal e agudos altos são compatíveis com entusiasmo ou excitação emocional. "
            "Observar se o conteúdo verbal alinha-se com esse estado."
        ),
        "destaque": "Alta excitação vocal — voz aguda e ativa."
    },
    "Tensão / Desconforto": {
        "orientacao_psy": (
            "Padrão vocal de alerta detectado — agudos elevados e oscilação presente. "
            "Pode indicar desconforto, medo ou resposta a estímulo estressante. "
            "Abordagem acolhedora antes de qualquer aprofundamento."
        ),
        "destaque": "Sinais de tensão vocal — atenção ao estado emocional."
    },
    "Escuta Ativa / Contemplação": {
        "orientacao_psy": (
            "Silêncio organizado e regular. "
            "A criança pode estar em modo de escuta ativa ou contemplação — "
            "não necessariamente retraimento. "
            "Verificar postura corporal e contato visual como complemento."
        ),
        "destaque": "Silêncio regular — escuta ativa provável."
    },
    "Fala Convicta": {
        "orientacao_psy": (
            "Fala contínua, estável e intencionada. "
            "Alto índice de convicção — a criança expressou com clareza e propósito. "
            "Momento favorável para aprofundamento temático."
        ),
        "destaque": "Fala convicta e contínua — presença expressiva alta."
    },
    "Fala em Construção": {
        "orientacao_psy": (
            "Pausas naturais entre palavras — ritmo de organização do pensamento. "
            "A criança está construindo a fala, não hesitando. "
            "Dar tempo e espaço sem interrupção."
        ),
        "destaque": "Fala em organização — respeitar o ritmo."
    },
    "Timidez / Retraimento": {
        "orientacao_psy": (
            "Energia vocal baixa, voz contida, silêncio predominante. "
            "Padrão compatível com timidez ou retraimento em ambiente não familiar. "
            "Abordagem lúdica e gradual recomendada."
        ),
        "destaque": "Voz contida — possível timidez ou retraimento."
    },
    "Fragmentação": {
        "orientacao_psy": (
            "Pausas longas e densidade elevada indicam dificuldade de fluência. "
            "Pode ser emoção intensa, dificuldade de processamento ou tensão. "
            "Não pressionar continuidade — acolher o silêncio como dado."
        ),
        "destaque": "Fragmentação de fluxo — observar com cuidado."
    },
    "Fluxo Natural": {
        "orientacao_psy": (
            "Padrão vocal equilibrado e estável. "
            "A criança está em fluxo natural — boa janela para exploração temática. "
            "Manter ritmo da sessão sem aceleração."
        ),
        "destaque": "Fluxo natural e estável."
    },
    "Fluxo Variável": {
        "orientacao_psy": (
            "Alternância entre momentos expressivos e contidos. "
            "Acompanhar evolução ao longo da sessão. "
            "Ritmo variável é comum em crianças — não é sinal de alerta por si só."
        ),
        "destaque": "Fluxo variável — padrão misto normal."
    }
}


# ── Função principal de análise ───────────────────────────────────────────────

def analisar_pediatrico(payload: dict) -> dict:
    """
    Recebe o payload do frontend e retorna análise pediátrica completa.

    Campos esperados no payload:
      duration_sec, silence_pct, pause_count, mean_pause_ms,
      oscillation_pct, continuity_pct, energy_pct,
      spectrum_snapshot: { graves, medios, agudos, ruido, estabilidade }
      context (opcional)
    """

    dur    = safe(payload.get("duration_sec",   0))
    sil    = clamp(safe(payload.get("silence_pct",    0)))
    pc     = safe_int(payload.get("pause_count",    0))
    mp     = safe(payload.get("mean_pause_ms",  0))
    osc    = clamp(safe(payload.get("oscillation_pct", 0)))
    cont   = clamp(safe(payload.get("continuity_pct",  0)))
    eng    = clamp(safe(payload.get("energy_pct",      0)))
    ctx    = str(payload.get("context", "") or "")

    snap   = payload.get("spectrum_snapshot") or {}
    graves = clamp(safe(snap.get("graves",       0)))
    medios = clamp(safe(snap.get("medios",       0)))
    agudos = clamp(safe(snap.get("agudos",       0)))
    noise  = clamp(safe(snap.get("ruido",        0)))
    stab   = clamp(safe(snap.get("estabilidade", 0)))

    density = round(pc / dur, 4) if dur > 0 else 0.0

    # Métricas derivadas
    timbre_idx          = calcular_timbre_idx(graves, agudos)
    ritmo_silencio      = calcular_ritmo_silencio(pc, mp, dur)
    acelerador_intencao = calcular_acelerador_intencao(cont, eng, sil, osc)
    hesitacao_inter     = calcular_hesitacao_inter(mp, pc, dur)

    # Classificação pediátrica
    estado = classify_pediatric(
        duration_sec        = dur,
        silence_pct         = sil,
        pause_count         = pc,
        mean_pause_ms       = mp,
        oscillation_pct     = osc,
        stability_pct       = stab,
        noise_pct           = noise,
        density             = density,
        energy_pct          = eng,
        continuity_pct      = cont,
        tom_medio_pct       = medios,
        pico_agudo_pct      = agudos,
        timbre_idx          = timbre_idx,
        acelerador_intencao = acelerador_intencao,
        ritmo_silencio      = ritmo_silencio
    )

    # Tensor anímico × vontade
    tensor = tensor_presenca(
        estado              = estado,
        acelerador_intencao = acelerador_intencao,
        ritmo_silencio      = ritmo_silencio,
        hesitacao_inter     = hesitacao_inter,
        tom_medio_pct       = medios,
        pico_agudo_pct      = agudos,
        timbre_idx          = timbre_idx
    )

    sugestao = SUGESTOES_PSY.get(estado, {
        "orientacao_psy": "Observar com atenção progressiva.",
        "destaque": "—"
    })

    return {
        "ok": True,
        "perfil": "pediatrico_v1",
        "context": ctx,

        # Classificação
        "estado": estado,

        # Para o psicólogo
        "orientacao_psy": sugestao["orientacao_psy"],
        "destaque":       sugestao["destaque"],

        # Tensor anímico × vontade
        "tensor": tensor,

        # Métricas brutas
        "relatorio": {
            "tempo_total":          round(dur,  2),
            "porcentagem_silencio": round(sil,  2),
            "total_pausas":         pc,
            "media_pausa_ms":       round(mp,   2),
            "densidade":            density,
            "continuidade_pct":     round(cont, 2),
            "energia_pct":          round(eng,  2),
            "oscilacao_pct":        round(osc,  2),
            "snapshot_sonoro": {
                "graves":       round(graves, 2),
                "medios":       round(medios, 2),
                "agudos":       round(agudos, 2),
                "ruido":        round(noise,  2),
                "estabilidade": round(stab,   2)
            }
        },

        # Métricas derivadas novas
        "metricas_pediatricas": {
            "timbre_idx":          round(timbre_idx,          2),
            "acelerador_intencao": round(acelerador_intencao, 2),
            "ritmo_silencio":      ritmo_silencio,
            "hesitacao_inter":     hesitacao_inter
        }
    }


# ── Teste local ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import json

    # Casos de teste representando estados pediátricos distintos

    casos = [
        {
            "nome": "Criança entusiasmada contando história",
            "payload": {
                "duration_sec": 25, "silence_pct": 22, "pause_count": 12,
                "mean_pause_ms": 180, "oscillation_pct": 55, "continuity_pct": 68,
                "energy_pct": 42, "context": "coleta_teste_entusiasmo",
                "spectrum_snapshot": {
                    "graves": 18, "medios": 52, "agudos": 72,
                    "ruido": 8, "estabilidade": 61
                }
            }
        },
        {
            "nome": "Criança tímida em primeiro contato",
            "payload": {
                "duration_sec": 18, "silence_pct": 62, "pause_count": 6,
                "mean_pause_ms": 620, "oscillation_pct": 18, "continuity_pct": 22,
                "energy_pct": 9, "context": "coleta_teste_timidez",
                "spectrum_snapshot": {
                    "graves": 48, "medios": 35, "agudos": 18,
                    "ruido": 5, "estabilidade": 74
                }
            }
        },
        {
            "nome": "Criança em tensão ou desconforto",
            "payload": {
                "duration_sec": 14, "silence_pct": 35, "pause_count": 9,
                "mean_pause_ms": 290, "oscillation_pct": 48, "continuity_pct": 38,
                "energy_pct": 28, "context": "coleta_teste_tensao",
                "spectrum_snapshot": {
                    "graves": 12, "medios": 40, "agudos": 78,
                    "ruido": 14, "estabilidade": 42
                }
            }
        },
        {
            "nome": "Criança em fala convicta e organizada",
            "payload": {
                "duration_sec": 32, "silence_pct": 18, "pause_count": 14,
                "mean_pause_ms": 210, "oscillation_pct": 22, "continuity_pct": 74,
                "energy_pct": 38, "context": "coleta_teste_convicto",
                "spectrum_snapshot": {
                    "graves": 28, "medios": 68, "agudos": 35,
                    "ruido": 6, "estabilidade": 79
                }
            }
        },
        {
            "nome": "Criança em escuta ativa / silêncio contemplativo",
            "payload": {
                "duration_sec": 20, "silence_pct": 72, "pause_count": 5,
                "mean_pause_ms": 380, "oscillation_pct": 14, "continuity_pct": 18,
                "energy_pct": 11, "context": "coleta_teste_escuta",
                "spectrum_snapshot": {
                    "graves": 35, "medios": 42, "agudos": 22,
                    "ruido": 4, "estabilidade": 82
                }
            }
        }
    ]

    separador = "═" * 68

    for caso in casos:
        print(f"\n{separador}")
        print(f"  CASO: {caso['nome']}")
        print(separador)
        resultado = analisar_pediatrico(caso["payload"])
        print(f"  ESTADO          : {resultado['estado']}")
        print(f"  DESTAQUE        : {resultado['destaque']}")
        print(f"  COERÊNCIA       : {resultado['tensor']['coerencia']}")
        print(f"  SINAL PRIMÁRIO  : {resultado['tensor']['sinal_primario']}")
        print(f"  LEITURA TENSOR  : {resultado['tensor']['leitura']}")
        print(f"  ORIENTAÇÃO PSY  :")
        for linha in resultado["orientacao_psy"].split(". "):
            if linha.strip():
                print(f"    · {linha.strip()}.")
        print(f"\n  MÉTRICAS PEDIÁTRICAS:")
        mp = resultado["metricas_pediatricas"]
        print(f"    timbre_idx          : {mp['timbre_idx']}")
        print(f"    acelerador_intencao : {mp['acelerador_intencao']}")
        print(f"    ritmo_silencio      : {mp['ritmo_silencio']['classificacao']} "
              f"(regularidade {mp['ritmo_silencio']['regularidade']}%)")
        print(f"    hesitacao_inter     : {mp['hesitacao_inter']['tipo_predominante']} "
              f"— {mp['hesitacao_inter']['estimativa']}")

    print(f"\n{separador}")
    print("  Todos os casos processados.")
    print(separador)
