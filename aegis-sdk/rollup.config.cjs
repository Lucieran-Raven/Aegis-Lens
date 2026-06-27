const resolve = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const typescript = require('@rollup/plugin-typescript');

const packageJson = require('./package.json');

module.exports = [
  {
    input: 'src/index.ts',
    output: [
      {
        file: packageJson.main,
        format: 'cjs',
        sourcemap: true,
        inlineDynamicImports: true,
      },
      {
        file: packageJson.module,
        format: 'esm',
        sourcemap: true,
        inlineDynamicImports: true,
      },
      {
        file: 'dist/index.browser.js',
        format: 'umd',
        name: 'AegisLensSDK',
        sourcemap: true,
        inlineDynamicImports: true,
      },
    ],
    plugins: [
      resolve({
        browser: true,
        preferBuiltins: false,
      }),
      commonjs(),
      typescript({
        tsconfig: './tsconfig.json',
        exclude: ['**/*.test.ts'],
        declaration: true,
        declarationDir: './dist',
      }),
    ],
    external: ['@aegis-lens/wasm'],
  },
];