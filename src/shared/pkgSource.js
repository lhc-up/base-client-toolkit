/**
 * 包来源。主进程与渲染进程共用：业务按来源区分处理时引用这里的常量，不写字面量。
 *
 * - SEMVER：按版本选包（内置目录 → 下载目录 →（调用方）现场下载）；打包运行时一律为此来源
 * - DEV_SERVER：本地调试，加载另一个项目的 dev server（包信息由 dev server 根地址下的描述文件给出）
 * - FILE：本地调试，加载指定的包文件（`.asax` / `.asar`）
 *
 * 规则见 docs/design/pkg-source.md。
 */
const PKG_SOURCE = Object.freeze({
    SEMVER: 'semver',
    DEV_SERVER: 'devServer',
    FILE: 'file',
});

module.exports = { PKG_SOURCE };
