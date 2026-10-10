/*
 * L1 tests for the core resampler (issue #245 slice A).
 *
 * The properties that matter:
 *  - a 16 kHz -> 48 kHz -> 16 kHz round trip preserves the signal (this is the
 *    conversion RNNoise needs; before it was centralised, a stage could get it
 *    wrong silently, which is exactly what happened in #240 B2);
 *  - streaming a frame at a time equals converting it in one call (no
 *    block-boundary discontinuity);
 *  - digital silence stays silence (the #240 B2 regression guard);
 *  - unsupported rates are refused, never silently approximated.
 */
#include <cmath>
#include <cstdint>
#include <vector>

#include "doctest/doctest.h"
#include "wake/resample.h"

static const double kPi = 3.14159265358979323846;

static int16_t clamp16(double v) {
  if (v > 32767.0) return 32767;
  if (v < -32768.0) return -32768;
  return static_cast<int16_t>(v);
}

TEST_CASE("resampler refuses unsupported or identity rates") {
  CHECK(wake_resampler_create(16000, 16000) == nullptr);  // no conversion
  CHECK(wake_resampler_create(0, 48000) == nullptr);
  CHECK(wake_resampler_create(44100, 48000) == nullptr);  // non-integer ratio
  // The down direction is supported (RNNoise's return path).
  wake_resampler_t *down = wake_resampler_create(48000, 16000);
  REQUIRE(down != nullptr);
  CHECK(wake_resampler_ratio(down) == 3);
  wake_resampler_destroy(down);
  wake_resampler_t *ok = wake_resampler_create(16000, 48000);
  REQUIRE(ok != nullptr);
  CHECK(wake_resampler_ratio(ok) == 3);
  wake_resampler_destroy(ok);
}

TEST_CASE("resampler upsamples 16 kHz -> 48 kHz by 3") {
  wake_resampler_t *r = wake_resampler_create(16000, 48000);
  REQUIRE(r != nullptr);

  int16_t in[160];
  for (int i = 0; i < 160; ++i) {
    in[i] = clamp16(8000.0 * std::sin(2.0 * kPi * 440.0 * i / 16000.0));
  }
  int16_t out[512];
  size_t n = 0;
  REQUIRE(wake_resampler_process(r, in, 160, out, &n) == 0);
  CHECK(n == 480); // exactly one RNNoise frame per graph frame

  double peak = 0.0;
  for (size_t i = 0; i < n; ++i) {
    peak = std::max(peak, std::fabs(static_cast<double>(out[i])));
  }
  // Amplitude must survive the interpolation (allow filter ripple).
  CHECK(peak > 6000.0);
  CHECK(peak < 10000.0);

  wake_resampler_destroy(r);
}

TEST_CASE("resampler keeps digital silence at digital silence") {
  wake_resampler_t *up = wake_resampler_create(16000, 48000);
  wake_resampler_t *down = wake_resampler_create(48000, 16000);
  REQUIRE(up != nullptr);
  REQUIRE(down != nullptr);

  int16_t zero[160] = {0};
  int16_t mid[512];
  size_t n = 0;
  REQUIRE(wake_resampler_process(up, zero, 160, mid, &n) == 0);
  for (size_t i = 0; i < n; ++i) {
    CHECK(mid[i] == 0);
  }

  int16_t out[512];
  REQUIRE(wake_resampler_process(down, mid, n, out, &n) == 0);
  for (size_t i = 0; i < n; ++i) {
    CHECK(out[i] == 0);
  }

  wake_resampler_destroy(up);
  wake_resampler_destroy(down);
}

TEST_CASE("16k -> 48k -> 16k round trip preserves the signal") {
  /*
   * The anti-alias FIR has a constant group delay, so the down-converted stream
   * matches the input shifted by a few output samples (and the first block emits
   * fewer samples while the filter warms up). Rather than hard-coding an index
   * mapping, this finds the alignment by cross-correlation and then asserts the
   * residual is small AND that the delay stays bounded -- delay is a latency
   * budget question, phase is not something a caller should have to know.
   */
  wake_resampler_t *up = wake_resampler_create(16000, 48000);
  wake_resampler_t *down = wake_resampler_create(48000, 16000);
  REQUIRE(up != nullptr);
  REQUIRE(down != nullptr);

  const int kFrames = 40;
  std::vector<double> ref;   // input at 16 kHz
  std::vector<double> got;   // round-tripped output at 16 kHz
  ref.reserve(kFrames * 160);
  got.reserve(kFrames * 160);

  int16_t upbuf[1024];
  int16_t downbuf[1024];
  for (int f = 0; f < kFrames; ++f) {
    int16_t in[160];
    for (int i = 0; i < 160; ++i) {
      const double t = (double)((f * 160) + i) / 16000.0;
      in[i] = clamp16(8000.0 * std::sin(2.0 * kPi * 300.0 * t));
    }
    size_t up_n = 0, down_n = 0;
    REQUIRE(wake_resampler_process(up, in, 160, upbuf, &up_n) == 0);
    REQUIRE(wake_resampler_process(down, upbuf, up_n, downbuf, &down_n) == 0);
    for (int i = 0; i < 160; ++i) ref.push_back((double)in[i]);
    for (size_t i = 0; i < down_n; ++i) got.push_back((double)downbuf[i]);
  }
  wake_resampler_destroy(up);
  wake_resampler_destroy(down);

  REQUIRE(got.size() > 200);
  // Primed decimation is 1:1, so the round trip returns as many samples as it
  // consumed; the residual is only the filter's group delay.
  REQUIRE(ref.size() == got.size());

  // Best alignment by maximising the overlap error.
  const size_t max_shift = 16;
  size_t best_shift = 0;
  double best_err = 1e300;
  for (size_t shift = 0; shift <= max_shift; ++shift) {
    double err = 0.0;
    size_t n = 0;
    for (size_t i = 0; i + shift < got.size() && i < ref.size(); ++i) {
      err += (got[i + shift] - ref[i]) * (got[i + shift] - ref[i]);
      ++n;
    }
    if (n > 100) {
      const double rms = std::sqrt(err / (double)n);
      if (rms < best_err) {
        best_err = rms;
        best_shift = shift;
      }
    }
  }

  /* The delay is the sum of the two filters' group delays, in output samples:
   *   interpolator: (UP_TAPS-1)/2 = 5.5 input samples -> ~5.5 output samples
   *   decimator:    (DOWN_TAPS-1)/2 / 3 = 3.8 output samples
   * so ~9-10 output samples, i.e. under a millisecond at 16 kHz. The bound
   * guards latency without pinning the caller to a filter's internals. */
  CHECK(best_shift <= 12);
  // And the waveform itself must survive: < 400 LSB RMS residual on an 8000 LSB
  // tone is under 5% (filter ripple + int16 quantisation).
  CHECK(best_err < 400.0);
}

TEST_CASE("streaming frame-by-frame equals one bulk conversion") {
  const int kFrames = 10;
  int16_t bulk_in[kFrames * 160];
  for (int f = 0; f < kFrames; ++f) {
    for (int i = 0; i < 160; ++i) {
      const double t = (double)((f * 160) + i) / 16000.0;
      bulk_in[f * 160 + i] = clamp16(6000.0 * std::sin(2.0 * kPi * 500.0 * t));
    }
  }

  int16_t bulk_out[8192];
  size_t bulk_n = 0;
  wake_resampler_t *r1 = wake_resampler_create(16000, 48000);
  REQUIRE(r1 != nullptr);
  REQUIRE(wake_resampler_process(r1, bulk_in, kFrames * 160, bulk_out, &bulk_n) == 0);

  int16_t stream_out[8192];
  size_t stream_n = 0;
  wake_resampler_t *r2 = wake_resampler_create(16000, 48000);
  REQUIRE(r2 != nullptr);
  for (int f = 0; f < kFrames; ++f) {
    size_t n = 0;
    REQUIRE(wake_resampler_process(r2, bulk_in + (f * 160), 160, stream_out + stream_n,
                                   &n) == 0);
    stream_n += n;
  }

  CHECK(stream_n == bulk_n);
  for (size_t i = 0; i < bulk_n && i < stream_n; ++i) {
    CHECK(stream_out[i] == bulk_out[i]);
  }

  wake_resampler_destroy(r1);
  wake_resampler_destroy(r2);
}

TEST_CASE("resampler output stays finite and bounded on full-scale input") {
  wake_resampler_t *up = wake_resampler_create(16000, 48000);
  REQUIRE(up != nullptr);
  int16_t hot[160];
  for (int i = 0; i < 160; ++i) hot[i] = (i % 2 == 0) ? 32767 : -32768;

  int16_t out[512];
  size_t n = 0;
  REQUIRE(wake_resampler_process(up, hot, 160, out, &n) == 0);
  for (size_t i = 0; i < n; ++i) {
    const double v = out[i];
    CHECK(std::isfinite(v));
    CHECK(v >= -32768.0);
    CHECK(v <= 32767.0);
  }
  wake_resampler_destroy(up);
}

TEST_CASE("resampler reset clears history") {
  wake_resampler_t *down = wake_resampler_create(48000, 16000);
  REQUIRE(down != nullptr);
  int16_t in[480];
  for (int i = 0; i < 480; ++i) in[i] = 20000;
  int16_t out[512];
  size_t n = 0;
  REQUIRE(wake_resampler_process(down, in, 480, out, &n) == 0);
  wake_resampler_reset(down);

  int16_t zero[480] = {0};
  size_t n2 = 0;
  REQUIRE(wake_resampler_process(down, zero, 480, out, &n2) == 0);
  for (size_t i = 0; i < n2; ++i) {
    CHECK(out[i] == 0);
  }
  wake_resampler_destroy(down);
}
TEST_CASE("downsampler is 1:1 from the very first frame") {
  /*
   * Priming matters for a frame-oriented caller: if the first call emitted a
   * short block, the AFE graph's in-place conversion would desynchronise and the
   * process() call would have to fail. 480 in must give 160 out, immediately.
   */
  wake_resampler_t *dn = wake_resampler_create(48000, 16000);
  REQUIRE(dn != nullptr);
  for (int f = 0; f < 4; ++f) {
    int16_t in[480];
    for (int i = 0; i < 480; ++i) {
      in[i] = clamp16(9000.0 * std::sin(2.0 * kPi * 300.0 *
                                        (double)((f * 480) + i) / 48000.0));
    }
    int16_t out[512];
    size_t n = 0;
    REQUIRE(wake_resampler_process(dn, in, 480, out, &n) == 0);
    CHECK(n == 160);
  }
  wake_resampler_destroy(dn);
}
