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
