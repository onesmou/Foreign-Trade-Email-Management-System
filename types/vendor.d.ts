declare module "pdf-parse" {
  export default function pdfParse(buffer: Buffer): Promise<{ text: string; numpages: number }>;
}
declare module "adm-zip" {
  class AdmZip {
    constructor(input?: Buffer | string);
    getEntries(): Array<{ entryName: string; isDirectory: boolean; header: { size: number }; getData(): Buffer }>;
    addLocalFile(localPath: string, zipPath?: string, zipName?: string): void;
    addFile(entryName: string, content: Buffer): void;
    writeZip(targetFileName: string): void;
  }
  export default AdmZip;
}
