/*
 * Single translation unit that provides the doctest main().
 * Every other test TU includes doctest without the IMPLEMENT define.
 */
#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "doctest/doctest.h"
