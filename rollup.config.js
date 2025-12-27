import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

export default [
  // Main bundle
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/cc.umd.js',
        format: 'umd',
        name: 'cc',
        sourcemap: true
      },
      {
        file: 'dist/cc.esm.js',
        format: 'es',
        sourcemap: true
      }
    ],
    plugins: [
      typescript({ tsconfig: './tsconfig.json' })
    ]
  },
  // Type declarations
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'es'
    },
    plugins: [dts()]
  }
];
