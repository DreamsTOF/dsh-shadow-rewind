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
/**
 * 一条终端命令行**逐字**点名的删除路径，按参数顺序、去重后返回。
 * 非字符串输入与非终端视图一律返回空——认不出来就不报。
 */
export declare function deletedPathsFromCommand(command: string): readonly string[];
/**
 * 一次工具调用报出的删除路径：只有终端工具在 `arguments.command` 里带原始
 * 命令行（dsh 0.1.2 起调用视图被移除，命令行直接从会话事件的 `tool/call`
 * 参数解析）。其它工具一律声明「没有删除」。
 */
export declare function deletedPathsFromCall(name: string, argsRaw: string): readonly string[];
