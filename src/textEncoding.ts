export interface DecodedTxt {
  text: string;
  encoding: string;
}

export function decodeTxtBuffer(
  buffer: ArrayBuffer,
  forceEncoding?: string,
  fallbackEncoding = 'utf-8',
): DecodedTxt {
  if (forceEncoding) {
    try {
      return {
        text: new TextDecoder(forceEncoding, { fatal: false }).decode(buffer),
        encoding: forceEncoding,
      };
    } catch {
      // 指定编码不可用时继续走自动检测。
    }
  }

  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buffer), encoding: 'utf-8' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer), encoding: 'utf-16be' };
  }

  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      encoding: 'utf-8',
    };
  } catch {
    // 非 UTF-8 时优先尝试中文 TXT 常见编码。
  }

  try {
    return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' };
  } catch {
    return {
      text: new TextDecoder(fallbackEncoding, { fatal: false }).decode(buffer),
      encoding: fallbackEncoding,
    };
  }
}
