let wasmModule: WebAssembly.WebAssemblyInstantiatedSource | null = null;
let wasmURL: URL | null = null;
let isOnline: boolean = true;

async function loadWasmApp() {
    if(!isOnline || !wasmURL) {
        return;
    }
    const response = await fetch(wasmURL, { cache: "no-cache" });
    wasmModule = await WebAssembly.instantiateStreaming(response, {});
}

async function updateIsOnline(value: boolean) {
    isOnline = value;
    if(isOnline) {
        await loadWasmApp();
    }
}

/// skewnormal(..) returns a random number from the normal distribution that has
/// been streched and offset to range from `min` to `max`, skewed with `skew`,
/// and truncated to `sigma` standard deviations. See https://stackoverflow.com/a/74258559/213246
const skewnormal = (min: number, max: number, skew = 1, sigma = 4) => {
  /// normal() returns a random number from the standard normal distribution.
  /// Uses the Box-Muller transform.
  const normal = () => Math.sqrt(-2.0 * Math.log(Math.random())) * Math.cos(2.0 * Math.PI * Math.random());

  /// normal01(..) returns normally distributed random number, whose range is
  /// truncated at `sigma` standard deviations and shifted to interval `[0, 1]`.
  const normal01 = (sigma = 4) => {
    while (true) {
      let num = normal() / (sigma * 2.0) + 0.5; // translate to [0, 1]
      if (0 <= num && num <= 1) return num;     // ok if in range, else resample
    }
  };

  var num = normal01(sigma);
  num = Math.pow(num, skew); // skew
  num *= max - min; // stretch to fill range
  num += min; // offset to min
  return num;
}

// Periodically check for new wasm app version, randomizing the check interval
// per client. Note this will still follow server's cache-control policy.
setInterval(() => loadWasmApp(), skewnormal(5, 15) * 60 * 1000); // 5-15 min

self.addEventListener('install', async (event: ExtendableEvent) => {
    console.log('service worker lifecyle event: install');

    event.waitUntil(loadWasmApp())
    self.skipWaiting();
})

self.addEventListener('activate', (event: ExtendableEvent) => {
    self.clients.claim();
    console.log('service worker lifecyle event: activate');
    event.waitUntil(loadWasmApp())
})

self.addEventListener('message', (event: ExtendableMessageEvent) => {
    if(event.data.type === 'clientattached') {
        event.waitUntil(loadWasmApp())
        return;
    }
    if(event.data.type === 'sync') {
        event.waitUntil(updateIsOnline(event.data.value));
    }
    if(event.data.type === 'wasmURL') {
        wasmURL = new URL(event.data.value);
    }
})

const utf8enc = new TextEncoder();
const utf8dec = new TextDecoder("utf8");

function readUtf8FromMemory(app, start, len) {
  const memory = new Uint8Array(app.exports.memory.buffer);
  const text = utf8dec.decode(
    memory.subarray(start, start + len)
  );
  return text;
}

function writeUtf8ToMemory(app, bytes, start) {
  const memory = new Uint8Array(app.exports.memory.buffer);
  memory.set(bytes, start);
}

interface WasmFunctions {
    __oph_function_allocate_request(len: number): number;
    __oph_function_get_response(): number;
    __oph_function_get_response_ptr(): number;
    __oph_function_get_response_len(): number;
}

async function getWasmResponse(event: FetchEvent) {
    try {
        const wasmFunctions : WasmFunctions = <WasmFunctions> <any> wasmModule.instance.exports;
        const requestBody = new Uint8Array(await event.request.arrayBuffer()) || [];
        const request = JSON.stringify({
            method: event.request.method,
            url: event.request.url,
            headers: Array.from(event.request.headers),
            body: Array.from(requestBody)
        });
        const bytes = utf8enc.encode(request);
        const len = bytes.length;
        const requestPtr = wasmFunctions.__oph_function_allocate_request(len);
        writeUtf8ToMemory(wasmFunctions, bytes, requestPtr);
        wasmFunctions.__oph_function_get_response();
        const responsePtr = wasmFunctions.__oph_function_get_response_ptr();
        const responseLen = wasmFunctions.__oph_function_get_response_len();
        const responseContent = readUtf8FromMemory(wasmFunctions, responsePtr, responseLen);
        const response = JSON.parse(responseContent)
        const responseBody = utf8dec.decode(new Uint8Array(response.body));

        console.log(`${event.request.url} - ${response.status}`)
        return new Response(responseBody, {
            status: response.status,
            headers: response.headers
        });
    } catch(error) {
        console.error("error querying wasm app for result", { error, event })
    }
}

self.addEventListener('fetch', (event: FetchEvent) => {
    event.waitUntil(loadWasmApp())
    const url = new URL(event.request.url)
    console.log('fetch event: ', url.toString());

    const useWasmServer = 
        !(url.pathname == "/")
        && !url.pathname.endsWith(wasmURL.pathname)
        && !url.pathname.endsWith(".js")
        && !url.pathname.endsWith(".html")
        && wasmModule;
    if (!useWasmServer) {
        console.log("not using wasm server for this request")
        console.log(wasmModule)
        return;
    }
    console.log("using wasm server for this request")

    event.respondWith(getWasmResponse(event));
})
