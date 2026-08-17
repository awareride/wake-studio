# coding=utf-8
# Copyright 2026 The Google Research Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Compatible tensorflow library."""

import tensorflow.compat.v1 as tf1  # pylint: disable=unused-import
import tensorflow.compat.v2 as tf  # pylint: disable=unused-import


def smart_cond(pred, true_fn, false_fn, name=None):
  """Version-agnostic wrapper around Keras' ``smart_cond``.

  TensorFlow <= 2.15 exposed it at ``tf._keras_internal.utils.control_flow_util``;
  from TensorFlow 2.16 Keras was split out of the core package and the internal
  path was removed, leaving only the public ``tf.keras.utils.control_flow_util``
  location. Prefer the public path and fall back to the old internal one so the
  helper works regardless of the installed TensorFlow release.
  """
  try:
    from tensorflow.keras.utils.control_flow_util import smart_cond as _smart_cond  # pytype: disable=import-error
  except ImportError:  # TF <= 2.15 internal location
    from tensorflow.compat.v2.keras.utils.control_flow_util import smart_cond as _smart_cond  # pytype: disable=import-error
  return _smart_cond(pred, true_fn, false_fn, name=name)
