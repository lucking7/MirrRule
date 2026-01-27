declare module 'tar-fs' {
  import type { Readable } from 'node:stream';

  export interface TarFsHeader {
    name: string;
    type?: string;
    [key: string]: unknown;
  }

  export type Headers = TarFsHeader;

  export interface ExtractOptions {
    ignore?: (name: string, header?: Headers) => boolean;
    map?: (header: Headers) => Headers;
  }

  export interface ExtractStream extends NodeJS.ReadWriteStream {
    on(
      event: 'entry',
      listener: (header: TarFsHeader, stream: Readable, next: () => void) => void
    ): this;
    on(event: 'finish', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  export function extract(dir: string, options?: ExtractOptions): ExtractStream;
}
