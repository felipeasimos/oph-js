export class Oph {
    wasmURL: string;
    sw: ServiceWorkerRegistration;

    constructor(url: string) {
        // better error in case user forgets the `new` keyword
        if (!(this instanceof Oph)) {
            throw new TypeError("Classes must be initialized using the 'new' keyword.");
        }
        this.wasmURL = url;
    }

    async registerServiceWorker() {
        const serviceWorkerKey = 'serviceWorker';
        if(navigator[serviceWorkerKey]) {
            const sw = await navigator.serviceWorker.register("ophSW.js")
            sw.active.postMessage({ type: 'clientattached' })
            sw.active.postMessage({ type: 'wasmURL', value: this.wasmURL})
            return sw;
        }
        const error = `'${serviceWorkerKey}' is missing from navigator. Is this localhost or https?`
        throw new Error(error)
    }

    async setupSyncEventListeners(sw: ServiceWorkerRegistration) {
        // @ts-ignore
        window.addEventListener("online", () => {
            sw.active.postMessage({ 
                type: 'sync',
                value: false
            })
        })
        // @ts-ignore
        window.addEventListener("offline", () => {
            sw.active.postMessage({ 
                type: 'sync',
                value: false
            })
        })
    }

    async serve() {
        this.sw = await this.registerServiceWorker()
        await this.setupSyncEventListeners(this.sw);
    }
}
