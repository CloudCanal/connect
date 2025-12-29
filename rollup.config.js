import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const config = {
  input: 'src/index.ts',
  plugins: [
    resolve({ browser: true }),
    commonjs(),
    typescript({ tsconfig: './tsconfig.json', declaration: false, declarationDir: undefined })
  ]
};

export default [
  // Unminified
  {
    ...config,
    output: {
      file: 'dist/connect.js',
      format: 'umd',
      name: 'cc',
      sourcemap: true,
      exports: 'named'
    }
  },
  // Minified
  {
    ...config,
    plugins: [...config.plugins, terser()],
    output: {
      file: 'dist/connect.min.js',
      format: 'umd',
      name: 'cc',
      sourcemap: true,
      exports: 'named'
    }
  }
];
