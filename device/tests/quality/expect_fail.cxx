/*
 * expect_fail.cxx — asserts that the quality harness REJECTS a known-bad build.
 *
 * A quality gate is only worth having if it can fail. This runs the harness in
 * known-bad mode (the pre-#244 device NS stage fed 16 kHz audio mislabeled as
 * 48 kHz, i.e. #240 B2) and inverts the result: the harness must exit non-zero,
 * otherwise this test fails. It therefore fails if the gate ever becomes
 * vacuous -- e.g. if thresholds are loosened until nothing can trip them.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: expect_fail <harness-path> [args...]\n");
    return 2;
  }
  /* system() takes ONE command string, not argv -- building an argv array here
   * silently drops every forwarded argument, which made this wrapper run the
   * harness in production mode and would have hidden a broken gate. */
  size_t len = 1;
  for (int i = 1; i < argc; ++i) {
    len += strlen(argv[i]) + 1;
  }
  char *cmd = (char *)calloc(len + 1, 1);
  if (cmd == NULL) {
    return 2;
  }
  for (int i = 1; i < argc; ++i) {
    if (i > 1) {
      strcat(cmd, " ");
    }
    strcat(cmd, argv[i]);
  }

  const int rc = system(cmd);
  free(cmd);

  if (rc == 0) {
    fprintf(stderr,
            "FAIL: the known-bad build PASSED the quality gate. The thresholds "
            "no longer detect a broken stage, so the gate is decorative.\n");
    return 1;
  }
  if (rc == -1 || (rc & 0x7f) != 0) {
    fprintf(stderr, "FAIL: harness did not run (rc=%d)\n", rc);
    return 1;
  }
  printf("ok: known-bad build rejected by the quality gate (exit=%d)\n",
         (rc >> 8) & 0xff);
  return 0;
}
