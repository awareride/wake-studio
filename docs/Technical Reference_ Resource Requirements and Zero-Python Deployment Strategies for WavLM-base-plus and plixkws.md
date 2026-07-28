Here is a comprehensive Technical Reference Document summarizing our discussion on comparing, exporting, and deploying WavLM-base-plus and plixkws without a Python environment.

## ---

**Technical Reference: Resource Requirements and Zero-Python Deployment Strategies for WavLM-base-plus and plixkws**

## **1\. Architectural and Resource Comparison**

When selecting a speech representation or keyword spotting (KWS) framework, resource constraints are a primary deciding factor. WavLM-base-plus and plixkws represent two fundamentally different tiers of compute and memory consumption.

## **1.1 Resource Metrics Matrix**

| Metric / Dimension | WavLM-base-plus | plixkws (PLiX) |
| :---- | :---- | :---- |
| **Architecture Type** | Self-Supervised Speech Big Model | Few-Shot Keyword Spotting (Metric Learning) |
| **Parameters** | **\~95.1M** | **Usually \< 1M to a few Million** |
| **Storage / Model Size** | **\~363 MB** (unquantized) | **A few MB down to hundreds of KB** |
| **Runtime Memory (RAM/VRAM)** | **Multi-Gigabyte (GB)**. Scales quadratically with audio length. | **A few Megabytes (MB)**. Fits inside microcontrollers. |
| **Compute Complexity (FLOPs)** | **Extremely High**. Uses a 12-layer Transformer Encoder. | **Extremely Low**. Optimized streamable neural networks. |
| **Target Hardware** | Cloud servers, high-end PCs, GPU edge nodes. | Smart home IoT, mobile devices, microcontrollers (MCUs). |

## **1.2 Target Use-Case Selection**

> * **WavLM-base-plus:** Ideal for centralized servers or high-performance edge nodes where maximum accuracy across multiple downstream tasks (Speaker Verification, Speech Separation, ASR) is required, regardless of energy footprints.  
> * **plixkws:** Ideal for ultra-low-power, always-on edge hardware (e.g., smart displays, mobile background tasks, wearables) where users register customized keywords instantly with a few voice samples.

## ---

**2\. Cross-Compilation and Zero-Python Deployment**

Deploying plixkws on Edge devices or Web environments where a Python runtime is absent requires converting the PyTorch architecture into a portable computation graph.

## **2.1 The Few-Shot Inference Logic**

Unlike traditional classifications, a few-shot KWS model acts as a **Feature Encoder**. The pipeline in production without Python consists of:

> 1. **Registration Phase:** The user speaks a new phrase N times. The runtime extracts N embeddings (vectors) via the model, averages them, and saves this *Target Template* locally.  
> 2. **Streaming Detection Phase:** Microphones continuously capture 1-second chunks of audio. The model converts the chunk into a *Query Embedding*. The runtime calculates the **Cosine Similarity** between the Query and Target templates. If it exceeds a tuned threshold (e.g., 0.85), the wake-word triggers.

## ---

**3\. Deployment Route A: Web WebAssembly (Wasm)**

To execute plixkws natively in modern web browsers or lightweight hybrid apps without an ONNX dependency, use JavaScript-native compilation.

## **3.1 Option 1: Transformers.js (Highly Recommended)**

Transformers.js runs deep learning models inside the browser via native JavaScript backends.

> * **Conversion:** Standard PyTorch .bin or .safetensors weights are stripped into raw configuration maps and weight layers.  
> * **Implementation:**  
>   `import { pipeline } from '@xenova/transformers';`

>   *`// Load the lightweight feature extraction pipeline natively`*  
>   `const encoder = await pipeline('feature-extraction', 'local-path/plixkws-encoder');`

>   *`// Handle incoming Web Audio API float32 array buffer`*  
>   `const queryEmbedding = await encoder(audioBuffer16kHz);`

>   *`// Compute cosine similarity natively in JS against registered keywords`*

> **WakeStudio implementation note:** In this repo, ONNX (`onnxruntime-web`,
> default) and Transformers.js are not mutually exclusive - the PLiX encoder
> runtime is selectable per model via a single GLOBAL `ModelRuntime` type
> (`src/runtime.ts` = `onnx` | `transformers` | `executorch`), applied through
> `BackendModelUrls.runtime` / `KWSConfig.runtime`. The same selector can drive
> other modules' AFE/KWS models, and the union is open to new backends such as
> an ExecuTorch WASM build for the heaviest on-device targets. Both browser
> runtimes produce the identical 1280-dim embedding, so prototype-distance
> scoring is unchanged. ONNX remains the shipped default; pick Transformers.js
> when you do not want to export/serve an `.onnx` artifact.

## **3.2 Option 2: LibTorch WebAssembly**

PyTorch provides an experimental Wasm runtime compiled via Emscripten. The model is saved as a static **TorchScript** graph (.pt) and evaluated via the browser's raw memory modules.

## ---

**4\. Deployment Route B: Native Edge Devices (C++ / Linux / Bare-Metal)**

For Microcontrollers, Single-Board Computers (Raspberry Pi), or embedded chips running without Python, two main paths exist.

## **4.1 Option 1: TorchScript \+ LibTorch C++ (Embedded Linux / Android)**

If your target hardware supports standard C++ linking and has a few megabytes of overhead space, **TorchScript** is the most stable option. It maintains 100% mathematical fidelity with original PyTorch operators.

## **Step 1: Model Tracing (Executed Once in a Python Environment)**

`import torch`  
`from plixkws import model`

*`# Load and isolate the PyTorch encoder module`*  
`fws_model = model.load(encoder_name="base", language="en", device="cpu")`  
`encoder = fws_model.encoder`  
`encoder.eval()`

*`# Trace with a 1-second dummy audio tensor (16kHz sampling)`*  
`dummy_input = torch.randn(1, 16000)`  
`traced_model = torch.jit.trace(encoder, dummy_input)`  
`traced_model.save("plixkws_encoder.pt")`

## **Step 2: Native C++ Execution (No Python Dependency)**

`#include <torch/script.h> // Include native LibTorch headers`  
`#include <iostream>`  
`#include <memory>`

`int main() {`  
    `// Load the serialized TorchScript graph`  
    `torch::jit::script::Module module;`  
    `try {`  
        `module = torch::jit::load("plixkws_encoder.pt");`  
    `} catch (const c10::Error& e) {`  
        `std::cerr << "Error loading model\n";`  
        `return -1;`  
    `}`

    `// Allocate an input tensor for 16,000 PCM audio samples`  
    `auto inputs = torch::ones({1, 16000});`

    `// Execute the forward pass`  
    `at::Tensor embedding = module.forward({inputs}).toTensor();`  
      
    `std::cout << "Embedding vector generated. Shape: " << embedding.sizes() << std::endl;`  
    `return 0;`  
`}`

## **4.2 Option 2: Raw C Rewrite via GGML / GGUF (Bare-Metal MCUs)**

For microcontrollers with strictly limited RAM (e.g., hundreds of Kilobytes), running a runtime engine like LibTorch is unfeasible.

> * **Strategy:** Extract the raw weight values of plixkws into a flat binary file using custom scripts, applying INT8 or INT4 quantization.  
> * **Execution:** Utilize structural toolkits like **GGML** (the underlying C architecture for whisper.cpp and llama.cpp) to write a zero-allocation, purely deterministic loop that executes the mathematical layers of the encoder. This ensures maximum execution speed and zero overhead from heavy machine learning frameworks.

## ---

**5\. Architectural Recommendation**

> * If your system demands **user-defined custom wake words** created on-the-fly, proceed with **plixkws compiled via TorchScript (C++)** or **Transformers.js (Web)**.  
> * If your system only needs a **static, factory-set group of command phrases** (e.g., "turn on light", "volume up"), it is recommended to substitute few-shot architectures for structural Keyword Spotting networks like **MatchboxNet** or **ARM ML-KWS-for-MCU**, as fully trained deterministic networks offer higher noise resistance at similar low-resource budgets.

---

**Next Steps**: Which environment would you like to develop for first? I can provide the explicit code implementations for either **Web AudioContext microphone sampling** to feed your JS frontend or instructions on **setting up a CMake compiler** for native LibTorch edge integration.