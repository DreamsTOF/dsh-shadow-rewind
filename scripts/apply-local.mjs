/**
 * 本地快速应用：把构建产物直灌进 DSH profile 的插件安装目录，跳过
 * npm publish + dsh plugin update 的发布链路。只同步 files 白名单内容
 * （lib / cordis.patch.yml / README.md / package.json），目标目录的其余
 * 部分（嵌套 node_modules 等）原样保留——依赖仍从 profile 顶层解析，
 * 与 registry 正式安装完全同语义。同步后重启 DSH 生效。
 *
 * 用法：pnpm apply        （= 构建 + 同步）
 *      node scripts/apply-local.mjs   （已构建过，仅同步）
 */
import { cpSync, existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const profile = process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'web')
const target = join(profile, 'node_modules', 'dsh-shadow-rewind')

if (!existsSync(join(target, 'package.json'))) {
  console.error(`[apply-local] 目标不存在：${target}`)
  console.error('[apply-local] 请先用正常方式安装一次插件（npm 发布或 tarball），再使用本地同步。')
  process.exit(1)
}
if (!existsSync(join('lib', 'index.js'))) {
  console.error('[apply-local] lib/index.js 不存在：先跑 pnpm build。')
  process.exit(1)
}

// 先删后拷 = 镜像语义：源里已删除的模块不会在目标里残留。
rmSync(join(target, 'lib'), { recursive: true, force: true })
cpSync('lib', join(target, 'lib'), { recursive: true })
cpSync('cordis.patch.yml', join(target, 'cordis.patch.yml'))
cpSync('README.md', join(target, 'README.md'))
cpSync('package.json', join(target, 'package.json'))

const at = statSync(join(target, 'lib', 'client.js')).mtime.toISOString()
console.log(`[apply-local] 已同步到 ${target}`)
console.log(`[apply-local] client.js 构建时间 ${at}；重启 DSH 生效。`)
