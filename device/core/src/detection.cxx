/*
 * detection.cxx — port of packages/modules/kws/engine/core/logic.ts
 * (ScoreSmoother / TriggerDetector / shouldGateByVad), ADR-018.
 */
#include "wake/detection.h"

#include <stdlib.h>
#include <new>

/* --- ScoreSmoother: sliding-window max-pooling ----------------------------- */

struct wake_score_smoother {
  float *buffer;
  unsigned window_size;
  unsigned index;
  int filled;
};

wake_score_smoother_t *wake_score_smoother_create(unsigned window_size) {
  if (window_size == 0) {
    return nullptr;
  }
  void *mem = malloc(sizeof(wake_score_smoother));
  if (mem == nullptr) {
    return nullptr;
  }
  wake_score_smoother *s = new (mem) wake_score_smoother;
  s->buffer = static_cast<float *>(calloc(window_size, sizeof(float)));
  if (s->buffer == nullptr) {
    free(s);
    return nullptr;
  }
  s->window_size = window_size;
  s->index = 0;
  s->filled = 0;
  return s;
}

void wake_score_smoother_destroy(wake_score_smoother_t *s) {
  if (s == nullptr) {
    return;
  }
  free(s->buffer);
  free(s);
}

float wake_score_smoother_push(wake_score_smoother_t *s, float raw_score) {
  s->buffer[s->index] = raw_score;
  s->index = (s->index + 1) % s->window_size;
  if (s->index == 0) {
    s->filled = 1;
  }
  float max = s->buffer[0];
  for (unsigned i = 1; i < s->window_size; ++i) {
    if (s->buffer[i] > max) {
      max = s->buffer[i];
    }
  }
  return max;
}

int wake_score_smoother_warmed(const wake_score_smoother_t *s) {
  return s->filled;
}

float wake_score_smoother_peek(const wake_score_smoother_t *s) {
  float max = s->buffer[0];
  for (unsigned i = 1; i < s->window_size; ++i) {
    if (s->buffer[i] > max) {
      max = s->buffer[i];
    }
  }
  return max;
}

void wake_score_smoother_reset(wake_score_smoother_t *s) {
  for (unsigned i = 0; i < s->window_size; ++i) {
    s->buffer[i] = 0.0f;
  }
  s->index = 0;
  s->filled = 0;
}

/* --- TriggerDetector: threshold + min-duration + cooldown ------------------ */

struct wake_trigger_detector {
  float threshold;
  double min_duration_ms;
  double cooldown_ms;
  double above_since_ms; /* -1 = not currently above threshold */
  double last_trigger_ms;
  const char *word;
};

static const double kNoAbove = -1.0;
static const double kNeverTriggered = -1e300;

wake_trigger_detector_t *wake_trigger_detector_create(
    const wake_kws_config_t *cfg, const char *word) {
  void *mem = malloc(sizeof(wake_trigger_detector));
  if (mem == nullptr) {
    return nullptr;
  }
  wake_trigger_detector *d = new (mem) wake_trigger_detector;
  d->threshold = cfg ? cfg->threshold : 0.5f;
  d->min_duration_ms = cfg ? (double)cfg->min_duration_ms : 300.0;
  d->cooldown_ms = cfg ? (double)cfg->cooldown_ms : 2000.0;
  d->above_since_ms = kNoAbove;
  d->last_trigger_ms = kNeverTriggered;
  d->word = word != nullptr ? word : "wake-word";
  return d;
}

void wake_trigger_detector_destroy(wake_trigger_detector_t *d) {
  if (d != nullptr) {
    free(d);
  }
}

int wake_trigger_detector_process(wake_trigger_detector_t *d,
                                  float smoothed_score, double now_ms,
                                  wake_trigger_event_t *out) {
  const int above = smoothed_score >= d->threshold;

  if (above) {
    /* Start tracking when we first cross the threshold. */
    if (d->above_since_ms == kNoAbove) {
      d->above_since_ms = now_ms;
    }

    /* Check min-duration + cooldown. */
    const double duration_met = now_ms - d->above_since_ms >= d->min_duration_ms;
    const double cooldown_elapsed =
        now_ms - d->last_trigger_ms >= d->cooldown_ms;

    if (duration_met && cooldown_elapsed) {
      d->last_trigger_ms = now_ms;
      /* Keep above_since_ms so we don't re-trigger immediately; it resets
       * when the score drops below threshold. */
      if (out != nullptr) {
        out->triggered_at_ms = now_ms;
        out->peak_score = smoothed_score;
        out->word = d->word;
      }
      return 1;
    }
  } else {
    /* Score dropped below threshold — reset the duration tracker. */
    d->above_since_ms = kNoAbove;
  }

  return 0;
}

void wake_trigger_detector_reset(wake_trigger_detector_t *d) {
  d->above_since_ms = kNoAbove;
  d->last_trigger_ms = kNeverTriggered;
}

/* --- VAD gate -------------------------------------------------------------- */

int wake_should_gate_by_vad(float vad_probability, float vad_threshold,
                            int gate_enabled) {
  if (!gate_enabled) {
    return 0;
  }
  return vad_probability < vad_threshold ? 1 : 0;
}

/* --- Onset-safe trigger gate (stateful, fail-open) ------------------------- */

static const double kGateNever = -1e300;

struct wake_vad_gate {
  int enabled;
  float vad_threshold;
  float high_confidence;
  unsigned hold_max_ms;
  unsigned close_ms;
  double last_speech_ms; /* last frame whose VAD reached the threshold */
  double hold_since_ms;  /* start of the current hold window, or < 0 */
  int open;
};

wake_vad_gate_t *wake_vad_gate_create(const wake_kws_config_t *cfg) {
  void *mem = calloc(1, sizeof(wake_vad_gate));
  if (mem == nullptr) {
    return nullptr;
  }
  wake_vad_gate *g = new (mem) wake_vad_gate;
  g->enabled = cfg ? cfg->vad_gate_enabled : 0;
  g->vad_threshold = cfg ? cfg->vad_threshold : 0.3f;
  g->high_confidence = cfg ? cfg->vad_high_confidence : 0.9f;
  g->hold_max_ms = cfg ? cfg->vad_hold_max_ms : 150u;
  g->close_ms = cfg ? cfg->vad_close_ms : 300u;
  g->last_speech_ms = kGateNever;
  g->hold_since_ms = -1.0;
  g->open = 1;
  return g;
}

void wake_vad_gate_destroy(wake_vad_gate_t *g) {
  free(g);
}

void wake_vad_gate_reset(wake_vad_gate_t *g) {
  if (g == nullptr) {
    return;
  }
  g->last_speech_ms = kGateNever;
  g->hold_since_ms = -1.0;
  g->open = 1;
}

int wake_vad_gate_enabled(const wake_vad_gate_t *g) {
  return g != nullptr ? g->enabled : 0;
}

int wake_vad_gate_is_open(const wake_vad_gate_t *g) {
  return g != nullptr ? g->open : 1;
}

int wake_vad_gate_hold_expired(const wake_vad_gate_t *g, double now_ms) {
  if (g == nullptr || g->hold_since_ms < 0.0) {
    return 1; /* nothing held -> nothing to wait for */
  }
  return now_ms - g->hold_since_ms >= (double)g->hold_max_ms;
}

wake_vad_decision_t wake_vad_gate_step(wake_vad_gate_t *g, int vad_available,
                                       float vad_probability,
                                       float smoothed_score, double now_ms) {
  if (g == nullptr) {
    return WAKE_VAD_ALLOW;
  }
  /* Fail open: a disabled gate, or a graph without any VAD-capable stage,
   * must never suppress a trigger. */
  if (!g->enabled || !vad_available) {
    g->open = 1;
    g->hold_since_ms = -1.0;
    return WAKE_VAD_ALLOW;
  }

  if (vad_probability >= g->vad_threshold) {
    /* Speech (re)started: open immediately and drop any pending hold so a
     * held trigger publishes as soon as the gate opens. */
    g->last_speech_ms = now_ms;
    g->open = 1;
    g->hold_since_ms = -1.0;
    return WAKE_VAD_ALLOW;
  }

  /* Non-speech: stay open for the close window (hysteresis) so word onsets
   * are not clipped by the gap between words. */
  g->open = (now_ms - g->last_speech_ms) < (double)g->close_ms;
  if (g->open) {
    g->hold_since_ms = -1.0;
    return WAKE_VAD_ALLOW;
  }

  /* Gate closed. A very confident score always publishes. */
  if (smoothed_score >= g->high_confidence) {
    g->hold_since_ms = -1.0;
    return WAKE_VAD_BYPASS;
  }

  /* Borderline while closed: hold, but never longer than hold_max_ms. */
  if (g->hold_max_ms == 0u) {
    g->hold_since_ms = -1.0;
    return WAKE_VAD_ALLOW; /* holding disabled -> fail open */
  }
  if (g->hold_since_ms < 0.0) {
    g->hold_since_ms = now_ms;
  }
  if (now_ms - g->hold_since_ms >= (double)g->hold_max_ms) {
    g->hold_since_ms = -1.0;
    return WAKE_VAD_ALLOW; /* bounded delay expired -> fail open */
  }
  return WAKE_VAD_HOLD;
}
