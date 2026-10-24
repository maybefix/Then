/** 元のファイルの拡張子（`.md`・`.txt`、大小文字はそのまま）。分からなければ `.txt`。 */
export function sourceTextExtension(sourcePath: string): string {
  return sourcePath.match(/(\.(?:md|txt))$/i)?.[1] ?? ".txt";
}

/**
 * 入れた名前に拡張子がなければ、元のファイルの拡張子を足す（Rust の normalize_text_file_name に任せると
 * .txt になる）。前後の空白は落とす。空白だけの名前は、そのまま返す（Rust が名前なしとして断る）。
 */
export function withSourceTextExtension(fileName: string, sourcePath: string): string {
  const trimmed = fileName.trim();
  if (!trimmed || /\.(?:md|txt)$/i.test(trimmed)) return trimmed || fileName;
  return `${trimmed}${sourceTextExtension(sourcePath)}`;
}
