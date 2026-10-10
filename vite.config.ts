import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスで出力しておくと、GitHub Pages のサブディレクトリでもそのまま動く
  base: './',
  server: {
    host: true, // 同じWi-Fi上のスマホから http://<PCのIP>:5173 で確認できる
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
