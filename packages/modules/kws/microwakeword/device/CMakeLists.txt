# Reference module device/ convention (ADR-040 §2 / CONTRIBUTING layout).
#
# Device code for a component lives INSIDE its module:
#   packages/modules/<category>/<name>/device/{CMakeLists.txt,src,include}
#
# The driver itself lands with issue #185 (microwakeword + TFLite-Micro).
# This INTERFACE target exists so the aggregation tree has a first module to
# wire and the convention is visible.
add_library(wake_kws_microwakeword INTERFACE)
target_include_directories(wake_kws_microwakeword
  INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include
)
