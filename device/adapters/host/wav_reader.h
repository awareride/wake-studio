/*
 * wav_reader.h — minimal PCM16 WAV reader (host reference adapter).
 */
#ifndef WAKE_WAV_READER_H
#define WAKE_WAV_READER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct wake_wav {
  int sample_rate;
  int channels;
  int bits;               /* must be 16 */
  size_t sample_count;    /* mono samples (channels averaged) */
  int16_t *samples;       /* malloc'd; free with wake_wav_close */
} wake_wav_t;

/* Reads a RIFF/WAVE file (PCM16). Returns 0 on success. */
int wake_wav_open(const char *path, wake_wav_t *out);
void wake_wav_close(wake_wav_t *w);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_WAV_READER_H */
