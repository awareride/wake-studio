/*
 * kws_streaming_driver.c — kws-streaming device driver (issue #194).
 *
 * C KWSBackend adapter for the Traditional external-state streaming graph
 * (ADR-020/024 §2.1, vendored upstream per ADR-037): the same kwt*.onnx
 * models the browser runs via onnxruntime-web (`core/backend.ts` is the
 * reference), executed through the onnxruntime C API (shared app-class
 * runtime with openwakeword #192).
 *
 * The driver is manifest-driven: a sidecar `manifest.json` (the browser's
 * own sidecar contract, `core/manifest.ts`) describes the graph — mode,
 * tensor names, window/packet sizes, labels. One driver serves every
 * streamable topology upstream ships, in both inference shapes:
 *
 *   - `sliding-window` (kwt1/2/3, att_mh_rnn_1): the non-streaming graph
 *     runs over the most recent `windowSamples` (1 s), re-evaluated every
 *     `hopSamples` (100 ms). Windows overlap; left zero-pad until primed.
 *   - `streaming-external-state`: packet-sized steps with explicit state
 *     tensors in/out; the caller carries the state bags (advanceStates).
 *
 * Model files are read from the bundle's model_dir with the names this
 * driver declares (ADR-040 §4.1):
 *   <model_dir>/model.onnx     the exported graph (any topology)
 *   <model_dir>/manifest.json  the sidecar manifest (core/manifest.ts)
 *
 * process_frame() consumes 160-sample AFE frames (10 ms @ 16 kHz) and
 * returns the wanted word's posterior [0,1], or -1 during warmup (no hop /
 * partial packet yet). The engine owns VAD gating + smoothing; the driver
 * owns windowing, state carry, and the multi-class -> single-score mapping
 * (softmax when the graph did not, then select the wanted label).
 *
 * Runtime gating: WAKE_SDK_KWS_STREAMING_HAS_RUNTIME (CMake option, default
 * OFF). Without the runtime, load() reports "runtime not linked" and
 * process_frame() stays in warmup (-1) — the module still compiles and
 * registers, so the composition root and capabilities work end-to-end.
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wake/kws_backend.h"

#if defined(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)
#include "onnxruntime_c_api.h"
#endif

#define KWS_MAX_LABELS 32
#define KWS_MAX_STATES 8
#define KWS_MAX_NAME 160
#define KWS_MAX_DIMS 8

typedef struct kws_state {
  char input[KWS_MAX_NAME];
  char output[KWS_MAX_NAME];
  int64_t shape[KWS_MAX_DIMS];
  size_t ndims;
} kws_state_t;

typedef struct kws_streaming_impl {
  int loaded;
#if defined(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)
  const OrtApi *api;
  OrtEnv *env;
  OrtSession *session;

  char audio_input[KWS_MAX_NAME];
  char score_output[KWS_MAX_NAME];

  char mode; /* 's' = sliding-window, 'e' = streaming-external-state */

  /* sliding-window */
  float *window;          /* windowSamples floats (zero-padded until primed) */
  size_t window_samples;
  size_t hop_samples;
  size_t since_hop;       /* samples accumulated since the last evaluation */
  size_t seen;            /* total samples ever pushed */

  /* streaming-external-state */
  float *packet_buf;      /* growable packet aligner */
  size_t packet_len;
  size_t packet_cap;
  size_t packet_samples;

  /* external-state bags (one buffer per manifest state, carried across
   * steps — advanceStates parity) */
  kws_state_t states[KWS_MAX_STATES];
  size_t n_states;
  float *state_bufs[KWS_MAX_STATES];
  size_t state_elems[KWS_MAX_STATES];

  /* multi-class output -> single wanted-word score */
  char labels[KWS_MAX_LABELS][64];
  size_t n_labels;
  size_t wanted_index;
  int softmaxed;
#endif
} kws_streaming_impl_t;

/* --------------------------------------------------------------------------
 * Minimal JSON DOM (manifest.json is small; no external dependency).
 * -------------------------------------------------------------------------- */
#if defined(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)

typedef enum json_type {
  JSON_NULL,
  JSON_BOOL,
  JSON_NUMBER,
  JSON_STRING,
  JSON_ARRAY,
  JSON_OBJECT,
} json_type_t;

typedef struct json_value {
  json_type_t type;
  union {
    int boolean;
    double number;
    struct {
      char *data; /* NUL-terminated */
      size_t len;
    } string;
    struct {
      struct json_value **items;
      size_t count;
    } array;
    struct {
      char **keys;
      struct json_value **values;
      size_t count;
    } object;
  } u;
} json_value_t;

static const char *json_skip_ws(const char *p) {
  while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') ++p;
  return p;
}

/* Decode a \uXXXX escape into the output buffer as UTF-8. Returns the number
 * of bytes written. */
static size_t json_write_utf8(unsigned cp, char *out) {
  if (cp < 0x80) {
    out[0] = (char)cp;
    return 1;
  }
  if (cp < 0x800) {
    out[0] = (char)(0xC0 | (cp >> 6));
    out[1] = (char)(0x80 | (cp & 0x3F));
    return 2;
  }
  out[0] = (char)(0xE0 | (cp >> 12));
  out[1] = (char)(0x80 | ((cp >> 6) & 0x3F));
  out[2] = (char)(0x80 | (cp & 0x3F));
  return 3;
}

static int json_hex4(const char *p, unsigned *out) {
  unsigned v = 0;
  for (int i = 0; i < 4; ++i) {
    char c = p[i];
    v <<= 4;
    if (c >= '0' && c <= '9') v |= (unsigned)(c - '0');
    else if (c >= 'a' && c <= 'f') v |= (unsigned)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') v |= (unsigned)(c - 'A' + 10);
    else return 1;
  }
  *out = v;
  return 0;
}

static json_value_t *json_value_new(json_type_t type) {
  json_value_t *v = calloc(1, sizeof(json_value_t));
  if (v != NULL) v->type = type;
  return v;
}

static void json_free(json_value_t *v) {
  if (v == NULL) return;
  switch (v->type) {
    case JSON_STRING:
      free(v->u.string.data);
      break;
    case JSON_ARRAY:
      for (size_t i = 0; i < v->u.array.count; ++i) json_free(v->u.array.items[i]);
      free(v->u.array.items);
      break;
    case JSON_OBJECT:
      for (size_t i = 0; i < v->u.object.count; ++i) {
        free(v->u.object.keys[i]);
        json_free(v->u.object.values[i]);
      }
      free(v->u.object.keys);
      free(v->u.object.values);
      break;
    default:
      break;
  }
  free(v);
}

static json_value_t *json_parse_value(const char **pp);

/* "..." with escapes; *pp left after the closing quote. */
static json_value_t *json_parse_string(const char **pp) {
  const char *p = *pp;
  if (*p != '"') return NULL;
  ++p;
  size_t cap = 32, len = 0;
  char *buf = malloc(cap);
  if (buf == NULL) return NULL;
  for (;;) {
    char c = *p;
    if (c == '\0' || c == '"') break;
    if (c == '\\') {
      ++p;
      char e = *p;
      char esc = 0;
      switch (e) {
        case '"': esc = '"'; break;
        case '\\': esc = '\\'; break;
        case '/': esc = '/'; break;
        case 'b': esc = '\b'; break;
        case 'f': esc = '\f'; break;
        case 'n': esc = '\n'; break;
        case 'r': esc = '\r'; break;
        case 't': esc = '\t'; break;
        case 'u': {
          unsigned cp = 0;
          if (json_hex4(p + 1, &cp) != 0) goto fail;
          if (len + 4 >= cap) {
            cap *= 2;
            char *nb = realloc(buf, cap);
            if (nb == NULL) goto fail;
            buf = nb;
          }
          len += json_write_utf8(cp, buf + len);
          p += 5;
          continue;
        }
        default:
          goto fail;
      }
      if (len + 1 >= cap) {
        cap *= 2;
        char *nb = realloc(buf, cap);
        if (nb == NULL) goto fail;
        buf = nb;
      }
      buf[len++] = esc;
      ++p;
      continue;
    }
    if (len + 1 >= cap) {
      cap *= 2;
      char *nb = realloc(buf, cap);
      if (nb == NULL) goto fail;
      buf = nb;
    }
    buf[len++] = c;
    ++p;
  }
  if (*p != '"') goto fail;
  *pp = p + 1;
  buf[len] = '\0';
  json_value_t *v = json_value_new(JSON_STRING);
  if (v == NULL) {
    free(buf);
    return NULL;
  }
  v->u.string.data = buf;
  v->u.string.len = len;
  return v;

fail:
  free(buf);
  return NULL;
}

static json_value_t *json_parse_array(const char **pp) {
  const char *p = json_skip_ws(*pp);
  if (*p != '[') return NULL;
  ++p;
  json_value_t *v = json_value_new(JSON_ARRAY);
  if (v == NULL) return NULL;
  p = json_skip_ws(p);
  if (*p == ']') {
    *pp = p + 1;
    return v;
  }
  for (;;) {
    json_value_t *item = json_parse_value(&p);
    if (item == NULL) goto fail;
    size_t idx = v->u.array.count++;
    struct json_value **ni = realloc(v->u.array.items, v->u.array.count * sizeof(*ni));
    if (ni == NULL) {
      json_free(item);
      goto fail;
    }
    v->u.array.items = ni;
    v->u.array.items[idx] = item;
    p = json_skip_ws(p);
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p == ']') {
      *pp = p + 1;
      return v;
    }
    goto fail;
  }

fail:
  json_free(v);
  return NULL;
}

static json_value_t *json_parse_object(const char **pp) {
  const char *p = json_skip_ws(*pp);
  if (*p != '{') return NULL;
  ++p;
  json_value_t *v = json_value_new(JSON_OBJECT);
  if (v == NULL) return NULL;
  p = json_skip_ws(p);
  if (*p == '}') {
    *pp = p + 1;
    return v;
  }
  for (;;) {
    p = json_skip_ws(p);
    json_value_t *key = json_parse_string(&p);
    if (key == NULL || key->type != JSON_STRING) {
      json_free(key);
      goto fail;
    }
    p = json_skip_ws(p);
    if (*p != ':') {
      json_free(key);
      goto fail;
    }
    ++p;
    json_value_t *val = json_parse_value(&p);
    if (val == NULL) {
      json_free(key);
      goto fail;
    }
    size_t idx = v->u.object.count++;
    char **nk = realloc(v->u.object.keys, v->u.object.count * sizeof(*nk));
    if (nk == NULL) {
      json_free(key);
      json_free(val);
      goto fail;
    }
    v->u.object.keys = nk;
    struct json_value **nv = realloc(v->u.object.values, v->u.object.count * sizeof(*nv));
    if (nv == NULL) {
      json_free(key);
      json_free(val);
      goto fail;
    }
    v->u.object.values = nv;
    v->u.object.keys[idx] = key->u.string.data;
    free(key); /* keep the string, drop the node */
    v->u.object.values[idx] = val;
    p = json_skip_ws(p);
    if (*p == ',') {
      ++p;
      continue;
    }
    if (*p == '}') {
      *pp = p + 1;
      return v;
    }
    goto fail;
  }

fail:
  json_free(v);
  return NULL;
}

static json_value_t *json_parse_value(const char **pp) {
  const char *p = json_skip_ws(*pp);
  if (*p == '{') return json_parse_object(pp);
  if (*p == '[') return json_parse_array(pp);
  if (*p == '"') return json_parse_string(pp);
  if (strncmp(p, "true", 4) == 0) {
    *pp = p + 4;
    json_value_t *v = json_value_new(JSON_BOOL);
    if (v != NULL) v->u.boolean = 1;
    return v;
  }
  if (strncmp(p, "false", 5) == 0) {
    *pp = p + 5;
    json_value_t *v = json_value_new(JSON_BOOL);
    if (v != NULL) v->u.boolean = 0;
    return v;
  }
  if (strncmp(p, "null", 4) == 0) {
    *pp = p + 4;
    return json_value_new(JSON_NULL);
  }
  /* number */
  char *end = NULL;
  double d = strtod(p, &end);
  if (end == p) return NULL;
  *pp = end;
  json_value_t *v = json_value_new(JSON_NUMBER);
  if (v != NULL) v->u.number = d;
  return v;
}

static json_value_t *json_parse(const char *text) {
  const char *p = text;
  json_value_t *v = json_parse_value(&p);
  if (v == NULL) return NULL;
  p = json_skip_ws(p);
  if (*p != '\0') { /* trailing garbage */
    json_free(v);
    return NULL;
  }
  return v;
}

static json_value_t *json_object_get(const json_value_t *obj, const char *key) {
  if (obj == NULL || obj->type != JSON_OBJECT) return NULL;
  for (size_t i = 0; i < obj->u.object.count; ++i) {
    if (strcmp(obj->u.object.keys[i], key) == 0) return obj->u.object.values[i];
  }
  return NULL;
}

static const char *json_str(const json_value_t *v) {
  return (v != NULL && v->type == JSON_STRING) ? v->u.string.data : NULL;
}

static double json_num(const json_value_t *v, double dflt) {
  return (v != NULL && v->type == JSON_NUMBER) ? v->u.number : dflt;
}

static int json_bool(const json_value_t *v, int dflt) {
  return (v != NULL && v->type == JSON_BOOL) ? v->u.boolean : dflt;
}

/* --------------------------------------------------------------------------
 * Driver helpers (softmax, file I/O, graph runs, manifest parsing)
 * -------------------------------------------------------------------------- */

/* Numerically stable softmax (port of streaming.ts, exact). */
static void softmax(const float *in, size_t n, float *out) {
  float max = in[0];
  for (size_t i = 1; i < n; ++i) {
    if (in[i] > max) max = in[i];
  }
  double sum = 0.0;
  for (size_t i = 0; i < n; ++i) {
    const float e = (float)exp((double)in[i] - (double)max);
    out[i] = e;
    sum += (double)e;
  }
  if (sum > 0.0) {
    for (size_t i = 0; i < n; ++i) out[i] = (float)((double)out[i] / sum);
  }
}

static size_t dims_product(const int64_t *dims, size_t ndims) {
  size_t n = 1;
  for (size_t i = 0; i < ndims; ++i) n *= (size_t)dims[i];
  return n;
}

/* Read a whole file into memory. Returns 0 on success. */
static int read_file(const char *path, void **out_data, size_t *out_size) {
  FILE *f = fopen(path, "rb");
  if (f == NULL) return 1;
  if (fseek(f, 0, SEEK_END) != 0) {
    fclose(f);
    return 1;
  }
  long size = ftell(f);
  if (size <= 0) {
    fclose(f);
    return 1;
  }
  rewind(f);
  void *data = malloc((size_t)size);
  if (data == NULL) {
    fclose(f);
    return 1;
  }
  if (fread(data, 1, (size_t)size, f) != (size_t)size) {
    free(data);
    fclose(f);
    return 1;
  }
  fclose(f);
  *out_data = data;
  *out_size = (size_t)size;
  return 0;
}

/* Verify every declared input/output name exists in the actual graph
 * (assertGraphMatchesManifest parity — a mis-paired name degrades accuracy
 * silently, so load() must reject it). */
static int graph_has_name(const OrtApi *api, OrtSession *session, int is_input,
                          const char *wanted) {
  OrtStatus *st = NULL;
  OrtAllocator *alloc = NULL;
  st = api->GetAllocatorWithDefaultOptions(&alloc);
  if (st != NULL) {
    api->ReleaseStatus(st);
    return 0;
  }
  size_t count = 0;
  st = is_input ? api->SessionGetInputCount(session, &count)
                : api->SessionGetOutputCount(session, &count);
  if (st != NULL) {
    api->ReleaseStatus(st);
    return 0;
  }
  for (size_t i = 0; i < count; ++i) {
    char *name = NULL;
    st = is_input ? api->SessionGetInputName(session, i, alloc, &name)
                  : api->SessionGetOutputName(session, i, alloc, &name);
    if (st != NULL) {
      api->ReleaseStatus(st);
      continue;
    }
    int hit = name != NULL && strcmp(name, wanted) == 0;
    if (name != NULL) alloc->Free(alloc, name);
    if (hit) return 1;
  }
  return 0;
}

/* Run the graph with named inputs/outputs. `out_bufs[i]` receives a copy of
 * output i (exactly `expect[i]` floats; mismatch = manifest/graph drift).
 * Input tensors wrap the caller's buffers (Run is synchronous, no copy). */
static int run_graph(kws_streaming_impl_t *impl,
                     const float *const *inputs,
                     const int64_t *const *input_dims, size_t *input_ndims,
                     size_t n_in, float **out_bufs, size_t *out_caps) {
  const OrtApi *api = impl->api;
  OrtStatus *st = NULL;
  const char *errmsg = NULL;
  OrtMemoryInfo *meminfo = NULL;
  OrtValue *in_vals[KWS_MAX_STATES + 1];
  OrtValue *out_vals[KWS_MAX_STATES + 1];
  const char *in_names[KWS_MAX_STATES + 1];
  const char *out_names[KWS_MAX_STATES + 1];
  size_t n_out = 1 + impl->n_states;
  memset(in_vals, 0, sizeof(in_vals));
  memset(out_vals, 0, sizeof(out_vals));

  if (n_in > KWS_MAX_STATES + 1 || n_out > KWS_MAX_STATES + 1) {
    return 1;
  }

  /* Build input values (names: audio first, then state inputs in manifest
   * order — the graph accepts them in any order by name). */
  in_names[0] = impl->audio_input;
  st = api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &meminfo);
  if (st != NULL) goto fail;
  for (size_t i = 0; i < n_in; ++i) {
    size_t bytes = dims_product(input_dims[i], input_ndims[i]) * sizeof(float);
    st = api->CreateTensorWithDataAsOrtValue(
        meminfo, (void *)inputs[i], bytes, input_dims[i], input_ndims[i],
        ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &in_vals[i]);
    if (st != NULL) goto fail;
  }

  out_names[0] = impl->score_output;
  for (size_t i = 0; i < impl->n_states; ++i) {
    in_names[i + 1] = impl->states[i].input;
    out_names[i + 1] = impl->states[i].output;
  }

  st = api->Run(impl->session, NULL, in_names, (const OrtValue *const *)in_vals,
                n_in, out_names, n_out, out_vals);
  if (st != NULL) goto fail;

  for (size_t i = 0; i < n_out; ++i) {
    size_t elems = 0;
    int64_t dims[KWS_MAX_DIMS];
    size_t ndims = 0;
    OrtTensorTypeAndShapeInfo *shape = NULL;
    st = api->GetTensorTypeAndShape(out_vals[i], &shape);
    if (st != NULL) goto fail;
    st = api->GetDimensionsCount(shape, &ndims);
    if (st != NULL) {
      api->ReleaseTensorTypeAndShapeInfo(shape);
      goto fail;
    }
    if (ndims > KWS_MAX_DIMS) ndims = KWS_MAX_DIMS;
    st = api->GetDimensions(shape, dims, ndims);
    api->ReleaseTensorTypeAndShapeInfo(shape);
    if (st != NULL) goto fail;
    elems = dims_product(dims, ndims);
    if (elems > out_caps[i]) {
      errmsg = "output size exceeds the manifest-declared capacity";
      goto fail_clean;
    }
    void *raw = NULL;
    st = api->GetTensorMutableData(out_vals[i], &raw);
    if (st != NULL) goto fail;
    memcpy(out_bufs[i], raw, elems * sizeof(float));
    out_caps[i] = elems;
    api->ReleaseValue(out_vals[i]);
    out_vals[i] = NULL;
  }

  for (size_t i = 0; i < n_in; ++i) {
    api->ReleaseValue(in_vals[i]);
    in_vals[i] = NULL;
  }
  api->ReleaseMemoryInfo(meminfo);
  return 0;

fail:
  errmsg = api->GetErrorMessage(st);
fail_clean:
  fprintf(stderr, "[kws-streaming] inference failed: %s\n",
          errmsg != NULL ? errmsg : "unknown error");
  if (st != NULL) api->ReleaseStatus(st);
  for (size_t i = 0; i <= KWS_MAX_STATES; ++i) {
    if (out_vals[i] != NULL) api->ReleaseValue(out_vals[i]);
    if (in_vals[i] != NULL) api->ReleaseValue(in_vals[i]);
  }
  if (meminfo != NULL) api->ReleaseMemoryInfo(meminfo);
  return 1;
}

/* One sliding-window evaluation (stateless whole-clip run) -> wanted score. */
static float run_sliding_window(kws_streaming_impl_t *impl) {
  const float *inputs[1] = {impl->window};
  int64_t win_dims[2] = {1, (int64_t)impl->window_samples};
  size_t win_ndims = 2;
  float logits[KWS_MAX_LABELS];
  float *out_ptr = logits;
  size_t cap = KWS_MAX_LABELS;
  if (run_graph(impl, inputs, (const int64_t *const *)&win_dims, &win_ndims, 1,
                &out_ptr, &cap) != 0) {
    return -1.0f;
  }
  if (cap < impl->n_labels) return -1.0f;

  float probs[KWS_MAX_LABELS];
  if (impl->softmaxed) {
    memcpy(probs, logits, impl->n_labels * sizeof(float));
  } else {
    softmax(logits, impl->n_labels, probs);
  }
  float score = probs[impl->wanted_index];
  if (!isfinite(score)) score = 0.0f;
  if (score < 0.0f) score = 0.0f;
  if (score > 1.0f) score = 1.0f;
  return score;
}

/* One external-state step: packet + state bags in, state bags carried. */
static float run_streaming_step(kws_streaming_impl_t *impl) {
  const float *inputs[KWS_MAX_STATES + 1];
  int64_t dims_arr[KWS_MAX_STATES + 1][KWS_MAX_DIMS];
  const int64_t *input_dims[KWS_MAX_STATES + 1];
  size_t input_ndims[KWS_MAX_STATES + 1];

  inputs[0] = impl->packet_buf;
  dims_arr[0][0] = 1;
  dims_arr[0][1] = (int64_t)impl->packet_samples;
  input_dims[0] = dims_arr[0];
  input_ndims[0] = 2;
  for (size_t i = 0; i < impl->n_states; ++i) {
    inputs[i + 1] = impl->state_bufs[i];
    for (size_t d = 0; d < impl->states[i].ndims; ++d) {
      dims_arr[i + 1][d] = impl->states[i].shape[d];
    }
    input_dims[i + 1] = dims_arr[i + 1];
    input_ndims[i + 1] = impl->states[i].ndims;
  }

  size_t n_in = 1 + impl->n_states;
  float *out_bufs[KWS_MAX_STATES + 1];
  size_t out_caps[KWS_MAX_STATES + 1];
  float logits[KWS_MAX_LABELS];
  out_bufs[0] = logits;
  out_caps[0] = KWS_MAX_LABELS;
  for (size_t i = 0; i < impl->n_states; ++i) {
    out_bufs[i + 1] = impl->state_bufs[i]; /* carry: output -> next input */
    out_caps[i + 1] = impl->state_elems[i];
  }

  if (run_graph(impl, inputs, input_dims, input_ndims, n_in, out_bufs,
                out_caps) != 0) {
    return -1.0f;
  }
  /* advanceStates parity: each state output is now in the buffer that feeds
   * the next step's input (same buffer — the carry happens in place). */
  if (out_caps[0] < impl->n_labels) return -1.0f;

  float probs[KWS_MAX_LABELS];
  if (impl->softmaxed) {
    memcpy(probs, logits, impl->n_labels * sizeof(float));
  } else {
    softmax(logits, impl->n_labels, probs);
  }
  float score = probs[impl->wanted_index];
  if (!isfinite(score)) score = 0.0f;
  if (score < 0.0f) score = 0.0f;
  if (score > 1.0f) score = 1.0f;
  return score;
}

/* Parse the sidecar manifest into the impl (mode, sizes, names, labels). */
static int parse_manifest(kws_streaming_impl_t *impl, const char *path) {
  void *data = NULL;
  size_t size = 0;
  if (read_file(path, &data, &size) != 0) {
    fprintf(stderr, "[kws-streaming] cannot read manifest %s\n", path);
    return 1;
  }
  /* read_file NUL-terminates nothing; copy to a mutable string. */
  char *text = malloc(size + 1);
  if (text == NULL) {
    free(data);
    return 1;
  }
  memcpy(text, data, size);
  text[size] = '\0';
  free(data);

  json_value_t *root = json_parse(text);
  free(text);
  if (root == NULL) {
    fprintf(stderr, "[kws-streaming] manifest %s is not valid JSON\n", path);
    return 1;
  }

  const char *mode = json_str(json_object_get(root, "mode"));
  const char *audio_input = json_str(json_object_get(root, "audioInput"));
  const char *score_output = json_str(json_object_get(root, "scoreOutput"));
  const char *wanted = json_str(json_object_get(root, "wantedWord"));
  const char *fe = json_str(json_object_get(root, "featureExtractor"));
  const json_value_t *labels = json_object_get(root, "labels");
  if (mode == NULL || audio_input == NULL || score_output == NULL ||
      wanted == NULL || labels == NULL || labels->type != JSON_ARRAY) {
    fprintf(stderr, "[kws-streaming] manifest %s misses required fields\n", path);
    json_free(root);
    return 1;
  }
  if (fe != NULL && strcmp(fe, "graph") != 0) {
    fprintf(stderr,
            "[kws-streaming] featureExtractor '%s' unsupported (Q-KS-2: "
            "'graph' only; external features are not implemented)\n", fe);
    json_free(root);
    return 1;
  }

  if (strcmp(mode, "sliding-window") == 0) {
    impl->mode = 's';
    impl->window_samples = (size_t)json_num(json_object_get(root, "windowSamples"), 0);
    impl->hop_samples = (size_t)json_num(json_object_get(root, "hopSamples"), 0);
    if (impl->window_samples == 0 || impl->hop_samples == 0 ||
        impl->hop_samples > impl->window_samples) {
      fprintf(stderr, "[kws-streaming] bad sliding-window sizes in %s\n", path);
      json_free(root);
      return 1;
    }
    impl->window = calloc(impl->window_samples, sizeof(float));
    if (impl->window == NULL) {
      json_free(root);
      return 1;
    }
  } else if (strcmp(mode, "streaming-external-state") == 0) {
    impl->mode = 'e';
    impl->packet_samples =
        (size_t)json_num(json_object_get(root, "packetSamples"), 0);
    if (impl->packet_samples == 0) {
      fprintf(stderr, "[kws-streaming] bad packetSamples in %s\n", path);
      json_free(root);
      return 1;
    }
    impl->packet_cap = impl->packet_samples * 2;
    impl->packet_buf = calloc(impl->packet_cap, sizeof(float));
    if (impl->packet_buf == NULL) {
      json_free(root);
      return 1;
    }
    const json_value_t *states = json_object_get(root, "states");
    if (states == NULL || states->type != JSON_ARRAY || states->u.array.count > KWS_MAX_STATES) {
      fprintf(stderr, "[kws-streaming] manifest %s has no/invalid states\n", path);
      json_free(root);
      return 1;
    }
    for (size_t i = 0; i < states->u.array.count; ++i) {
      const json_value_t *s = states->u.array.items[i];
      const char *sin = json_str(json_object_get(s, "input"));
      const char *sout = json_str(json_object_get(s, "output"));
      const json_value_t *shape = json_object_get(s, "shape");
      if (sin == NULL || sout == NULL || shape == NULL ||
          shape->type != JSON_ARRAY || shape->u.array.count > KWS_MAX_DIMS) {
        json_free(root);
        return 1;
      }
      kws_state_t *st = &impl->states[impl->n_states];
      snprintf(st->input, sizeof(st->input), "%s", sin);
      snprintf(st->output, sizeof(st->output), "%s", sout);
      st->ndims = shape->u.array.count;
      for (size_t d = 0; d < st->ndims; ++d) {
        st->shape[d] = (int64_t)json_num(shape->u.array.items[d], 0);
      }
      impl->state_elems[impl->n_states] = dims_product(st->shape, st->ndims);
      impl->state_bufs[impl->n_states] =
          calloc(impl->state_elems[impl->n_states], sizeof(float));
      if (impl->state_bufs[impl->n_states] == NULL) {
        json_free(root);
        return 1;
      }
      impl->n_states++;
    }
  } else {
    fprintf(stderr, "[kws-streaming] unknown mode '%s' in %s\n", mode, path);
    json_free(root);
    return 1;
  }

  impl->n_labels = labels->u.array.count;
  if (impl->n_labels > KWS_MAX_LABELS) {
    json_free(root);
    return 1;
  }
  for (size_t i = 0; i < impl->n_labels; ++i) {
    const char *label = json_str(labels->u.array.items[i]);
    if (label == NULL) {
      json_free(root);
      return 1;
    }
    snprintf(impl->labels[i], sizeof(impl->labels[i]), "%s", label);
  }
  impl->wanted_index = impl->n_labels;
  for (size_t i = 0; i < impl->n_labels; ++i) {
    if (strcmp(impl->labels[i], wanted) == 0) {
      impl->wanted_index = i;
      break;
    }
  }
  if (impl->wanted_index == impl->n_labels) {
    fprintf(stderr, "[kws-streaming] wantedWord '%s' not among the labels\n", wanted);
    json_free(root);
    return 1;
  }
  impl->softmaxed = json_bool(json_object_get(root, "softmaxed"), 0);
  snprintf(impl->audio_input, sizeof(impl->audio_input), "%s", audio_input);
  snprintf(impl->score_output, sizeof(impl->score_output), "%s", score_output);

  json_free(root);
  return 0;
}

static void free_impl_runtime(kws_streaming_impl_t *impl) {
  const OrtApi *api = impl->api;
  if (api != NULL) {
    if (impl->session != NULL) {
      api->ReleaseSession(impl->session);
      impl->session = NULL;
    }
    if (impl->env != NULL) {
      api->ReleaseEnv(impl->env);
      impl->env = NULL;
    }
  }
  free(impl->window);
  free(impl->packet_buf);
  for (size_t i = 0; i < impl->n_states; ++i) {
    free(impl->state_bufs[i]);
    impl->state_bufs[i] = NULL;
  }
  impl->window = NULL;
  impl->packet_buf = NULL;
  impl->n_states = 0;
}

#endif /* WAKE_SDK_KWS_STREAMING_HAS_RUNTIME */

static void *kws_streaming_create(const wake_kws_config_t *cfg) {
  (void)cfg;
  return calloc(1, sizeof(kws_streaming_impl_t));
}

static void kws_streaming_destroy(void *v) {
  kws_streaming_impl_t *impl = (kws_streaming_impl_t *)v;
  if (impl == NULL) return;
#if defined(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)
  free_impl_runtime(impl);
#endif
  free(impl);
}

static int kws_streaming_load(void *v, const wake_model_bundle_t *models,
                              const wake_kws_config_t *cfg) {
  (void)cfg;
  kws_streaming_impl_t *impl = (kws_streaming_impl_t *)v;
#if defined(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)
  if (models == NULL || models->model_dir == NULL) return 1;

  const OrtApi *api = OrtGetApiBase()->GetApi(ORT_API_VERSION);
  impl->api = api;

  char path[1024];
  snprintf(path, sizeof(path), "%s/manifest.json", models->model_dir);
  if (parse_manifest(impl, path) != 0) {
    goto fail;
  }

  OrtStatus *st = api->CreateEnv(ORT_LOGGING_LEVEL_WARNING, "wake-kws-streaming",
                                 &impl->env);
  if (st != NULL) {
    fprintf(stderr, "[kws-streaming] CreateEnv: %s\n", api->GetErrorMessage(st));
    api->ReleaseStatus(st);
    goto fail;
  }

  snprintf(path, sizeof(path), "%s/model.onnx", models->model_dir);
  void *data = NULL;
  size_t size = 0;
  if (read_file(path, &data, &size) != 0) {
    fprintf(stderr, "[kws-streaming] cannot read model %s\n", path);
    goto fail;
  }
  OrtSessionOptions *opts = NULL;
  st = api->CreateSessionOptions(&opts);
  if (st == NULL) st = api->SetSessionGraphOptimizationLevel(opts, ORT_ENABLE_ALL);
  if (st == NULL) {
    st = api->CreateSessionFromArray(impl->env, data, size, opts, &impl->session);
  }
  if (opts != NULL) api->ReleaseSessionOptions(opts);
  free(data);
  if (st != NULL) {
    fprintf(stderr, "[kws-streaming] CreateSessionFromArray: %s\n",
            api->GetErrorMessage(st));
    api->ReleaseStatus(st);
    goto fail;
  }

  /* Guard the manifest against the actual graph (mis-paired names degrade
   * accuracy silently — assertGraphMatchesManifest parity). */
  if (!graph_has_name(api, impl->session, 1, impl->audio_input) ||
      !graph_has_name(api, impl->session, 0, impl->score_output)) {
    fprintf(stderr, "[kws-streaming] manifest names missing from the graph "
                    "(audioInput '%s' / scoreOutput '%s')\n",
            impl->audio_input, impl->score_output);
    goto fail;
  }
  for (size_t i = 0; i < impl->n_states; ++i) {
    if (!graph_has_name(api, impl->session, 1, impl->states[i].input) ||
        !graph_has_name(api, impl->session, 0, impl->states[i].output)) {
      fprintf(stderr, "[kws-streaming] state '%s'/'%s' missing from the graph\n",
              impl->states[i].input, impl->states[i].output);
      goto fail;
    }
  }

  impl->loaded = 1;
  return 0;

fail:
  free_impl_runtime(impl);
  return 1;
#else
  (void)impl;
  (void)models;
  return 1; /* onnxruntime C API not linked in this build */
#endif
}

static float kws_streaming_process_frame(void *v, const int16_t *samples,
                                         size_t n) {
  kws_streaming_impl_t *impl = (kws_streaming_impl_t *)v;
#if defined(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)
  if (!impl->loaded || samples == NULL) return -1.0f;

  if (impl->mode == 's') {
    /* Sliding-window: audio is never consumed by a read — the window keeps
     * the most recent windowSamples and slides (overlapping evaluations).
     * Left zero-pad until primed (browser SlidingWindow parity). */
    if (n >= impl->window_samples) {
      memcpy(impl->window, samples + (n - impl->window_samples),
             impl->window_samples * sizeof(float));
    } else if (n > 0) {
      memmove(impl->window, impl->window + n,
              (impl->window_samples - n) * sizeof(float));
      for (size_t i = 0; i < n; ++i) {
        impl->window[impl->window_samples - n + i] = (float)samples[i];
      }
    }
    impl->since_hop += n;
    impl->seen += n;
    if (impl->since_hop < impl->hop_samples) {
      return -1.0f; /* warmup: no hop elapsed yet */
    }
    impl->since_hop %= impl->hop_samples;
    return run_sliding_window(impl);
  }

  /* external-state: packet aligner; a partial packet is never fed (upstream
   * requires the input length aligned with the model's time stride). */
  if (impl->packet_len + n > impl->packet_cap) {
    size_t new_cap = impl->packet_cap * 2;
    if (new_cap < impl->packet_len + n) new_cap = impl->packet_len + n;
    float *nb = realloc(impl->packet_buf, new_cap * sizeof(float));
    if (nb == NULL) return -1.0f;
    impl->packet_buf = nb;
    impl->packet_cap = new_cap;
  }
  for (size_t i = 0; i < n; ++i) {
    impl->packet_buf[impl->packet_len + i] = (float)samples[i];
  }
  impl->packet_len += n;

  float score = -1.0f;
  while (impl->packet_len >= impl->packet_samples) {
    float s = run_streaming_step(impl);
    if (s >= 0.0f) score = s;
    size_t remain = impl->packet_len - impl->packet_samples;
    memmove(impl->packet_buf, impl->packet_buf + impl->packet_samples,
            remain * sizeof(float));
    impl->packet_len = remain;
  }
  return score;
#else
  (void)impl;
  (void)samples;
  (void)n;
  return -1.0f; /* warmup — onnxruntime not linked */
#endif
}

static void kws_streaming_reset(void *v) {
  kws_streaming_impl_t *impl = (kws_streaming_impl_t *)v;
#if defined(WAKE_SDK_KWS_STREAMING_HAS_RUNTIME)
  /* Clear streaming state; models + manifest stay loaded (browser parity). */
  impl->since_hop = 0;
  impl->seen = 0;
  impl->packet_len = 0;
  if (impl->window != NULL) memset(impl->window, 0, impl->window_samples * sizeof(float));
  if (impl->packet_buf != NULL) memset(impl->packet_buf, 0, impl->packet_cap * sizeof(float));
  for (size_t i = 0; i < impl->n_states; ++i) {
    if (impl->state_bufs[i] != NULL) {
      memset(impl->state_bufs[i], 0, impl->state_elems[i] * sizeof(float));
    }
  }
#else
  (void)impl;
#endif
}

const wake_kws_backend_ops_t wake_kws_streaming_ops = {
    "kws-streaming",
    "kws_streaming (Traditional streaming-aware, onnxruntime)",
    kws_streaming_create, kws_streaming_destroy, kws_streaming_load,
    kws_streaming_process_frame, kws_streaming_reset};
