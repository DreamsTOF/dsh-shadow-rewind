import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PACKAGE_NAME = 'dsh-shadow-rewind'
const CSS_VIRTUAL_PREFIX = '\0dsh-shadow-rewind-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
] as const

/** Compile CSS Modules into package-owned style elements understood by the Web plugin loader. */
function cssModulesPlugin() {
  return {
    name: 'dsh-shadow-rewind-css-modules',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const file = importer === undefined ? source : resolve(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + file + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const file = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      this.addWatchFile(file)
      const source = await readFile(file)
      const { code, exports } = transform({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes: Record<string, string> = {}
      for (const [local, value] of Object.entries(exports ?? {})) classes[local] = value.name
      const styleId = `${PACKAGE_NAME}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const styleId = ${JSON.stringify(styleId)};`,
        'if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleId) + "]") === null) {',
        '  const style = document.createElement("style");',
        `  style.dataset.plugin = ${JSON.stringify(PACKAGE_NAME)};`,
        '  style.dataset.pluginCss = styleId;',
        '  style.textContent = css;',
        '  document.head.appendChild(style);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

const config: UserConfig[] = [{
  name: PACKAGE_NAME,
  entry: {
    index: 'src/index.ts',
    'typert.host': 'src/file-review/typert.host.ts',
    remote: 'src/file-review/remote.ts',
  },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  // unbundle：保留逐模块产物（lib/engine.js 等）。引擎测试直接驱动捕获层
  // 内部模块（scan/capture/capture-cache），打包会破坏这批导入。
  unbundle: true,
  outputOptions: {
    chunkFileNames: '[name].js',
  },
}, {
  name: `${PACKAGE_NAME}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  // 不产出 client.js.map：它比 client.js 本身还大，而 lib/ 是发布物，
  // 会把 map 一并带进包和 git；且 loader 注入的产物无法按 map 回源调试。
  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: ['diff', 'zod'],
    onlyBundle: ['diff', 'zod'],
  },
  plugins: [cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}]

export default config
