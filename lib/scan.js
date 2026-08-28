/**
 * 统一目录扫描器——引擎唯一的文件枚举通道。
 *
 * 把工作区当作普通目录树遍历（绝不调用任何 VCS 命令），按可配置的排除
 * glob 剪枝，并把「看得见但进不了快照」的路径显式记录为 skip（too-large /
 * unsupported-type），而不是让整个检查点失败。符号链接一律不跟随；文件的
 * 完整权限位（含可执行位）由 lstat 的 mode 保留。
 */
import { lstat, opendir, readlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { ShadowRewindError } from './errors.js';
import { canonicalDirectory, isNodeError, validateRelativePath } from './path-utils.js';
/**
 * 把一条排除 glob 编译成工作区相对路径的正则。
 *  - 含 `*` 或 `?` 的按 glob 语义：单个 `*` 不跨段，`**` 可匹配任意层级；
 *  - 字面相对路径（如 `node_modules`）视为目录规则：匹配任意层级下的同名
 *    节点及其全部内容——这是配置里最常用的写法。
 */
export function compileExclude(pattern) {
    const trimmed = String(pattern ?? '').trim().replace(/^\/+|\/+$/g, '');
    if (trimmed === '') {
        throw new ShadowRewindError('INVALID_CONFIG', 'excludePatterns 不能包含空字符串');
    }
    const hasGlob = trimmed.includes('*') || trimmed.includes('?') || trimmed.includes('[');
    const body = hasGlob ? globToRegex(trimmed) : `(?:.*/)?${escapeRegExp(trimmed)}(?:/.*)?`;
    return { pattern: trimmed, regex: new RegExp(`^${body}$`) };
}
/** 编译整张排除清单。 */
export function compileExcludes(patterns) {
    return patterns.map(compileExclude);
}
/** 工作区相对路径（目录传 `dir/` 形式）是否命中任一排除规则。 */
export function matchesExclude(rel, rules) {
    for (const rule of rules) {
        if (rule.regex.test(rel))
            return true;
    }
    return false;
}
function globToRegex(glob) {
    let out = '';
    for (let i = 0; i < glob.length; i += 1) {
        const c = glob[i];
        if (c === undefined)
            break;
        if (c === '*') {
            if (glob[i + 1] === '*') {
                // `**/` 允许零层或多层目录；裸 `**` 等价 `.*`。
                if (glob[i + 2] === '/') {
                    out += '(?:.*/)?';
                    i += 2;
                }
                else {
                    out += '.*';
                    i += 1;
                }
            }
            else {
                out += '[^/]*';
            }
        }
        else if (c === '?') {
            out += '[^/]';
        }
        else {
            out += escapeRegExp(c);
        }
    }
    return out;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * 遍历工作区目录树：
 *  - 命中目录规则的整棵剪枝（不递归进入）；
 *  - 命中文件规则的文件直接省略；
 *  - 特殊文件 / 超限文件进入 skipped；
 *  - 符号链接不跟随、不下钻。
 */
export async function scanWorkspace(cwd, options) {
    const root = await canonicalDirectory(cwd);
    const paths = [];
    const skipped = [];
    // 显式栈代替递归，避免超深目录树爆调用栈。
    const stack = [{ dir: root, rel: '' }];
    while (stack.length > 0) {
        options.signal?.throwIfAborted();
        const current = stack.pop();
        if (current === undefined)
            break;
        let handle;
        try {
            handle = await opendir(current.dir);
        }
        catch (error) {
            // 竞态：扫描期间目录被删/被换成文件——跳过该子树而非让检查点失败。
            if (isNodeError(error, 'ENOENT') || isNodeError(error, 'ENOTDIR'))
                continue;
            throw error;
        }
        try {
            for await (const entry of handle) {
                options.signal?.throwIfAborted();
                const relPath = current.rel === '' ? entry.name : `${current.rel}/${entry.name}`;
                const absolute = join(current.dir, entry.name);
                let info;
                try {
                    info = await lstat(absolute, { bigint: true });
                }
                catch (error) {
                    if (isNodeError(error, 'ENOENT') || isNodeError(error, 'ENOTDIR'))
                        continue;
                    throw error;
                }
                if (info.isSymbolicLink()) {
                    if (matchesExclude(relPath, options.excludes))
                        continue;
                    let target;
                    try {
                        target = await readlink(absolute);
                    }
                    catch (error) {
                        if (isNodeError(error, 'ENOENT'))
                            continue;
                        throw error;
                    }
                    paths.push({
                        path: validateRelativePath(relPath),
                        kind: 'symlink',
                        target,
                        size: 0,
                        mode: modeOf(info.mode),
                        mtimeNs: info.mtimeNs,
                        ctimeNs: info.ctimeNs,
                        dev: info.dev,
                        ino: info.ino,
                    });
                    continue;
                }
                if (info.isDirectory()) {
                    // 目录规则带尾斜杠参与匹配（`node_modules/` 语义）。
                    if (matchesExclude(`${relPath}/`, options.excludes))
                        continue;
                    stack.push({ dir: absolute, rel: relPath });
                    continue;
                }
                if (!info.isFile()) {
                    skipped.push({ path: relPath, reason: 'unsupported-type' });
                    continue;
                }
                if (Number(info.size) > options.maxFileBytes) {
                    skipped.push({ path: relPath, reason: 'too-large' });
                    continue;
                }
                if (matchesExclude(relPath, options.excludes))
                    continue;
                paths.push({
                    path: validateRelativePath(relPath),
                    kind: 'file',
                    size: Number(info.size),
                    mode: modeOf(info.mode),
                    mtimeNs: info.mtimeNs,
                    ctimeNs: info.ctimeNs,
                    dev: info.dev,
                    ino: info.ino,
                });
            }
        }
        finally {
            await handle.close().catch(() => undefined);
        }
    }
    paths.sort(byPath);
    skipped.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    return { root, paths, skipped };
}
function modeOf(mode) {
    // 保留完整 12 位权限（含 setuid/setgid/sticky），恢复时原样写回。
    return Number(mode & 4095n);
}
function byPath(left, right) {
    return Buffer.from(left.path).compare(Buffer.from(right.path));
}
//# sourceMappingURL=scan.js.map