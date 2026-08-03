declare module "pdf-parse" {
  export default function pdfParse(buffer: Buffer): Promise<{ text: string; numpages: number }>;
}
declare module "adm-zip" {
  class AdmZip {
    constructor(buffer?: Buffer);
    getEntries(): Array<{ entryName: string; isDirectory: boolean; header: { size: number }; getData(): Buffer }>;
  }
  export default AdmZip;
}
