type Middleware = (request: {
    url?: string;
}, response: {
    setHeader(name: string, value: string): void;
    end(body: Uint8Array): void;
}, next: () => void) => void;
type Server = {
    config: {
        base: string;
    };
    middlewares: {
        use(middleware: Middleware): void;
    };
};
type Config = {
    build: {
        ssr?: boolean | string;
    };
};
type BuildContext = {
    emitFile(file: {
        type: 'asset';
        fileName: string;
        source: Uint8Array;
    }): string;
};
declare function siaStorage(): {
    name: string;
    config: () => {
        optimizeDeps: {
            exclude: string[];
        };
    };
    configResolved(config: Config): void;
    configureServer(server: Server): void;
    generateBundle(this: BuildContext): void;
};

export { siaStorage };
