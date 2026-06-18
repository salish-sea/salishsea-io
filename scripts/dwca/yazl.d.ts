/**
 * Minimal ambient declaration for the `yazl` CommonJS module — covers
 * only the surface that `scripts/dwca/zip.ts` exercises (`ZipFile`,
 * `addBuffer` with `mtime` + `compress` options, `end`, `outputStream`).
 *
 * The upstream package ships no types and `@types/yazl` is not in our
 * devDependencies. We could add it, but a local 30-line ambient file
 * keeps the lockfile untouched and pins exactly the surface we depend on
 * — yazl 3.3.1's behavior under `addBuffer` with a fixed `mtime` and
 * `compress: true` is what Plan 06 RESEARCH §T6 audited and approved.
 */
declare module 'yazl' {
    import type { Readable } from 'node:stream';

    export interface AddBufferOptions {
        readonly mtime?: Date;
        readonly compress?: boolean;
        readonly mode?: number;
        readonly forceZip64Format?: boolean;
    }

    export class ZipFile {
        readonly outputStream: Readable;
        addBuffer(buffer: Buffer, metadataPath: string, options?: AddBufferOptions): void;
        end(): void;
    }

    const yazl: { ZipFile: typeof ZipFile };
    export default yazl;
}
