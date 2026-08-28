/**
 * 影子 jj 后端——`jj` 模式的快照字节持有者。
 *
 * 每个工作区一个隐藏 jj 仓库（存储根 `shadow-repos/<key>/` 下），与工作区
 * 自身的任何 VCS 完全无关。每次捕获把引擎给出的新读内容写进仓库内工作
 * 副本 `checkpoint/` 之下，然后做一次显式 `jj commit`；manifest 记录得到的
 * commit id。读回快照用 `jj file show`，两条线（工作区 VCS / 影子库）永不交叉。
 *
 * 增量判定在共享 stat 缓存（capture.ts / capture-cache.ts）完成：本后端
 * 只负责把 newContent 落进镜像并提交。
 */
import { execFile, execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, open, opendir, readlink, rename, rm, rmdir, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { ShadowRewindError } from './errors.js';
import { isNodeError, pathExists, syncDirectory } from './path-utils.js';
/** 影子镜像里承载快照树的固定子目录（仓库内相对路径前缀）。 */
const MIRROR_DIR = 'checkpoint';
/** 探测宿主机上 `jj` CLI 是否可用（一次性开销，启动时调用）。 */
export function jjAvailable() {
    try {
        execFileSync('jj', ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 2_000 });
        return true;
    }
    catch {
        return false;
    }
}
function runJj(args, cwd, signal) {
    return new Promise((resolvePromise, reject) => {
        execFile('jj', [...args], {
            cwd,
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: 64 * 1024 * 1024,
            signal,
            // 清掉可能劫持 git 子命令的环境变量（jj 的 git 后端会读它们）。
            env: cleanEnv(),
        }, (error, stdout) => {
            if (error !== null) {
                if (signal?.aborted === true) {
                    reject(signal.reason ?? error);
                    return;
                }
                reject(new ShadowRewindError('JJ_COMMAND_FAILED', `jj ${args.join(' ')} 在 ${JSON.stringify(cwd)} 失败：${String(error.message)}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}
function runJjBuffer(args, cwd, signal) {
    return new Promise((resolvePromise, reject) => {
        execFile('jj', [...args], {
            cwd,
            encoding: 'buffer',
            windowsHide: true,
            maxBuffer: 256 * 1024 * 1024,
            signal,
            env: cleanEnv(),
        }, (error, stdout) => {
            if (error !== null) {
                if (signal?.aborted === true) {
                    reject(signal.reason ?? error);
                    return;
                }
                reject(new ShadowRewindError('JJ_COMMAND_FAILED', `jj ${args.join(' ')} 在 ${JSON.stringify(cwd)} 失败：${String(error.message)}`));
                return;
            }
            resolvePromise(stdout);
        });
    });
}
function cleanEnv() {
    const env = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'])
        delete env[key];
    return env;
}
function isJjFailure(error) {
    return error instanceof ShadowRewindError && error.code === 'JJ_COMMAND_FAILED';
}
/** 单个工作区的影子仓库句柄。 */
export class ShadowJj {
    repoDir;
    initialized = false;
    constructor(repoDir) {
        this.repoDir = repoDir;
    }
    /**
     * 幂等初始化：建仓（git 后端）。
     * 「镜像目录存在但 .jj 没了」意味着仓库本体曾被外部清理——此时共享
     * stat 缓存仍可能指向这个空仓库，默默重建会产出「成功但为空」的检查点。
     * 因此抛出 JJ_REPO_LOST，由引擎清缓存并重建后再重试捕获。
     */
    async initialize(signal) {
        if (this.initialized)
            return;
        await mkdir(this.repoDir, { recursive: true, mode: 0o700 });
        let exists = false;
        try {
            await lstat(join(this.repoDir, '.jj'));
            exists = true;
        }
        catch (error) {
            if (!isNodeError(error, 'ENOENT'))
                throw error;
        }
        if (!exists) {
            if (await pathExists(join(this.repoDir, MIRROR_DIR))) {
                throw new ShadowRewindError('JJ_REPO_LOST', `影子仓库丢失（残留镜像目录）：${JSON.stringify(this.repoDir)}`);
            }
            await runJj(['git', 'init', this.repoDir], this.repoDir, signal);
        }
        this.initialized = true;
    }
    /**
     * 把本轮快照镜像进 `checkpoint/` 并显式提交为一个 change。
     *
     * 增量语义由共享 stat 缓存（capture.ts）决定：newContent 是需要重写的
     * 文件、newLinks 是需要重建的符号链接——缓存命中的路径工作副本里已是
     * 当前内容，保持原样；快照中不存在的路径（工作区已删除）从镜像中清除。
     * 随后 `jj commit` 把 working copy 收进 @ 并新开空 @，checkpoint change
     * 恒为提交后的 `@-`。
     */
    async capture(paths, newContent, newLinks, message, options) {
        const signal = options.signal;
        await this.initialize(signal);
        const mirrorRoot = join(this.repoDir, MIRROR_DIR);
        await mkdir(mirrorRoot, { recursive: true, mode: 0o755 });
        const wanted = new Set();
        let writtenBytes = 0;
        for (const entry of paths) {
            signal?.throwIfAborted();
            wanted.add(entry.path);
            if (entry.kind !== 'file')
                continue;
            const content = newContent.get(entry.path);
            if (content === undefined)
                continue; // 缓存命中：镜像里已是当前内容
            const segments = entry.path.split('/');
            const fileName = segments[segments.length - 1];
            if (fileName === undefined || fileName === '' || segments.some((s) => s === '' || s === '.' || s === '..')) {
                throw new ShadowRewindError('INVALID_PATH', `镜像路径不是规范形式：${entry.path}`);
            }
            const target = join(mirrorRoot, ...segments);
            await mkdir(dirname(target), { recursive: true, mode: 0o755 });
            writtenBytes += content.length;
            if (writtenBytes > options.maxNewBytes) {
                throw new ShadowRewindError('TURN_CHECKPOINT_NEW_CONTENT_LIMIT', `本次自动检查点需新写 ${String(writtenBytes)} 字节，超出上限 ${String(options.maxNewBytes)}`);
            }
            await writeMirrorFile(target, content, entry.mode);
        }
        // 符号链接的 target 变化不产生「内容字节」，但镜像必须重建链接实体。
        for (const entry of paths) {
            if (entry.kind !== 'symlink' || !newLinks.has(entry.path))
                continue;
            const segments = entry.path.split('/');
            const target = join(mirrorRoot, ...segments);
            await mkdir(dirname(target), { recursive: true, mode: 0o755 });
            await rm(target, { force: true });
            await symlink(entry.target ?? '', target);
        }
        await pruneExtra(mirrorRoot, mirrorRoot, wanted, signal);
        await runJj(['commit', '-m', message], this.repoDir, signal);
        // 记录 git commit id 而非 change id：jj 各版本的 change id 长度不一，
        // 且部分版本不能把 change id hex 直接当 revset 字面量；40 位 commit id
        // 在任何版本都能被 `-r` 稳定解析。我们的历史只追加、永不 rebase，
        // commit id 与 change id 的稳定性在这里等价。
        const commitId = (await runJj(['log', '--no-graph', '-r', '@-', '-T', 'commit_id'], this.repoDir, signal)).trim();
        if (!/^[0-9a-f]{40}$/.test(commitId)) {
            throw new ShadowRewindError('STATE_CORRUPT', `jj 未返回有效的 commit id：${JSON.stringify(commitId)}`);
        }
        return { commitId, writtenBytes };
    }
    /**
     * 从某个 checkpoint 读取一个路径的字节；路径不存在返回 null。
     * 读文件的子命令在 jj 0.40 起从 `cat` 迁移为 `file show`，两种都试。
     */
    async readSnapshot(commitId, path, signal) {
        await this.initialize(signal);
        const repoPath = `${MIRROR_DIR}/${path}`;
        try {
            return await runJjBuffer(['file', 'show', '-r', commitId, repoPath], this.repoDir, signal);
        }
        catch (error) {
            if (!isJjFailure(error))
                throw error;
        }
        try {
            return await runJjBuffer(['cat', '-r', commitId, repoPath], this.repoDir, signal);
        }
        catch (error) {
            if (isJjFailure(error))
                return null;
            throw error;
        }
    }
}
/** 原子写镜像文件：临时文件 + fsync +（先删旧）rename + chmod。 */
async function writeMirrorFile(target, content, mode) {
    const directory = dirname(target);
    const temporary = join(directory, `.${randomUUID()}.jj-mirror.tmp`);
    try {
        const handle = await open(temporary, 'wx', mode & 0o777);
        try {
            await handle.writeFile(content);
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        await chmod(temporary, mode & 0o777);
        await rm(target, { force: true });
        await rename(temporary, target);
        await syncDirectory(directory);
    }
    finally {
        await rm(temporary, { force: true });
    }
}
/**
 * 删除镜像里工作区已不存在的路径；随后尽力回收空目录（到 mirrorRoot 为止）。
 * 目录是否保留由「其下是否仍有 wanted 文件」决定——目录名本身不在 wanted
 * 里（wanted 只含文件路径），因此必须用父目录前缀集合作判定，否则整个
 * 子目录会被误删。
 */
async function pruneExtra(mirrorRoot, root, wanted, signal) {
    // 预生成全部需要的目录前缀（含自身与各级父目录）。
    const wantedDirs = new Set();
    for (const path of wanted) {
        const segments = path.split('/');
        segments.pop();
        let prefix = '';
        for (const segment of segments) {
            prefix = prefix === '' ? segment : `${prefix}/${segment}`;
            wantedDirs.add(prefix);
        }
    }
    const removes = [];
    const stack = [{ dir: root, rel: '' }];
    while (stack.length > 0) {
        signal?.throwIfAborted();
        const current = stack.pop();
        if (current === undefined)
            break;
        let handle;
        try {
            handle = await opendir(current.dir);
        }
        catch (error) {
            if (isNodeError(error, 'ENOENT'))
                continue;
            throw error;
        }
        try {
            for await (const entry of handle) {
                signal?.throwIfAborted();
                const rel = current.rel === '' ? entry.name : `${current.rel}/${entry.name}`;
                let info;
                try {
                    info = await lstat(join(current.dir, entry.name));
                }
                catch (error) {
                    if (isNodeError(error, 'ENOENT'))
                        continue;
                    throw error;
                }
                const isDir = info.isDirectory() && !info.isSymbolicLink();
                const keep = isDir ? wantedDirs.has(rel) : wanted.has(rel);
                if (!keep) {
                    removes.push(join(current.dir, entry.name));
                    continue;
                }
                if (isDir) {
                    stack.push({ dir: join(current.dir, entry.name), rel });
                }
            }
        }
        finally {
            await handle.close().catch(() => undefined);
        }
    }
    for (const path of removes) {
        signal?.throwIfAborted();
        await rm(path, { recursive: true, force: true });
    }
    // 尽力把镜像内变空的目录链收掉；非空则保留（里面仍是 wanted 的文件）。
    let current = root;
    for (;;) {
        try {
            await rmdir(current);
        }
        catch {
            // 非空 / 已消失 / 平台拒绝：到此为止，不影响正确性。
            return;
        }
        const parent = dirname(current);
        // 只回收到 mirrorRoot 这一层为止，绝不触碰仓库自身目录。
        if (parent === current || current === mirrorRoot)
            return;
        current = parent;
    }
}
//# sourceMappingURL=jj-backend.js.map