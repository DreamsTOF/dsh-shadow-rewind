/**
 * 从终端调用里抽取出**字面**删除路径（未知即保守，绝不猜）。
 *
 * dsh 没有专门的「删除文件」工具：Agent 只能走 Bash / Pwsh 终端删，原始
 * 命令行就躺在调用参数里。这里没有文件系统快照可比对，所以解析器刻意保守
 * ——只认那些**逐字**出现在已知删除命令参数位上的路径：
 *
 *  - 段里任何位置出现命令/进程替换（`$(…)`、反引号、`<(…)`），整段作废；
 *  - 参数里出现通配符（`* ? [`）或变量展开（`$`），该参数作废（事后无法
 *    枚举受影响集合）；
 *  - 按 shell 分隔符（`&&`、`||`、`|`、`;`、换行）切段，于是 `rm a && rm b`
 *    两个都报，而 `echo rm x` 一个都不报。
 *
 * 报出来的路径只是**展示用词汇**：文件已经不在了，既没有 hunk 也不能撤销。
 * `rm -r` 删掉的目录以其自身路径呈现。
 */

/** 参数位上逐字给出被删路径的命令（POSIX + PowerShell 别名）。 */
const DELETERS = new Set([
  'rm', 'rmdir', 'unlink', 'shred', 'trash',
  'remove-item', 'ri', 'del', 'rd', 'erase',
])

/** Terminal tools whose arguments carry the raw command line (dsh 0.1.2 工具名）。 */
const TERMINAL_TOOLS = new Set(['bash', 'pwsh', 'terminal_send', 'terminal_open'])

/** PowerShell 里「下一个参数才是路径」的参数名（`-Path` / `-LiteralPath`）。 */
const PATH_PARAMETERS = /^-(path|literalpath)$/i

/** 这个 token 能否当作路径：含通配符 / 展开符，或只是 `.` / `..`，一律不算。 */
function isPathlike(token: string): boolean {
  if (token === '' || token === '.' || token === '..') return false
  return !/[*?\[\]$]/.test(token)
}

/**
 * 按 shell 分隔符把一条命令行切成若干段，同时尊重引号——引号里的 `;`
 * 不会把参数切开。
 */
function splitSegments(command: string): readonly string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  for (let at = 0; at < command.length; at += 1) {
    const char = command[at]
    if (quote !== null) {
      if (char === '\\') {
        const next = command[at + 1]
        // 只有双引号内的转义引号才影响切段；其余反斜杠（Windows 路径）按字面处理。
        if (quote === '"' && next === '"') {
          current += char + '"'
          at += 1
          continue
        }
        current += char
        continue
      }
      if (char === quote) quote = null
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    const two = command.slice(at, at + 2)
    if (two === '&&' || two === '||') {
      segments.push(current)
      current = ''
      at += 1
      continue
    }
    if (char === '|' || char === ';' || char === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    current += char
  }
  segments.push(current)
  return segments
}

/**
 * 对一段命令行做类 shell 分词，引号并入 token 内部。
 *
 * 反斜杠语义取与 Windows 相关的那种读法：单引号内（bash / PowerShell 皆然）
 * 一切皆字面，未加引号的反斜杠同样是字面（PowerShell 路径）；只有在双引号
 * 内，反斜杠才转义闭合引号或它自己（bash）。末尾引号未闭合时，已收集到的
 * token 照常产出——宁可少认，不要崩。
 */
function tokenize(segment: string): readonly string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const flush = () => {
    if (current !== '') tokens.push(current)
    current = ''
  }
  for (let at = 0; at < segment.length; at += 1) {
    const char = segment[at]
    if (char === undefined) break
    if (quote !== null) {
      if (char === '\\') {
        const next = segment[at + 1]
        if (quote === '"' && (next === '"' || next === '\\')) {
          current += next
          at += 1
          continue
        }
        current += char
        continue
      }
      if (char === quote) {
        quote = null
        continue
      }
      current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      flush()
      continue
    }
    current += char
  }
  flush()
  return tokens
}

/**
 * 一条终端命令行**逐字**点名的删除路径，按参数顺序、去重后返回。
 * 非字符串输入与非终端视图一律返回空——认不出来就不报。
 */
export function deletedPathsFromCommand(command: string): readonly string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  // PowerShell 的逗号分隔列表会作为独立参数传进来（`rm 'a.txt','b.txt'`）；
  // 逗号本身也可能就是文件名的一部分，所以每一截仍要过同一道 pathlike 过滤。
  const accept = (raw: string): void => {
    for (const part of raw.split(',')) {
      if (!isPathlike(part) || seen.has(part)) continue
      seen.add(part)
      paths.push(part)
    }
  }
  for (const segment of splitSegments(command)) {
    // 命令/进程替换：受影响路径不可知，整段跳过。
    if (segment.includes('$(') || segment.includes('`') || segment.includes('<(')) continue
    const tokens = tokenize(segment)
    // 跳过命令行首的环境变量赋值（`FOO=1 rm x`），它们排在命令词之前。
    let at = 0
    while (at < tokens.length) {
      const head = tokens[at]
      if (head === undefined || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) break
      at += 1
    }
    const commandWord = tokens[at]
    if (commandWord === undefined) continue
    const basename = commandWord.slice(Math.max(commandWord.lastIndexOf('/'), commandWord.lastIndexOf('\\')) + 1)
    if (!DELETERS.has(basename.toLowerCase())) continue
    for (let index = at + 1; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (token === undefined) continue
      if (token.startsWith('-')) {
        if (PATH_PARAMETERS.test(token) && index + 1 < tokens.length) {
          index += 1
          const named = tokens[index]
          if (named !== undefined) accept(named)
        }
        continue
      }
      accept(token)
    }
  }
  return paths
}

/**
 * 一次工具调用报出的删除路径：只有终端工具在 `arguments.command` 里带原始
 * 命令行（dsh 0.1.2 起调用视图被移除，命令行直接从会话事件的 `tool/call`
 * 参数解析）。其它工具一律声明「没有删除」。
 */
export function deletedPathsFromCall(name: string, argsRaw: string): readonly string[] {
  if (!TERMINAL_TOOLS.has(name)) return []
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return []
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return []
  const command = (args as Record<string, unknown>).command
  if (typeof command !== 'string') return []
  return deletedPathsFromCommand(command)
}
