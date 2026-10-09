import { inflateRawSync, inflateSync } from 'node:zlib';

/**
 * Test-only readers: they open the generated files independently of the writers, so a test
 * proves the bytes are a real ZIP/XLSX/PDF and finds the values inside.
 */

/** Files of a ZIP archive (central directory → local entries, deflate or stored). */
export function unzip(archive: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip: no end of central directory');
  const count = archive.readUInt16LE(end + 10);
  let pointer = archive.readUInt32LE(end + 16);
  for (let i = 0; i < count; i += 1) {
    if (archive.readUInt32LE(pointer) !== 0x02014b50)
      throw new Error('bad central header');
    const method = archive.readUInt16LE(pointer + 10);
    const compressedSize = archive.readUInt32LE(pointer + 20);
    const nameLength = archive.readUInt16LE(pointer + 28);
    const extraLength = archive.readUInt16LE(pointer + 30);
    const commentLength = archive.readUInt16LE(pointer + 32);
    const local = archive.readUInt32LE(pointer + 42);
    const name = archive
      .subarray(pointer + 46, pointer + 46 + nameLength)
      .toString('utf8');
    const localName = archive.readUInt16LE(local + 26);
    const localExtra = archive.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const data = archive.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

export interface XlsxCell {
  ref: string;
  type: 'string' | 'number';
  value: string | number;
  style: number;
  formula: boolean;
}

/** Sheets by name, with their cells (inline strings and numbers). */
export function readXlsx(file: Buffer): Map<string, XlsxCell[]> {
  const parts = unzip(file);
  const workbook = parts.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const names = [...workbook.matchAll(/<sheet name="([^"]*)" sheetId="(\d+)"/g)].map(
    (match) => decodeXml(match[1] ?? ''),
  );
  const sheets = new Map<string, XlsxCell[]>();
  names.forEach((name, index) => {
    const xml = parts.get(`xl/worksheets/sheet${index + 1}.xml`)?.toString('utf8') ?? '';
    const cells: XlsxCell[] = [];
    for (const match of xml.matchAll(
      /<c r="([A-Z]+\d+)" s="(\d+)"( t="inlineStr")?\/?>(.*?)(<\/c>|$)/g,
    )) {
      const body = match[4] ?? '';
      const formula = /<f>/.test(body);
      if (match[3]) {
        const text = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1] ?? '';
        cells.push({
          ref: match[1] ?? '',
          type: 'string',
          value: decodeXml(text),
          style: Number(match[2]),
          formula,
        });
      } else {
        const number = /<v>([^<]*)<\/v>/.exec(body)?.[1];
        if (number !== undefined) {
          cells.push({
            ref: match[1] ?? '',
            type: 'number',
            value: Number(number),
            style: Number(match[2]),
            formula,
          });
        }
      }
    }
    sheets.set(name, cells);
  });
  return sheets;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
 * Visible text of a PDF made with standard fonts: content streams are inflated and the
 * hex strings of TJ/Tj operators decoded (WinAnsi ≈ Latin-1 for the characters we use).
 */
export function pdfText(file: Buffer): string {
  const raw = file.toString('latin1');
  const lines: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue; // not a compressed content stream (fonts, images…)
    }
    for (const op of content.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hexes =
        op[1] !== undefined
          ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1] ?? '')
          : [op[2] ?? ''];
      lines.push(hexes.map((hex) => winAnsi(Buffer.from(hex, 'hex'))).join(''));
    }
  }
  return lines.join('\n');
}

const WIN_ANSI_HIGH: Record<number, string> = {
  0x80: '€',
  0x85: '…',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
};

function winAnsi(bytes: Buffer): string {
  return [...bytes]
    .map((byte) => WIN_ANSI_HIGH[byte] ?? String.fromCharCode(byte))
    .join('');
}
