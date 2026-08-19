/*
 * wav_reader.c — minimal PCM16 WAV reader (host reference adapter).
 *
 * Parses RIFF/WAVE: 'fmt ' chunk (PCM, 16-bit) + 'data' chunk. Stereo is
 * downmixed by averaging channels. Requires 16 kHz for the KWS pipeline
 * (callers decide; the reader reports what it found).
 */
#include "wav_reader.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  char id[4];
  uint32_t size;
} riff_chunk_t;

static uint32_t rd32(const unsigned char *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) |
         ((uint32_t)p[3] << 24);
}
static uint16_t rd16(const unsigned char *p) {
  return (uint16_t)(p[0] | ((uint16_t)p[1] << 8));
}

int wake_wav_open(const char *path, wake_wav_t *out) {
  FILE *f = fopen(path, "rb");
  unsigned char hdr[12];
  riff_chunk_t ch;
  int audio_format = 0;
  int data_size = 0;
  int have_fmt = 0;
  int have_data = 0;

  if (out) memset(out, 0, sizeof(*out));
  if (f == NULL) return 1;

  if (fread(hdr, 1, 12, f) != 12 || memcmp(hdr, "RIFF", 4) != 0 ||
      memcmp(hdr + 8, "WAVE", 4) != 0) {
    fclose(f);
    return 1;
  }

  while (fread(&ch, 1, 8, f) == 8) {
    if (memcmp(ch.id, "fmt ", 4) == 0) {
      unsigned char fmt[16];
      if (ch.size < 16 || fread(fmt, 1, 16, f) != 16) break;
      audio_format = rd16(fmt);
      out->channels = rd16(fmt + 2);
      out->sample_rate = (int)rd32(fmt + 4);
      out->bits = rd16(fmt + 14);
      have_fmt = 1;
      if (ch.size > 16) fseek(f, (long)(ch.size - 16), SEEK_CUR);
    } else if (memcmp(ch.id, "data", 4) == 0) {
      data_size = (int)ch.size;
      have_data = 1;
      break; /* data is the last chunk we care about */
    } else {
      fseek(f, (long)((ch.size + 1) & ~1u), SEEK_CUR);
    }
  }

  if (!have_fmt || !have_data || audio_format != 1 || out->bits != 16) {
    fclose(f);
    return 1;
  }

  size_t n_samples = (size_t)data_size / 2; /* 16-bit samples, all channels */
  int16_t *raw = (int16_t *)malloc(n_samples * sizeof(int16_t));
  if (raw == NULL) {
    fclose(f);
    return 1;
  }
  size_t got = fread(raw, 2, n_samples, f);
  fclose(f);

  /* Downmix to mono by averaging channels. */
  int nch = out->channels > 0 ? out->channels : 1;
  out->sample_count = got / (size_t)nch;
  out->samples = (int16_t *)malloc(out->sample_count * sizeof(int16_t));
  if (out->samples == NULL) {
    free(raw);
    return 1;
  }
  for (size_t i = 0; i < out->sample_count; ++i) {
    int32_t acc = 0;
    for (int c = 0; c < nch; ++c) {
      acc += raw[i * (size_t)nch + c];
    }
    out->samples[i] = (int16_t)(acc / nch);
  }
  free(raw);
  return 0;
}

void wake_wav_close(wake_wav_t *w) {
  if (w == NULL) return;
  free(w->samples);
  w->samples = NULL;
  w->sample_count = 0;
}
