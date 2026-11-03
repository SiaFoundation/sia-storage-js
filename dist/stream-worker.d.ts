import { InitInput } from '../wasm/sia_storage_wasm.js';

type StreamClient = {
    id: string;
    postMessage(message: unknown, transfer?: Transferable[]): void;
};
type WaitUntil = {
    waitUntil(promise: Promise<unknown>): void;
};
type StreamFetchEvent = {
    request: Request;
    respondWith(response: Promise<Response>): void;
};
type StreamMessageEvent = WaitUntil & {
    data: unknown;
    source: unknown;
    ports: readonly MessagePort[];
};
type StreamScope = {
    location: {
        origin: string;
    };
    skipWaiting(): Promise<void>;
    clients: {
        get(id: string): Promise<StreamClient | undefined>;
        claim(): Promise<void>;
    };
    addEventListener(type: 'install' | 'activate', listener: (event: WaitUntil) => void): void;
    addEventListener(type: 'message', listener: (event: StreamMessageEvent) => void): void;
    addEventListener(type: 'fetch', listener: (event: StreamFetchEvent) => void): void;
    addEventListener(type: 'error', listener: (event: {
        error?: unknown;
        message?: string;
    }) => void): void;
    addEventListener(type: 'unhandledrejection', listener: (event: {
        reason?: unknown;
    }) => void): void;
};

/**
 * The worker side of streaming, for sites that already run a service worker.
 *
 * A page has only one service worker, so a site with its own calls
 * `installStreams(self)` in it and passes that worker's URL to
 * `enableStreaming`. Every other site serves the prebuilt `sia-storage-sw.js`,
 * which is this function with the WebAssembly built in.
 */

type InstallStreamsOptions = {
    /**
     * The SDK's WebAssembly, as a URL, bytes or compiled module. Only needed
     * when the worker's bundler does not emit `sia_storage_wasm_bg.wasm`.
     */
    wasm?: InitInput;
};
declare function installStreams(scope: StreamScope, options?: InstallStreamsOptions): void;

export { type InstallStreamsOptions, type StreamScope, installStreams };
