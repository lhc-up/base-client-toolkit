/**
 * ESLint 配置。**本配置只做一件事：保证运行时代码不越过 Node 版本下界。**
 *
 * ## 为什么需要它
 *
 * 本包没有构建步骤（architecture §8.2，直接发布 `src/`），所以这一侧既没有编译器
 * 也没有别的闸。而两类越线问题都无法靠别的机制发现：
 *
 * - **语法**：编译期原则上能挡，但本包不编译；消费者的 webpack 也只在设了 node target
 *   时才挡，而 frame 当前只设 `electron-main`（不含版本）
 * - **API**：`structuredClone` / `fsp.cp` 这类是运行时全局或方法，**任何打包器都挡不住**，
 *   原样输出、到用户机器才炸
 *
 * 更隐蔽的是：本包的测试跑在开发机 Node（见下方 DEV_FLOOR）上，高版本 API 在那里
 * 完全可用，**测试全绿也说明不了运行时安全**。
 *
 * ## 下界从哪来 —— 不手填，从 peer 声明算
 *
 * 链条是「声明 → 下界 → 约束代码」（architecture §8.3）：
 * `peerDependencies.electron` 的下界 → 查 Electron→Node 映射 → 得到 Node 下界 →
 * 喂给 `eslint-plugin-n`。**刻意不让插件去读 `engines.node`** —— 那个字段表达的是
 * 开发工具链要求（eslint 10 要 20.19+、vitest 要 18+），与运行时下界是两个不同的数字，
 * 读错就会放过 16.17 ~ 20 之间的全部 API。
 *
 * 一处定义、一处消费：改 peer 范围，下界自动跟着走，不存在两处手工同步的漂移。
 *
 * ## 本步刻意不做的
 *
 * 原 `.eslintrc.json` 已删除 —— eslint 10 只读 flat config，那份文件早已不生效，
 * 且它引着 `eslint-plugin-html`（对一个主进程库毫无意义）。其中的风格规则
 * （`indent` / `eqeqeq` / `no-param-reassign` 等）**未迁入**：本步只做版本兼容保障，
 * 要不要上通用风格规则是独立决定，混进来会让首次运行报出大量无关问题。
 */
const n = require('eslint-plugin-n');
const pkg = require('./package.json');

/**
 * Electron 大版本 → 内置 Node 版本。
 *
 * 数据源是 electron-vite 的 `getElectronNodeTarget()`，并经本仓实测校对：
 * Electron 22.3.1 实跑 `process.versions.node` = **16.17.1**，与表一致。
 * 只列到当前 peer 范围覆盖的版本 —— 表不是越全越好，列了没验过的等于又给出一个
 * 无法兑现的承诺（architecture §8.3 收窄 peer 范围的同一条理由）。
 */
const ELECTRON_NODE = {
    22: '16.17',
    23: '18.12',
    24: '18.14',
    25: '18.15',
    26: '18.16',
    27: '18.17',
    28: '18.18',
};

/**
 * 从 `peerDependencies.electron` 取下界大版本。
 * 当前形态是 `">=22 <29"`，取 `>=` 后面那个数。
 */
function runtimeNodeFloor() {
    const range = pkg.peerDependencies.electron;
    const matched = /^>=\s*(\d+)/.exec(range);
    if (!matched) {
        throw new Error(
            `无法从 peerDependencies.electron（"${range}"）解析下界。`
            + '若改用了其它 range 形态，请同步更新本函数 —— 不要退回手填 Node 版本。',
        );
    }
    const major = Number(matched[1]);
    const nodeVersion = ELECTRON_NODE[major];
    if (!nodeVersion) {
        throw new Error(
            `Electron ${major} 不在 ELECTRON_NODE 映射表内。`
            + '放宽 peer 范围时必须同时补表，并实测该版本的 process.versions.node。',
        );
    }
    return `>=${nodeVersion}`;
}

/** 运行时下界：约束 `src/`，由上面的链条算出。 */
const RUNTIME_FLOOR = runtimeNodeFloor();

/**
 * 开发工具链下界：约束 `tests/` 与各配置文件。
 * 取各工具要求的**最大值** —— 当前是 eslint 10（`^20.19 || ^22.13 || >=24`），
 * 比 vitest 2 的 `^18 || >=20` 更高。
 */
const DEV_FLOOR = '>=20.19';

/** 四条规则：前三条管下界（语法 + 两类 API），最后一条管上界（已移除/弃用）。 */
function versionRules(version) {
    return {
        'n/no-unsupported-features/es-syntax': ['error', { version }],
        'n/no-unsupported-features/es-builtins': ['error', { version }],
        'n/no-unsupported-features/node-builtins': ['error', { version }],
        'n/no-deprecated-api': 'error',
    };
}

/**
 * **必须带上 Node 全局表，否则 `node-builtins` 规则有盲区** —— 实测过：不配 globals 时
 * `structuredClone`（Node 17+）被当成未声明变量、规则无从判断，**静默漏过**；
 * 而 `findLast` 因为是数组方法、走 `es-syntax` 规则，照样能抓到。
 * 也就是说漏的恰好是最该抓的那类（运行时全局）。
 *
 * 直接复用插件 `flat/recommended-script` 的 `languageOptions`（134 个 Node 全局），
 * 不自己拼表 —— 自拼必然漏，且要跟着 Node 版本维护。
 * 只取 `languageOptions`、**不取它的 rules**（那套包含大量风格与正确性规则，
 * 不在本步范围，见文件头）。
 */
const nodeGlobals = n.configs['flat/recommended-script'].languageOptions.globals;

module.exports = [
    {
        // `.eslintignore` 在 eslint 9+ 已失效，忽略项统一写在这里
        ignores: ['node_modules/**', 'coverage/**'],
    },
    {
        // 运行时代码：CJS，受 Electron 内置 Node 下界约束
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: nodeGlobals,
        },
        plugins: { n },
        rules: versionRules(RUNTIME_FLOOR),
    },
    {
        // 测试与配置：只在开发机跑，按开发工具链下界约束即可
        files: ['tests/**/*.js', 'eslint.config.js', 'vitest.config.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: nodeGlobals,
        },
        plugins: { n },
        rules: versionRules(DEV_FLOOR),
        // 本配置刻意不启用 `eslint:recommended`，所以针对 recommended 规则的
        // `eslint-disable` 注释会被判为"未使用"。那不是问题，是本配置范围窄的副作用；
        // 等上了通用规则再打开这项检查。
        linterOptions: { reportUnusedDisableDirectives: 'off' },
    },
];
