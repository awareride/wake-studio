/*
 * Host-only reference backend header (see rms_backend.c).
 */
#ifndef WAKE_HOST_RMS_BACKEND_H
#define WAKE_HOST_RMS_BACKEND_H

#include "wake/kws_backend.h"

#ifdef __cplusplus
extern "C" {
#endif

/* RMS reference backend (host demo/harness; no model files). */
extern const wake_kws_backend_ops_t wake_kws_rms_ops;

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* WAKE_HOST_RMS_BACKEND_H */
