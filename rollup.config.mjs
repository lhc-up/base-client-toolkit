import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import nodeExternals from 'rollup-plugin-node-externals';

/**
 * Rollup configuration for framework bundling
 * - CLI: Single bundle output
 * - Framework: Main bundle + preload independent output
 */

/** @type {import('rollup').RollupOptions[]} */
export default [
    // Framework: Main bundle (except preload) + preload independent
    {
        input: {
            'index': 'src/index.js',
            'preload': 'src/preload/index.js'
        },
        output: {
            dir: 'dist',
            format: 'cjs',
            entryFileNames: '[name].js',
            chunkFileNames: '[name]-[hash].js'
        },
        external: ['electron'],
        plugins: [
            nodeExternals({
                devDeps: true,      // 排除所有 devDependencies
                deps: false,        // 不排除业务依赖
                builtins: true,     // 排除 Node 内置模块
            }),
            nodeResolve(),
            commonjs({
                ignoreDynamicRequires: true
            }),
            json()
        ]
    }
];